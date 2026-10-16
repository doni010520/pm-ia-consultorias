/**
 * whatsapp-executivo.js — conversas do WhatsApp CORPORATIVO dos executivos
 * dentro do CRM (pedido da Isabell, gestora de resultados, 15/10/2026: "Preciso
 * analisar como estão sendo realizados os atendimentos dele [André]").
 *
 * Cada executivo tem uma instância própria na uazapi (só leitura: o CRM nunca
 * envia por ela). A instância manda o webhook para
 *   POST /api/integrations/whatsapp-executivo/:slug?secret=...
 * e aqui a mensagem vira uma linha de `deal_messages` na MESMA conversa da Rica
 * (chave = telefone do lead), com sender 'executivo' e o nome do executivo no
 * metadata. Assim quem analisa vê a conversa inteira: Rica → André → lead.
 *
 * Só entra conversa com quem JÁ é lead no CRM (contato com negócio). Grupo,
 * status e qualquer outro contato são ignorados.
 *
 * Configuração (env):
 *   WA_EXECUTIVOS            "andre:André:<token-da-instancia>[,slug:Nome:token]"
 *   WA_EXEC_WEBHOOK_SECRET   segredo exigido na URL do webhook
 *   UAZAPI_URL               servidor uazapi (padrão benitechlab)
 */
import { query } from './database.js';

const UAZAPI_URL = (process.env.UAZAPI_URL || 'https://benitechlab.uazapi.com').replace(/\/+$/, '');

/** Lê WA_EXECUTIVOS. Exportado para teste. */
export function lerExecutivos(raw = process.env.WA_EXECUTIVOS || '') {
  const mapa = {};
  for (const item of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [slug, nome, token] = item.split(':').map((s) => (s || '').trim());
    if (slug && nome) mapa[slug.toLowerCase()] = { slug: slug.toLowerCase(), nome, token: token || '' };
  }
  return mapa;
}

export function executivo(slug) {
  return lerExecutivos()[String(slug || '').toLowerCase()] || null;
}

const digitos = (s) => String(s || '').replace(/\D/g, '');

/** DDD de um telefone brasileiro, com ou sem o 55 na frente. */
export function dddDe(tel) {
  const d = digitos(tel);
  if (d.startsWith('55') && d.length >= 12) return d.slice(2, 4);
  if (d.length >= 10) return d.slice(0, 2);
  return null;
}

/** Mesmo número? Compara os 8 finais + DDD (tolera o 9º dígito e o 55). */
export function mesmoTelefone(a, b) {
  const da = digitos(a), db = digitos(b);
  if (da.length < 8 || db.length < 8) return false;
  if (da.slice(-8) !== db.slice(-8)) return false;
  const x = dddDe(da), y = dddDe(db);
  return !x || !y || x === y;
}

const ROTULO_MIDIA = {
  audio: '[áudio]', ptt: '[áudio]', image: '[imagem]', video: '[vídeo]',
  document: '[documento]', sticker: '[figurinha]', contact: '[contato]', location: '[localização]',
};

/**
 * Converte o payload do webhook da uazapi no que interessa ao CRM. Devolve null
 * para o que não é mensagem de conversa individual. Exportado para teste.
 */
export function interpretarWebhook(body) {
  const evento = String(body?.EventType || body?.event || '').toLowerCase();
  if (evento && evento !== 'messages') return null;
  const msg = body?.message;
  if (!msg) return null;
  const chat = body?.chat || {};

  const chatId = String(msg.chatid || chat.wa_chatid || '');
  if (msg.isGroup || chat.wa_isGroup || chatId.endsWith('@g.us')) return null;
  if (chatId.includes('status@') || chatId.endsWith('@newsletter') || chatId.endsWith('@broadcast')) return null;
  const tipoMsg = String(msg.messageType || '');
  if (/revoke|reaction|protocol|edited/i.test(tipoMsg)) return null;

  const telefone = digitos(chatId.split('@')[0]);
  const messageId = String(msg.messageid || msg.id || '');
  if (!telefone || !messageId) return null;

  let ts = Number(msg.messageTimestamp || 0);
  if (ts > 1e12) ts = ts / 1000;
  const quando = ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();

  const tipoMidia = String(msg.mediaType || '').toLowerCase() || null;
  const texto = String(msg.text || (typeof msg.content === 'string' ? msg.content : '') || '').trim();

  return {
    telefone,
    messageId,
    doExecutivo: msg.fromMe === true,
    quando,
    tipoMidia,
    texto,
    nomeContato: String(chat.wa_name || chat.name || msg.senderName || '').trim(),
  };
}

/**
 * Conversa com alguém da equipe (usuário do CRM) não é atendimento de lead, mesmo
 * que o número tenha negócio de teste no CRM. 16/10: o "PRONTO" do André para o
 * Adonias entrou na conversa de teste do Adonias.
 */
async function ehDaEquipe(orgId, telefone) {
  const r = await query(
    `SELECT whatsapp FROM users
      WHERE organization_id = $1 AND COALESCE(whatsapp, '') <> ''
        AND right(REGEXP_REPLACE(whatsapp, '\\D', '', 'g'), 8) = right($2, 8)`,
    [orgId, telefone]
  );
  return r.rows.some((u) => mesmoTelefone(u.whatsapp, telefone));
}

