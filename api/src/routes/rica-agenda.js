/**
 * Agenda dos executivos para a Rica (Mentoria Coletiva, set/2026).
 *
 * A Rica marca a reuniao de 30 min do lead com o Andre direto na agenda Google
 * dele. Regras da especificacao "RICA_Mentoria_Coletiva v2 - Agendamento":
 *   - consultar a agenda REAL antes de oferecer qualquer horario;
 *   - so HOJE e AMANHA, fuso America/Recife, sem horarios passados;
 *   - o bloco inteiro de 30 min precisa estar livre (+ buffer configurado);
 *   - ao confirmar, validar DE NOVO a disponibilidade e so entao criar o evento.
 *
 * O executivo precisa ter conectado o Google Agenda no CRM (Agenda → Conectar).
 * Sem conexao, /disponibilidade responde conectado:false e a Rica cai no
 * handoff sem reuniao (o Andre chama o lead na mao).
 *
 * Janela de trabalho (env, opcional): AGENDA_INICIO=08:00, AGENDA_FIM=18:00,
 * AGENDA_DIAS=1,2,3,4,5 (0=dom), AGENDA_BUFFER_MIN=0, AGENDA_ANTECEDENCIA_MIN=30.
 * Dentro da janela, quem manda e a propria agenda: o que estiver ocupado no
 * Google nao e oferecido.
 *
 * Montado em /api/rica/agenda com requireAuth (x-service-token do rica-bot).
 */

import { Router } from 'express';
import { query } from '../services/database.js';
import { listBusyIntervals, createCalendarEvent } from '../services/googleCalendar.js';
import { criarLinkAgenda } from '../services/agenda-links.js';

const router = Router();

const FUSO = '-03:00'; // Recife: UTC-3 o ano todo
const FUSO_MS = 3 * 60 * 60 * 1000;
const PASSO_MIN = 30;

function cfg() {
  const hm = (s, def) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || def));
    return m ? Number(m[1]) * 60 + Number(m[2]) : hm(def, def);
  };
  return {
    inicioMin: hm(process.env.AGENDA_INICIO, '08:00'),
    fimMin: hm(process.env.AGENDA_FIM, '18:00'),
    dias: String(process.env.AGENDA_DIAS || '1,2,3,4,5').split(',').map((d) => Number(d.trim())),
    bufferMin: Number(process.env.AGENDA_BUFFER_MIN || 0),
    antecedenciaMin: Number(process.env.AGENDA_ANTECEDENCIA_MIN || 30),
  };
}

