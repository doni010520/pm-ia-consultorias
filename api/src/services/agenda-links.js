/**
 * Links de agendamento com o André (GPS, set/2026).
 *
 * "Manual de Programação RICA + GPS", seções 7 a 9: a Rica envia um LINK da
 * agenda do André; o lead escolhe um horário livre de hoje ou do próximo dia útil
 * e o evento de 30 min entra sozinho na agenda Google dele. Depois disso a Rica
 * sai da conversa: o rica-bot percebe o agendamento (status 'agendado' sem
 * processado_at) e manda o briefing ao André.
 *
 * O mesmo link serve para a REMARCAÇÃO: o André pede um link novo ao copiloto
 * (criado_por = 'andre') e manda ele mesmo ao cliente.
 */

import crypto from 'crypto';
import { query } from './database.js';
import { getAppUrl } from './googleCalendar.js';

/** Validade do link: o lead escolhe entre hoje e amanhã; 3 dias cobre fim de semana. */
const VALIDADE_HORAS = 72;

export function urlDoLink(token) {
  return `${String(getAppUrl()).replace(/\/+$/, '')}/api/agendar/${token}`;
}

export async function criarLinkAgenda({ orgId, executivoEmail, phone, campanha = 'gps', dealId, criadoPor = 'rica' }) {
  const tel = String(phone || '').replace(/\D/g, '');
  if (tel.length < 10) throw new Error('telefone do lead inválido');
  const token = crypto.randomBytes(18).toString('base64url');
  const expires = new Date(Date.now() + VALIDADE_HORAS * 3_600_000);
  await query(
    `INSERT INTO rica_agenda_links (organization_id, token, phone, campanha, executivo_email, deal_id, criado_por, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, token, tel, campanha, executivoEmail, dealId || null, criadoPor, expires]
  );
  return { token, url: urlDoLink(token), expires_at: expires.toISOString() };
}

export async function lerLink(token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(token || ''))) return null;
  const r = await query(`SELECT * FROM rica_agenda_links WHERE token = $1`, [token]);
  return r.rows[0] || null;
}

/** Ficha do lead gravada pela Rica (rica_lead_funil) para o evento na agenda. */
export async function fichaDoLead(orgId, phone, campanha) {
  const r = await query(
    `SELECT f.*, d.contact_name
     FROM rica_lead_funil f LEFT JOIN deals d ON d.id = f.deal_id
     WHERE f.organization_id = $1 AND f.phone = $2 AND f.campanha = $3
     LIMIT 1`,
    [orgId, phone, campanha]
  );
  return r.rows[0] || null;
}

/** Descrição do evento (seção 8: nome, WhatsApp, padaria, origem e resumo da dor/interesse). */
export function descricaoDoEvento(ficha, phone, criadoPor) {
  const f = ficha || {};
  const cabecalho = criadoPor === 'andre'
    ? 'Reunião de 30 min remarcada pelo link do André.'
    : 'Reunião de 30 min agendada pelo lead no link enviado pela Rica (WhatsApp).';
  const campos = [
    `Nome: ${f.nome || f.contact_name || '-'}`,
    `WhatsApp: https://wa.me/${phone}`,
    f.padaria ? `Empresa/Padaria: ${f.padaria}` : '',
    f.cidade ? `Cidade: ${f.cidade}` : '',
    f.papel ? `Cargo/Papel: ${f.papel}` : '',
    f.origem ? `Origem: ${f.origem}` : '',
    f.interesse_do_anuncio ? `Principal interesse: ${f.interesse_do_anuncio}` : '',
    f.dor_principal ? `Principal dor: ${f.dor_principal}` : '',
    f.categoria_dor ? `Categoria da dor: ${f.categoria_dor}` : '',
    f.objetivo_declarado ? `Objetivo: ${f.objetivo_declarado}` : '',
    f.classe ? `Classe: ${f.classe}` : '',
  ];
  return [cabecalho, '', ...campos.filter(Boolean)].join('\n');
}