/** Acha o negócio do lead pelo telefone. Sem negócio = não é lead → ignora. */
async function acharLead(orgId, telefone) {
  const r = await query(
    `SELECT c.id AS contact_id, c.name, c.phone, d.id AS deal_id
       FROM contacts c
       JOIN deals d ON d.contact_id = c.id AND d.organization_id = c.organization_id
      WHERE c.organization_id = $1
        AND right(REGEXP_REPLACE(c.phone, '\\D', '', 'g'), 8) = right($2, 8)
      ORDER BY (d.status = 'open') DESC, d.created_at DESC
      LIMIT 10`,
    [orgId, telefone]
  );
  const lead = r.rows.find((l) => mesmoTelefone(l.phone, telefone));
  if (!lead) return null;

  // A conversa da Rica com esse lead já tem uma chave (telefone como o bot
  // grava). Usar a mesma faz as mensagens do executivo caírem no MESMO thread.
  const k = await query(
    `SELECT rica_session_id FROM deal_messages
      WHERE organization_id = $1 AND deal_id = $2 AND rica_session_id <> ''
      ORDER BY occurred_at DESC LIMIT 1`,
    [orgId, lead.deal_id]
  );
  return { ...lead, chave: k.rows[0]?.rica_session_id || digitos(lead.phone) || telefone };
}

/** Baixa a mídia pela uazapi; áudio já volta transcrito. Nunca lança. */
async function baixarMidia(exec, messageId, tipoMidia) {
  if (!exec.token) return {};
  const ehAudio = tipoMidia === 'audio' || tipoMidia === 'ptt';
  const body = { id: messageId, return_link: true, transcribe: ehAudio };
  if (ehAudio && process.env.OPENAI_API_KEY) body.openai_apikey = process.env.OPENAI_API_KEY;
  try {
    const res = await fetch(`${UAZAPI_URL}/message/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: exec.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return {};
    const d = await res.json().catch(() => ({}));
    return { url: d.fileURL || null, mime: d.mimetype || null, transcricao: (d.transcription || '').trim() || null };
  } catch {
    return {};
  }
}

/**
 * Copia a mídia para o bucket público `media` (o link da uazapi é temporário).
 * Se falhar, fica o link original — melhor um link que expira do que nenhum.
 */
async function guardarMidia(orgId, exec, messageId, url, mime) {
  const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supaKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !supaUrl || !supaKey) return url;
  try {
    const arq = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!arq.ok) return url;
    const bytes = Buffer.from(await arq.arrayBuffer());
    const ext = (String(mime || '').split('/')[1] || 'bin').split(';')[0].slice(0, 5);
    const caminho = `whatsapp-executivo/${orgId}/${exec.slug}/${messageId.replace(/[^\w-]/g, '_')}.${ext}`;
    const up = await fetch(`${supaUrl}/storage/v1/object/media/${caminho}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${supaKey}`, apikey: supaKey,
        'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true',
      },
      body: bytes,
    });
    return up.ok ? `${supaUrl}/storage/v1/object/public/media/${caminho}` : url;
  } catch {
    return url;
  }
}

/**
 * Grava uma mensagem do WhatsApp do executivo no CRM.
 * Devolve { gravada: true } ou { ignorada: motivo }.
 */
export async function registrarMensagem(orgId, slug, m) {
  const exec = executivo(slug);
  if (!exec) return { ignorada: 'executivo não configurado' };
  if (!m) return { ignorada: 'não é mensagem de conversa' };

  if (await ehDaEquipe(orgId, m.telefone)) return { ignorada: 'contato não é lead no CRM' };
  const lead = await acharLead(orgId, m.telefone);
  if (!lead) return { ignorada: 'contato não é lead no CRM' };

  const externalId = `${exec.slug}:${m.messageId}`;
  const ja = await query(
    `SELECT 1 FROM deal_messages WHERE deal_id = $1 AND external_message_id = $2 LIMIT 1`,
    [lead.deal_id, externalId]
  );
  if (ja.rows.length) return { ignorada: 'já gravada' };

  let conteudo = m.texto;
  let mediaUrl = null;
  let mediaType = null;
  if (m.tipoMidia) {
    const midia = await baixarMidia(exec, m.messageId, m.tipoMidia);
    mediaType = midia.mime || m.tipoMidia;
    mediaUrl = await guardarMidia(orgId, exec, m.messageId, midia.url, midia.mime);
    const rotulo = ROTULO_MIDIA[m.tipoMidia] || '[mídia]';
    if (midia.transcricao) conteudo = `[Áudio transcrito]: ${midia.transcricao}`;
    else conteudo = m.texto ? `${rotulo} ${m.texto}` : rotulo;
  }
  if (!conteudo) return { ignorada: 'mensagem vazia' };

  const sender = m.doExecutivo ? 'executivo' : 'cliente';
  await query(
    `INSERT INTO deal_messages
       (organization_id, deal_id, role, channel, content, media_url, media_type,
        external_message_id, rica_session_id, metadata, occurred_at)
     VALUES ($1, $2, $3, 'whatsapp', $4, $5, $6, $7, $8, $9, $10::timestamptz)
     ON CONFLICT (deal_id, external_message_id) DO NOTHING`,
    [
      orgId, lead.deal_id, m.doExecutivo ? 'executive' : 'cliente', conteudo, mediaUrl, mediaType,
      externalId, lead.chave,
      JSON.stringify({
        direction: m.doExecutivo ? 'out' : 'in',
        sender,
        canal: 'whatsapp_executivo',
        executivo: exec.slug,
        executivo_nome: exec.nome,
      }),
      m.quando,
    ]
  );

  if (!m.doExecutivo) {
    await query(
      `UPDATE deals SET last_client_message_at = GREATEST(COALESCE(last_client_message_at, $2::timestamptz), $2::timestamptz)
        WHERE id = $1`,
      [lead.deal_id, m.quando]
    ).catch(() => {});
  }
  return { gravada: true, deal_id: lead.deal_id };
}
