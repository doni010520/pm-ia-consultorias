/**
 * Traz para o CRM o histórico que a instância uazapi do executivo já tem
 * (conversas com leads). Idempotente: o que já foi gravado é pulado.
 *
 * Uso:  node src/scripts/backfill-whatsapp-executivo.js andre [--dias 30]
 * Precisa de DATABASE_URL, WA_EXECUTIVOS e (para áudio) OPENAI_API_KEY.
 */
import dotenv from 'dotenv';
import { initDatabase } from '../services/database.js';
import { executivo, interpretarWebhook, registrarMensagem } from '../services/whatsapp-executivo.js';

dotenv.config();

const UAZAPI_URL = (process.env.UAZAPI_URL || 'https://benitechlab.uazapi.com').replace(/\/+$/, '');
const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001';

const slug = process.argv[2];
const iDias = process.argv.indexOf('--dias');
const dias = iDias > 0 ? Number(process.argv[iDias + 1]) : 30;
const exec = executivo(slug);
if (!exec?.token) {
  console.error('Uso: node src/scripts/backfill-whatsapp-executivo.js <slug> [--dias N]  (slug precisa estar em WA_EXECUTIVOS com token)');
  process.exit(1);
}

async function uazapi(rota, body) {
  const res = await fetch(`${UAZAPI_URL}${rota}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: exec.token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${rota} → ${res.status}`);
  return res.json();
}

await initDatabase();
const desde = Date.now() - dias * 86400_000;
const contagem = { chats: 0, gravadas: 0, ignoradas: 0 };

for (let offset = 0; ; offset += 100) {
  const { chats = [] } = await uazapi('/chat/find', { operator: 'AND', sort: '-wa_lastMsgTimestamp', limit: 100, offset });
  if (!chats.length) break;
  let acabou = false;
  for (const chat of chats) {
    const ultima = Number(chat.wa_lastMsgTimestamp || 0);
    if (ultima && (ultima > 1e12 ? ultima : ultima * 1000) < desde) { acabou = true; break; }
    if (chat.wa_isGroup || !String(chat.wa_chatid || '').endsWith('@s.whatsapp.net')) continue;
    contagem.chats++;

    const { messages = [] } = await uazapi('/message/find', { chatid: chat.wa_chatid, limit: 500 });
    // Do mais antigo para o mais novo, como a conversa aconteceu.
    for (const message of messages.reverse()) {
      const r = await registrarMensagem(ORG_ID, exec.slug, interpretarWebhook({ EventType: 'messages', message, chat }));
      if (r.gravada) contagem.gravadas++;
      else contagem.ignoradas++;
      if (r.ignorada === 'contato não é lead no CRM') break; // o chat todo é de não-lead
    }
  }
  if (acabou) break;
}

console.log(`[backfill ${exec.slug}] ${contagem.chats} conversas lidas, ${contagem.gravadas} mensagens gravadas, ${contagem.ignoradas} puladas`);
process.exit(0);
