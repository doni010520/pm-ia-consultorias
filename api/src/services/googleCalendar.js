/**
 * Integracao com o Google Agenda (Google Calendar) — OAuth por usuario.
 *
 * Cada usuario conecta a PROPRIA conta Google. Guardamos refresh_token/access_token
 * na tabela user_google_tokens. Quando uma atividade agendada e criada no CRM,
 * criamos o evento correspondente na agenda do dono da atividade.
 *
 * Se as variaveis GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET nao estiverem
 * configuradas, todas as funcoes viram no-op (o CRM continua funcionando sem
 * a sincronizacao).
 */

import { google } from 'googleapis';
import { query } from './database.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// URL do callback no BACKEND (ex: https://api.seuapp.com/api/integrations/google/callback)
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
// Para onde mandar o usuario de volta no FRONTEND depois de conectar
const APP_URL = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export function isGoogleConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

export function getAppUrl() {
  return APP_URL;
}

function newOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * URL de consentimento do Google. `state` carrega o token/identificacao do usuario
 * para reassociar no callback.
 */
export function getAuthUrl(state) {
  const client = newOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // garante refresh_token mesmo em reconexoes
    scope: SCOPES,
    state,
    include_granted_scopes: true,
  });
}

/**
 * Troca o `code` do callback por tokens e descobre o e-mail da conta conectada.
 */
export async function exchangeCode(code) {
  const client = newOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let email = null;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data?.email || null;
  } catch { /* email e opcional */ }

  return { tokens, email };
}

/**
 * Persiste (upsert) os tokens do usuario.
 */
export async function saveUserTokens(userId, organizationId, tokens, email) {
  await query(
    `INSERT INTO user_google_tokens
       (user_id, organization_id, google_email, access_token, refresh_token, token_type, scope, expiry_date, sync_enabled, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       organization_id = EXCLUDED.organization_id,
       google_email = COALESCE(EXCLUDED.google_email, user_google_tokens.google_email),
       access_token = EXCLUDED.access_token,
       -- Google so devolve refresh_token na 1a autorizacao; preserva o antigo se vier vazio
       refresh_token = COALESCE(EXCLUDED.refresh_token, user_google_tokens.refresh_token),
       token_type = EXCLUDED.token_type,
       scope = EXCLUDED.scope,
       expiry_date = EXCLUDED.expiry_date,
       sync_enabled = true,
       updated_at = NOW()`,
    [
      userId, organizationId, email,
      tokens.access_token || null,
      tokens.refresh_token || null,
      tokens.token_type || null,
      tokens.scope || null,
      tokens.expiry_date || null,
    ]
  );
}

/**
 * Status da conexao do usuario (para o frontend).
 */
export async function getUserConnection(userId) {
  const r = await query(
    `SELECT google_email, calendar_id, sync_enabled, updated_at,
            (refresh_token IS NOT NULL) AS has_refresh
     FROM user_google_tokens WHERE user_id = $1`,
    [userId]
  );
  const row = r.rows[0];
  return {
    connected: Boolean(row && row.has_refresh),
    email: row?.google_email || null,
    calendar_id: row?.calendar_id || 'primary',
    sync_enabled: row?.sync_enabled ?? false,
    connected_at: row?.updated_at || null,
  };
}

export async function disconnectUser(userId) {
  await query(`DELETE FROM user_google_tokens WHERE user_id = $1`, [userId]);
}

/**
 * Retorna um cliente autenticado (calendar API) para o usuario, ou null se ele
 * nao estiver conectado / a sincronizacao estiver desligada. Persiste tokens
 * renovados automaticamente.
 */
