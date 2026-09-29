/**
 * Página PÚBLICA de agendamento com o André (GPS, set/2026).
 *
 * A Rica manda ao lead o link /api/agendar/<token>. O lead vê só os horários
 * livres de hoje e do próximo dia útil (ou, se estiverem todos ocupados, só o
 * próximo dia disponível), escolhe um e a reunião de 30 min entra direto na
 * agenda Google do André. Se o lead informar o e-mail, o Google manda a ele o
 * convite nativo. A Rica NÃO manda mensagem depois: o rica-bot vê o
 * agendamento e avisa o André, que assume o contato (manual, seções 7 a 12).
 *
 * HTML puro, sem JavaScript (o helmet bloqueia script inline). Sem login: o
 * token aleatório de 144 bits é a autorização, e o link expira.
 */

import express, { Router } from 'express';
import { query } from '../services/database.js';
import { createCalendarEvent } from '../services/googleCalendar.js';
import { lerLink, fichaDoLead, descricaoDoEvento } from '../services/agenda-links.js';
import { resolverUsuario, slotsDoUsuario, rotulo, diaRecife } from './rica-agenda.js';

const router = Router();
router.use(express.urlencoded({ extended: false, limit: '4kb' }));

const PRODUTO = { gps: 'GPS Padaria', mentoria: 'Mentoria Padaria Lucrativa', jdl: 'Jornada Online' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function primeiroNome(ficha) {
  const n = String(ficha?.nome || ficha?.contact_name || '').trim();
  if (!n || /^\+?\d[\d\s-]+$/.test(n)) return '';
  return n.split(/\s+/)[0];
}

function pagina(titulo, corpo) {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="google" content="notranslate">
<title>${esc(titulo)}</title>
<style>
  :root { --bg:#f6f4ef; --card:#fff; --ink:#1f2a1f; --mute:#5f6b5f; --verde:#1f7a44; --verde-claro:#e5f3ea; --borda:#dcd8cf; --aviso:#fff4d6; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141814; --card:#1d231d; --ink:#eef2ee; --mute:#a7b3a7; --verde:#4cc47d; --verde-claro:#1f3527; --borda:#334033; --aviso:#3a3320; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  main { max-width:480px; margin:0 auto; padding:24px 16px 48px; }
  .card { background:var(--card); border:1px solid var(--borda); border-radius:14px; padding:20px; }
  h1 { font-size:1.3rem; margin:0 0 4px; }
  .sub { color:var(--mute); margin:0 0 16px; }
  h2 { font-size:1rem; margin:20px 0 8px; text-transform:capitalize; }
  .grade { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .grade label { display:block; }
  .grade input { position:absolute; opacity:0; }
  .grade span { display:block; text-align:center; padding:10px 0; border:1px solid var(--borda); border-radius:10px; cursor:pointer; font-weight:600; }
  .grade input:checked + span { background:var(--verde); border-color:var(--verde); color:#fff; }
  .grade input:focus-visible + span { outline:2px solid var(--verde); outline-offset:2px; }
  .campo { margin-top:20px; }
  .campo label { font-weight:600; display:block; margin-bottom:4px; }
  .campo small { color:var(--mute); display:block; margin-top:4px; }
  input[type=email] { width:100%; padding:10px 12px; border:1px solid var(--borda); border-radius:10px; font-size:16px; background:var(--card); color:var(--ink); }
  button { margin-top:20px; width:100%; padding:14px; border:0; border-radius:10px; background:var(--verde); color:#fff; font-size:1rem; font-weight:700; cursor:pointer; }
  .aviso { background:var(--aviso); border-radius:10px; padding:10px 12px; margin:0 0 12px; }
  .ok { background:var(--verde-claro); border-radius:10px; padding:14px; margin:12px 0; }
  .ok p { margin:4px 0; }
  footer { color:var(--mute); font-size:.85rem; text-align:center; margin-top:16px; }
</style></head>
<body><main><div class="card">${corpo}</div><footer>Sucesso na Padaria</footer></main></body></html>`;
}

function responder(res, status, titulo, corpo) {
  res.status(status).type('html').set('Cache-Control', 'no-store').send(pagina(titulo, corpo));
}

function dataHora(inicioIso) {
  const d = new Date(inicioIso);
  const local = new Date(d.getTime() - 3 * 3_600_000);
  const dd = String(local.getUTCDate()).padStart(2, '0');
  const mo = String(local.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mi = String(local.getUTCMinutes()).padStart(2, '0');
  return { data: `${dd}/${mo}`, hora: `${hh}:${mi}` };
}

function paginaConfirmada(res, link, ficha, comConvite) {
  const nome = primeiroNome(ficha);
  const { data, hora } = dataHora(link.inicio);
  return responder(res, 200, 'Horário reservado', `
    <h1>Perfeito${nome ? `, ${esc(nome)}` : ''}! ✅</h1>
    <p class="sub">Seu horário com o André está reservado.</p>
    <div class="ok">
      <p>📅 <strong>${esc(data)}</strong></p>
      <p>⏰ <strong>${esc(hora)}</strong></p>
      <p>⏱ Duração: aproximadamente 30 minutos</p>
    </div>
    <p>O André já recebeu o que você conversou com a Rica, para entrar na reunião sabendo o que você está buscando. Ele também vai falar com você no WhatsApp para se apresentar e confirmar a conversa. 😊</p>
    ${comConvite ? '<p class="sub">Você também vai receber o convite do Google Agenda no seu e-mail.</p>' : ''}`);
}

function paginaEncerrada(res, titulo, texto) {
  return responder(res, 200, titulo, `<h1>${esc(titulo)}</h1><p>${esc(texto)}</p>`);
}

/** Estado do link que impede novo agendamento, ou null se ainda pode agendar. */
async function bloqueio(res, link) {
  if (!link) {
    responder(res, 404, 'Link não encontrado', '<h1>Link não encontrado</h1><p>Confira se o link está completo. Se precisar, é só responder no WhatsApp.</p>');
    return true;
  }
  if (link.status === 'agendado') {
    paginaConfirmada(res, link, await fichaDoLead(link.organization_id, link.phone, link.campanha), false);
    return true;
  }
  if (new Date(link.expires_at).getTime() < Date.now()) {
    paginaEncerrada(res, 'Este link expirou',
      link.criado_por === 'andre'
        ? 'Fale com o André no WhatsApp que ele te envia um novo link.'
        : 'Responda a Rica no WhatsApp que ela te envia um novo link com os horários mais próximos.');
    return true;
  }
  return false;
}

async function montarFormulario(res, link, { erro } = {}) {
  const user = await resolverUsuario(link.organization_id, link.executivo_email);
  const r = user?.conectado ? await slotsDoUsuario(user.id, new Date(), link.duracao_min || 30, { excecao: true }) : null;
  if (!r || r.slots.length === 0) {
    return paginaEncerrada(res, 'Agenda indisponível no momento',
      'Não encontrei horários livres agora. Responda no WhatsApp que o André combina o melhor horário com você.');
  }

  // Agrupa por dia (o rótulo começa com "hoje (qua, 30/09) às 14:00").
  const dias = new Map();
  for (const s of r.slots) {
    const [dia, hora] = s.rotulo.split(' às ');
    if (!dias.has(dia)) dias.set(dia, []);
    dias.get(dia).push({ inicio: s.inicio, hora });
  }

  const grupos = [...dias.entries()].map(([dia, horas]) => `
    <h2>${esc(dia)}</h2>
    <div class="grade">${horas.map((h) => `
      <label><input type="radio" name="inicio" value="${esc(h.inicio)}" required><span>${esc(h.hora)}</span></label>`).join('')}
    </div>`).join('');

  const produto = PRODUTO[link.campanha] || 'Sucesso na Padaria';
  return responder(res, erro ? 409 : 200, 'Escolha seu horário com o André', `
    <h1>Conversa com o André</h1>
    <p class="sub">${esc(produto)} · 30 minutos · horário de Recife</p>
    ${r.excecao ? '<p class="aviso">Os horários mais próximos foram preenchidos. Estes são os do próximo dia disponível.</p>' : ''}
    ${erro ? `<p class="aviso">${esc(erro)}</p>` : ''}
    <form method="post">
      ${grupos}
      <div class="campo">
        <label for="email">Seu e-mail (opcional)</label>
        <input type="email" id="email" name="email" autocomplete="email" maxlength="200" placeholder="voce@email.com">
        <small>Se preencher, você recebe o convite do Google Agenda.</small>
      </div>
      <button type="submit">Confirmar horário</button>
    </form>`);
}

// GET /api/agendar/:token
router.get('/:token', async (req, res) => {
  try {
    const link = await lerLink(req.params.token);
    if (await bloqueio(res, link)) return;
    await montarFormulario(res, link);
  } catch (e) {
    console.warn('[agendar] GET falhou:', e.message);
    paginaEncerrada(res, 'Não consegui abrir a agenda', 'Tente de novo em alguns minutos ou responda no WhatsApp.');
  }
});

// POST /api/agendar/:token  (inicio, email)
router.post('/:token', async (req, res) => {
  let reservado = null;
  try {
    const link = await lerLink(req.params.token);
    if (await bloqueio(res, link)) return;

    const inicio = String(req.body?.inicio || '');
    const alvo = new Date(inicio).getTime();
    if (!Number.isFinite(alvo)) return montarFormulario(res, link, { erro: 'Escolha um dos horários abaixo.' });
    const emailBruto = String(req.body?.email || '').trim().toLowerCase();
    const email = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailBruto) && emailBruto.length <= 200 ? emailBruto : null;

    const user = await resolverUsuario(link.organization_id, link.executivo_email);
    if (!user?.conectado) return montarFormulario(res, link);
    const duracao = link.duracao_min || 30;
    const r = await slotsDoUsuario(user.id, new Date(), duracao, { excecao: true });
    if (!(r?.slots || []).some((s) => new Date(s.inicio).getTime() === alvo)) {
      return montarFormulario(res, link, { erro: 'Esse horário acabou de ser ocupado. Escolha outro, por favor.' });
    }

    // Reserva o link (evita dois eventos com clique duplo).
    const claim = await query(
      `UPDATE rica_agenda_links SET status = 'agendando' WHERE id = $1 AND status = 'enviado' RETURNING id`,
      [link.id]
    );
    if (!claim.rows.length) {
      if (await bloqueio(res, await lerLink(req.params.token))) return;
      return paginaEncerrada(res, 'Reservando seu horário', 'Seu horário está sendo reservado. Atualize esta página em alguns segundos.');
    }
    reservado = link.id;

    const ficha = await fichaDoLead(link.organization_id, link.phone, link.campanha);
    const nome = ficha?.nome || ficha?.contact_name || 'Lead';
    const produto = PRODUTO[link.campanha] || 'Reunião';
    const ev = await createCalendarEvent({
      userId: user.id,
      summary: `${produto} — ${nome}${ficha?.padaria ? ` (${ficha.padaria})` : ''}`,
      description: descricaoDoEvento(ficha, link.phone, link.criado_por),
      inicio: new Date(alvo),
      fim: new Date(alvo + duracao * 60_000),
      convidadoEmail: email,
    });

    const r2 = await query(
      `UPDATE rica_agenda_links
       SET status = 'agendado', inicio = $2, event_id = $3, lead_email = $4, agendado_at = NOW()
       WHERE id = $1 RETURNING *`,
      [link.id, new Date(alvo), ev.eventId, email]
    );
    reservado = null;

    if (link.deal_id) {
      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description, scheduled_at, duration_minutes, google_event_id, google_calendar_id, organization_id)
         VALUES ($1, $2, 'meeting', $3, $4, $5, $6, $7, $8)`,
        [link.deal_id, user.id,
          `Reunião ${produto} ${link.criado_por === 'andre' ? 'remarcada' : 'agendada'} pelo lead no link da agenda: ${rotulo(new Date(alvo), diaRecife(new Date()))}.`,
          new Date(alvo), duracao, ev.eventId, ev.calendarId, link.organization_id]
      ).catch((e) => console.warn('[agendar] atividade no deal falhou:', e.message));
    }

    return paginaConfirmada(res, r2.rows[0], ficha, Boolean(email));
  } catch (e) {
    console.warn('[agendar] POST falhou:', e.message);
    if (reservado) await query(`UPDATE rica_agenda_links SET status = 'enviado' WHERE id = $1 AND status = 'agendando'`, [reservado]).catch(() => {});
    paginaEncerrada(res, 'Não consegui confirmar', 'Algo falhou ao reservar o horário. Tente de novo em alguns minutos ou responda no WhatsApp.');
  }
});

export default router;
