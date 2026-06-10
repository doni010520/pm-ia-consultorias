import { Router } from 'express';
import { streamText } from 'ai';
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

export default router;