async function getUserCalendar(userId) {
  if (!isGoogleConfigured()) return null;

  const r = await query(
    `SELECT access_token, refresh_token, token_type, scope, expiry_date, calendar_id, sync_enabled
     FROM user_google_tokens WHERE user_id = $1`,
    [userId]
  );
  const row = r.rows[0];
  if (!row || !row.refresh_token || !row.sync_enabled) return null;

  const client = newOAuthClient();
  client.setCredentials({
    access_token: row.access_token,
    refresh_token: row.refresh_token,
    token_type: row.token_type,
    scope: row.scope,
    expiry_date: row.expiry_date ? Number(row.expiry_date) : undefined,
  });

  // Persistir tokens renovados (novo access_token / expiry).
  client.on('tokens', (tokens) => {
    query(
      `UPDATE user_google_tokens SET
         access_token = COALESCE($2, access_token),
         refresh_token = COALESCE($3, refresh_token),
         expiry_date = COALESCE($4, expiry_date),
         updated_at = NOW()
       WHERE user_id = $1`,
      [userId, tokens.access_token || null, tokens.refresh_token || null, tokens.expiry_date || null]
    ).catch((e) => console.warn('[googleCalendar] falha ao persistir token renovado:', e.message));
  });

  const calendar = google.calendar({ version: 'v3', auth: client });
  return { calendar, calendarId: row.calendar_id || 'primary' };
}

/**
 * Monta o corpo do evento a partir de uma atividade do CRM.
 */
function buildEvent(activity, deal) {
  const start = new Date(activity.scheduled_at);
  const durationMin = Number(activity.duration_minutes) > 0 ? Number(activity.duration_minutes) : 30;
  const end = new Date(start.getTime() + durationMin * 60 * 1000);

  const typeLabel = {
    call: 'Ligação', meeting: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp', note: 'Nota', task: 'Tarefa',
  }[activity.type] || 'Atividade';

  const leadName = deal?.contact_name || deal?.title || 'Lead';
  const summary = `${typeLabel}: ${leadName}`;

  const descLines = [];
  if (activity.description) descLines.push(activity.description);
  if (deal?.contact_phone) descLines.push(`Telefone: ${deal.contact_phone}`);
  if (deal?.company_name) descLines.push(`Empresa: ${deal.company_name}`);
  descLines.push('', 'Criado pelo CRM (PM-IA).');

  return {
    summary,
    description: descLines.join('\n'),
    start: { dateTime: start.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 30 },
        { method: 'popup', minutes: 10 },
      ],
    },
  };
}

/**
 * Cria um evento no Google Agenda do dono da atividade. Retorna o event_id ou null.
 * Nunca lanca — falha de sincronizacao nao pode quebrar a criacao da atividade.
 */
export async function createEventForActivity({ userId, activity, deal }) {
  try {
    if (!activity?.scheduled_at || !userId) return null;
    const ctx = await getUserCalendar(userId);
    if (!ctx) return null;

    const res = await ctx.calendar.events.insert({
      calendarId: ctx.calendarId,
      requestBody: buildEvent(activity, deal),
    });
    return { eventId: res.data.id, calendarId: ctx.calendarId };
  } catch (e) {
    console.warn('[googleCalendar] createEventForActivity falhou:', e.message);
    return null;
  }
}

export async function updateEventForActivity({ userId, activity, deal, eventId, calendarId }) {
  try {
    if (!eventId || !userId) return null;
    const ctx = await getUserCalendar(userId);
    if (!ctx) return null;
    await ctx.calendar.events.update({
      calendarId: calendarId || ctx.calendarId,
      eventId,
      requestBody: buildEvent(activity, deal),
    });
    return { eventId, calendarId: calendarId || ctx.calendarId };
  } catch (e) {
    console.warn('[googleCalendar] updateEventForActivity falhou:', e.message);
    return null;
  }
}

export async function deleteEvent({ userId, eventId, calendarId }) {
  try {
    if (!eventId || !userId) return;
    const ctx = await getUserCalendar(userId);
    if (!ctx) return;
    await ctx.calendar.events.delete({ calendarId: calendarId || ctx.calendarId, eventId });
  } catch (e) {
    console.warn('[googleCalendar] deleteEvent falhou:', e.message);
  }
}

export default {
  isGoogleConfigured, getAppUrl, getAuthUrl, exchangeCode, saveUserTokens,
  getUserConnection, disconnectUser, createEventForActivity, updateEventForActivity, deleteEvent,
};
