import { Router } from 'express';
import { streamText, generateText, tool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { query } from '../services/database.js';
import { buildSystemPrompt } from '../services/rica-system-prompt.js';
import { buildRicaTools } from '../services/rica-tools.js';

const router = Router();

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const HISTORY_LIMIT = 30;

// Ferramentas de SOMENTE LEITURA (copiloto via WhatsApp — sem ações de escrita)
const READ_ONLY_TOOLS = [
  'search_deals', 'get_deal', 'list_pipelines', 'list_users', 'list_activities',
  'list_tasks', 'list_projects', 'get_project', 'search_atas', 'get_ata',
  'get_team_capacity', 'get_user_calendar', 'relatorio_leads', 'relatorio_atendimentos',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function ensureSession(sessionId, user) {
  if (sessionId) {
    const existing = await query(
      `SELECT id FROM rica_crm_chat_sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, user.id]
    );
    if (existing.rows.length > 0) {
      await query(
        `UPDATE rica_crm_chat_sessions SET last_message_at = NOW() WHERE id = $1`,
        [sessionId]
      );
      return sessionId;
    }
  }

  const result = await query(
    `INSERT INTO rica_crm_chat_sessions (organization_id, user_id) VALUES ($1, $2) RETURNING id`,
    [user.organization_id, user.id]
  );
  return result.rows[0].id;
}

async function loadHistory(sessionId) {
  const result = await query(
    `SELECT role, content, tool_calls, tool_results
     FROM rica_crm_chat_messages
     WHERE session_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [sessionId, HISTORY_LIMIT]
  );
  return result.rows.reverse().map(r => {
    const msg = { role: r.role, content: r.content || '' };
    if (r.tool_calls) msg.tool_calls = r.tool_calls;
    if (r.tool_results) msg.tool_results = r.tool_results;
    return msg;
  });
}

async function saveMessages(sessionId, messages) {
  for (const msg of messages) {
    if (!msg.role || !['user', 'assistant', 'tool'].includes(msg.role)) continue;
    await query(
      `INSERT INTO rica_crm_chat_messages (session_id, role, content, tool_calls, tool_results)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        sessionId,
        msg.role,
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.tool_results ? JSON.stringify(msg.tool_results) : null,
      ]
    ).catch(() => {}); // fire and forget
  }
}

// ── POST /api/rica/chat ───────────────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const { messages = [], session_id } = req.body;
    const user = req.user;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages é obrigatório' } });
    }

    // Ensure valid session
    const activeSessionId = await ensureSession(session_id, user);

    // Load history and merge with incoming
    const history = await loadHistory(activeSessionId);
    const lastUserMsg = messages[messages.length - 1];

    // Merge: history (server truth) + last user message
    const allMessages = [...history, lastUserMsg].filter(Boolean);

    // Build system prompt with org context
    const systemPrompt = await buildSystemPrompt(user);

    // Build tools scoped to this user/org
    const tools = buildRicaTools(user);

    // Stream response
    const result = streamText({
      model: openai(MODEL),
      system: systemPrompt,
      messages: allMessages,
      tools,
      maxSteps: 8,
      temperature: 0.3,
      onFinish: async ({ text, usage }) => {
        // Persist the new messages to DB
        const newMessages = [
          lastUserMsg,
          { role: 'assistant', content: text },
        ];
        await saveMessages(activeSessionId, newMessages);

        // Auto-title session on first real message
        if (history.length === 0 && text.length > 0) {
          const title = lastUserMsg.content?.slice(0, 80) || 'Nova conversa';
          await query(
            `UPDATE rica_crm_chat_sessions SET title = $1 WHERE id = $2`,
            [title, activeSessionId]
          ).catch(() => {});
        }
      },
    });

    // Set session ID header so frontend can persist it
    res.setHeader('X-Rica-Session-Id', activeSessionId);
    res.setHeader('Access-Control-Expose-Headers', 'X-Rica-Session-Id');

    // Pipe the AI data stream to the Express response
    result.pipeDataStreamToResponse(res);
  } catch (error) {
    next(error);
  }
});

// ── GET /api/rica/chat/session — nova sessão ou retorna existente ────────────

router.get('/session', async (req, res, next) => {
  try {
    const user = req.user;
    const { session_id } = req.query;

    const activeSessionId = await ensureSession(session_id, user);
    const history = await loadHistory(activeSessionId);

    res.json({ session_id: activeSessionId, history });
  } catch (error) {
    next(error);
  }
});

// ── DELETE /api/rica/chat/session — limpa histórico ──────────────────────────

router.delete('/session/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await query(
      `DELETE FROM rica_crm_chat_messages WHERE session_id = $1 AND session_id IN (
         SELECT id FROM rica_crm_chat_sessions WHERE user_id = $2
       )`,
      [id, req.user.id]
    );
    await query(
      `UPDATE rica_crm_chat_sessions SET title = NULL, last_message_at = NOW() WHERE id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    res.json({ cleared: true });
  } catch (error) {
    next(error);
  }
});

// ── POST /ask — Rica copiloto via WhatsApp (não-streaming, somente leitura) ──
// O bot chama este endpoint para CADA mensagem. Se o telefone for de um membro
// do time (users.whatsapp), responde com dados do CRM; senão retorna is_team:false
// e o bot segue o fluxo normal de atendimento ao lead.
router.post('/ask', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId || req.query.organization_id;
    const { phone, message, history } = req.body || {};
    if (!phone || !message) {
      return res.status(400).json({ error: { message: 'phone e message são obrigatórios' } });
    }

    // Histórico recente (mandado pelo bot) — dá memória curta ao copiloto, ex:
    // lead numa mensagem e "envia pro André" na próxima. Sanitiza o formato.
    const priorMessages = Array.isArray(history)
      ? history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }))
      : [];

    // Resolve membro do time pelo telefone (allowlist = quem tem users.whatsapp setado).
    // Match TOLERANTE ao 9o digito: compara DDD (2 chars apos o 55) + ultimos 8 digitos.
    const u = await query(
      `SELECT id, name, email, role, organization_id FROM users
       WHERE organization_id = $1 AND is_active = true AND whatsapp IS NOT NULL
         AND right(regexp_replace(whatsapp, '\\D', '', 'g'), 8) = right(regexp_replace($2, '\\D', '', 'g'), 8)
         AND substring(regexp_replace(whatsapp, '\\D', '', 'g') from 3 for 2)
           = substring(regexp_replace($2, '\\D', '', 'g') from 3 for 2)
       LIMIT 1`,
      [orgId, phone]
    );
    if (u.rows.length === 0) {
      return res.json({ is_team: false });
    }
    const user = u.rows[0];

    // Ferramentas de leitura + a ação de ENCAMINHAR LEAD (executada pelo bot).
    const allTools = buildRicaTools(user);
    const tools = {};
    for (const name of READ_ONLY_TOOLS) {
      if (allTools[name]) tools[name] = allTools[name];
    }

    // O copiloto não envia WhatsApp daqui; ele registra a INTENÇÃO de encaminhar
    // e o bot (que tem o telefone dos executivos e o sendWhatsApp) executa.
    let pendingAction = null;
    tools.encaminhar_lead = tool({
      description:
        'Encaminha um lead para um executivo/consultor. Use quando o membro do time pedir para ENVIAR/MANDAR/ENCAMINHAR/PASSAR um lead a alguém (ex: "envia esse lead pro André"). ' +
        'O telefone do lead é OBRIGATÓRIO — se não tiver, peça. Junte também nome, produto/interesse e o executivo de destino quando informados. ' +
        'Se o time não disser o executivo, deixe vazio que o sistema roteia pelo produto/região.',
      parameters: z.object({
        telefone: z.string().describe('Telefone do lead com DDD (ex: 11965869590). Obrigatório.'),
        executivo: z.string().optional().describe('Nome do executivo de destino (ex: André, Patrícia). Vazio = roteia por produto/região.'),
        nome: z.string().optional().describe('Nome do lead, se informado.'),
        produto: z.string().optional().describe('Produto/interesse do lead (ex: GPS, Eneagrama, padaria).'),
        empresa: z.string().optional().describe('Empresa do lead, se informada.'),
      }),
      execute: async (args) => {
        pendingAction = { type: 'encaminhar_lead', ...args, solicitante: user.name };
        return {
          status: 'encaminhando',
          detalhe: `Encaminhando ${args.nome || args.telefone} para ${args.executivo || 'o executivo certo (por produto/região)'}.`,
        };
      },
    });

    const systemPrompt = (await buildSystemPrompt(user)) +
      '\n\nCANAL: você está respondendo um MEMBRO DO TIME pelo WhatsApp (não é um cliente/lead). ' +
      'Responda CURTO e direto, em formato de mensagem de WhatsApp (use no máximo *negrito*, sem tabelas). ' +
      'Você PODE consultar dados e ENCAMINHAR leads para executivos (tool encaminhar_lead). ' +
      'Para encaminhar, você precisa do TELEFONE do lead — se não tiver, peça. ' +
      'Outras alterações (mover etapa, editar lead) ainda são feitas pelo app.';

    const result = await generateText({
      model: openai(MODEL),
      system: systemPrompt,
      messages: [...priorMessages, { role: 'user', content: String(message) }],
      tools,
      maxSteps: 6,
      temperature: 0.3,
    });

    return res.json({
      is_team: true,
      answer: result.text || (pendingAction ? 'Ok, encaminhando…' : 'Não consegui gerar uma resposta agora.'),
      action: pendingAction,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