/** 'YYYY-MM-DD' do dia em Recife para um instante. */
function diaRecife(date) {
  return new Date(date.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

function somaDias(ymd, n) {
  const d = new Date(`${ymd}T12:00:00${FUSO}`);
  d.setUTCDate(d.getUTCDate() + n);
  return diaRecife(d);
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DIAS_SEMANA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function rotulo(inicio, hoje) {
  const ymd = diaRecife(inicio);
  const local = new Date(inicio.getTime() - FUSO_MS);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  const dd = ymd.slice(8, 10);
  const mo = ymd.slice(5, 7);
  // "amanhã" só quando é mesmo o dia seguinte: sexta → segunda vira "segunda".
  const qual = ymd === hoje ? 'hoje' : ymd === somaDias(hoje, 1) ? 'amanhã' : DIAS_SEMANA_LONGO[local.getUTCDay()];
  return `${qual} (${DIAS_SEMANA[local.getUTCDay()]}, ${dd}/${mo}) às ${hh}:${mm}`;
}

export { diaRecife };

export async function resolverUsuario(orgId, email) {
  const r = await query(
    `SELECT u.id, u.name, u.email, (t.refresh_token IS NOT NULL AND t.sync_enabled) AS conectado
     FROM users u LEFT JOIN user_google_tokens t ON t.user_id = u.id
     WHERE u.organization_id = $1 AND lower(u.email) = lower($2) AND u.is_active = true
     LIMIT 1`,
    [orgId, email]
  );
  return r.rows[0] || null;
}

function ehDiaDeAtendimento(ymd, config) {
  return config.dias.includes(new Date(`${ymd}T12:00:00${FUSO}`).getUTCDay());
}

/** Próximo dia de atendimento DEPOIS de `ymd` (pula fim de semana/dias fora de AGENDA_DIAS). */
function proximoDiaUtil(ymd, config) {
  for (let i = 1; i <= 7; i++) {
    const d = somaDias(ymd, i);
    if (ehDiaDeAtendimento(d, config)) return d;
  }
  return somaDias(ymd, 1);
}

/**
 * Os dois dias oferecidos: HOJE (se for dia de atendimento) e o PRÓXIMO dia de
 * atendimento. Manual GPS, seção 8: "se a operação não funcionar aos
 * sábados/domingos/feriados, D+1 deve significar o próximo dia útil".
 */
export function diasOferecidos(agora, config = cfg()) {
  const hoje = diaRecife(agora);
  const dias = ehDiaDeAtendimento(hoje, config) ? [hoje] : [];
  dias.push(proximoDiaUtil(hoje, config));
  return dias;
}

function slotsDoDia(ymd, { agora, busy, duracao, config }) {
  const hoje = diaRecife(agora);
  const minimo = agora.getTime() + config.antecedenciaMin * 60_000;
  const buffer = config.bufferMin * 60_000;
  const slots = [];
  for (let m = config.inicioMin; m + duracao <= config.fimMin; m += PASSO_MIN) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    const inicio = new Date(`${ymd}T${hh}:${mm}:00${FUSO}`);
    const fim = new Date(inicio.getTime() + duracao * 60_000);
    if (inicio.getTime() < minimo) continue;
    const conflito = busy.some(
      (b) => inicio.getTime() < b.fim.getTime() + buffer && fim.getTime() > b.inicio.getTime() - buffer
    );
    if (!conflito) slots.push({ inicio: inicio.toISOString(), rotulo: rotulo(inicio, hoje) });
  }
  return slots;
}

/**
 * Horarios livres de `duracao` minutos, hoje e no próximo dia de atendimento.
 * Exportada para teste. `busy` = [{inicio: Date, fim: Date}]
 */
export function calcularSlots({ agora, busy, duracao = 30, config = cfg() }) {
  return diasOferecidos(agora, config).flatMap((ymd) => slotsDoDia(ymd, { agora, busy, duracao, config }));
}

/**
 * Exceção do manual GPS (seção 8): sem horário livre em D0/D+1, oferece SÓ o
 * próximo dia de atendimento que tiver horário — "sem abrir automaticamente
 * uma agenda longa". Procura até DIAS_EXCECAO dias à frente.
 */
const DIAS_EXCECAO = 10;

export function calcularSlotsComExcecao({ agora, busy, duracao = 30, config = cfg() }) {
  const normais = calcularSlots({ agora, busy, duracao, config });
  if (normais.length) return { slots: normais, excecao: false };
  const dias = diasOferecidos(agora, config);
  let d = dias[dias.length - 1];
  for (let i = 0; i < DIAS_EXCECAO; i++) {
    d = proximoDiaUtil(d, config);
    const slots = slotsDoDia(d, { agora, busy, duracao, config });
    if (slots.length) return { slots, excecao: true };
  }
  return { slots: [], excecao: false };
}

/** Busca a agenda e calcula os horários. null = Google não conectado. */
export async function slotsDoUsuario(userId, agora, duracao, { excecao = false } = {}) {
  const hoje = diaRecife(agora);
  const timeMin = new Date(`${hoje}T00:00:00${FUSO}`);
  const timeMax = new Date(`${somaDias(hoje, excecao ? DIAS_EXCECAO + 8 : 9)}T00:00:00${FUSO}`);
  const busy = await listBusyIntervals({ userId, timeMin, timeMax });
  if (busy === null) return null;
  return excecao
    ? calcularSlotsComExcecao({ agora, busy, duracao })
    : { slots: calcularSlots({ agora, busy, duracao }), excecao: false };
}

// GET /api/rica/agenda/disponibilidade?executivo_email=...&duracao=30
router.get('/disponibilidade', async (req, res) => {
  const email = String(req.query.executivo_email || '');
  const duracao = Math.min(Math.max(Number(req.query.duracao) || 30, 15), 120);
  if (!email) return res.status(400).json({ error: { message: 'executivo_email obrigatório' } });

  const user = await resolverUsuario(req.organizationId, email);
  if (!user) return res.status(404).json({ error: { message: 'Executivo não encontrado' } });
  if (!user.conectado) return res.json({ conectado: false, slots: [] });

  try {
    const r = await slotsDoUsuario(user.id, new Date(), duracao);
    if (r === null) return res.json({ conectado: false, slots: [] });
    res.json({ conectado: true, executivo: user.name, duracao, slots: r.slots });
  } catch (e) {
    console.warn('[rica-agenda] disponibilidade falhou:', e.message);
    res.status(502).json({ error: { message: 'Falha ao consultar a agenda do Google' } });
  }
});

// POST /api/rica/agenda/agendar
// { executivo_email, inicio (ISO), duracao, lead: { nome, telefone, padaria }, resumo, deal_id }
router.post('/agendar', async (req, res) => {
  const { executivo_email, inicio, lead = {}, resumo = '', deal_id, produto = 'Mentoria Padaria Lucrativa' } = req.body || {};
  const duracao = Math.min(Math.max(Number(req.body?.duracao) || 30, 15), 120);
  if (!executivo_email || !inicio) {
    return res.status(400).json({ error: { message: 'executivo_email e inicio são obrigatórios' } });
  }

  const user = await resolverUsuario(req.organizationId, executivo_email);
  if (!user) return res.status(404).json({ error: { message: 'Executivo não encontrado' } });
  if (!user.conectado) return res.status(409).json({ ok: false, motivo: 'agenda_nao_conectada' });

  try {
    // Revalida: o horário escolhido ainda está entre os livres?
    const slots = (await slotsDoUsuario(user.id, new Date(), duracao))?.slots;
    const alvo = new Date(inicio).getTime();
    const livre = (slots || []).some((s) => new Date(s.inicio).getTime() === alvo);
    if (!livre) {
      return res.status(409).json({ ok: false, motivo: 'horario_indisponivel', slots: (slots || []).slice(0, 4) });
    }

    const fim = new Date(alvo + duracao * 60_000);
    const summary = `${produto} — ${lead.nome || 'Lead'}${lead.padaria ? ` (${lead.padaria})` : ''}`;
    const description = [
      'Reunião de 30 min marcada pela Rica (WhatsApp).',
      lead.telefone ? `WhatsApp: https://wa.me/${String(lead.telefone).replace(/\D/g, '')}` : '',
      '',
      resumo,
    ].filter((l) => l !== undefined).join('\n');

    const ev = await createCalendarEvent({ userId: user.id, summary, description, inicio: new Date(alvo), fim });

    // Registro no CRM: atividade de reunião no deal (sem criar 2º evento no Google).
    if (deal_id) {
      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description, scheduled_at, duration_minutes, google_event_id, google_calendar_id, organization_id)
         VALUES ($1, $2, 'meeting', $3, $4, $5, $6, $7, $8)`,
        [deal_id, user.id, `Reunião ${produto} marcada pela Rica. ${resumo}`.slice(0, 2000), new Date(alvo), duracao, ev.eventId, ev.calendarId, req.organizationId]
      ).catch((e) => console.warn('[rica-agenda] atividade no deal falhou:', e.message));
    }

    res.json({ ok: true, event_id: ev.eventId, inicio: new Date(alvo).toISOString(), rotulo: rotulo(new Date(alvo), diaRecife(new Date())) });
  } catch (e) {
    console.warn('[rica-agenda] agendar falhou:', e.message);
    res.status(502).json({ ok: false, motivo: 'erro_google', error: { message: e.message } });
  }
});

// POST /api/rica/agenda/link  (GPS: a Rica manda o LINK e o lead escolhe o horário)
// { executivo_email, telefone, campanha, deal_id, criado_por }
// → { ok, conectado, url, excecao, horarios, primeiro_horario }
router.post('/link', async (req, res) => {
  const { executivo_email, telefone, campanha = 'gps', deal_id, criado_por = 'rica' } = req.body || {};
  if (!executivo_email || !telefone) {
    return res.status(400).json({ error: { message: 'executivo_email e telefone são obrigatórios' } });
  }
  const user = await resolverUsuario(req.organizationId, executivo_email);
  if (!user) return res.status(404).json({ error: { message: 'Executivo não encontrado' } });
  if (!user.conectado) return res.json({ ok: false, conectado: false });

  try {
    const r = await slotsDoUsuario(user.id, new Date(), 30, { excecao: true });
    if (r === null) return res.json({ ok: false, conectado: false });
    const link = await criarLinkAgenda({
      orgId: req.organizationId, executivoEmail: user.email, phone: telefone,
      campanha, dealId: deal_id, criadoPor: criado_por === 'andre' ? 'andre' : 'rica',
    });
    res.json({
      ok: true,
      conectado: true,
      url: link.url,
      expires_at: link.expires_at,
      excecao: r.excecao,
      horarios: r.slots.length,
      primeiro_horario: r.slots[0]?.rotulo || null,
    });
  } catch (e) {
    console.warn('[rica-agenda] link falhou:', e.message);
    res.status(502).json({ ok: false, motivo: 'erro_google', error: { message: e.message } });
  }
});

export default router;
