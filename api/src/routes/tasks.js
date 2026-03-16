import { Router } from 'express';
import { getTasks, createTask, findUserByName, updateTask } from '../services/database.js';
import { extractTaskFromMessage } from '../services/ai.js';

const router = Router();

/**
 * GET /api/tasks
 * Lista tarefas com filtros
 */
router.get('/', async (req, res, next) => {
  try {
    const { organization_id, project_id, assignee_id, status, limit } = req.query;
    
    const tasks = await getTasks({
      organization_id: organization_id || process.env.DEFAULT_ORGANIZATION_ID,
      project_id,
      assignee_id,
      status,
      limit: parseInt(limit) || 50
    });
    
    res.json({ tasks, count: tasks.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tasks
 * Cria nova tarefa (manual)
 */
router.post('/', async (req, res, next) => {
  try {
    const {
      organization_id,
      project_id,
      title,
      description,
      assignee_id,
      due_date,
      priority
    } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: { message: 'Título é obrigatório' } });
    }
    
    const task = await createTask({
      organization_id: organization_id || process.env.DEFAULT_ORGANIZATION_ID,
      project_id,
      title,
      description,
      assignee_id,
      due_date,
      priority: priority || 'normal',
      source: 'api',
      ai_confidence: null
    });
    
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tasks/extract
 * Extrai tarefa de texto usando IA
 */
router.post('/extract', async (req, res, next) => {
  try {
    const { message, organization_id, sender_name, sender_whatsapp } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: { message: 'Mensagem é obrigatória' } });
    }
    
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    
    // Buscar membros da equipe para contexto
    const { getTeamMembers } = await import('../services/database.js');
    const teamMembers = await getTeamMembers(orgId);
    const membersList = teamMembers.map(m => `- ${m.name}`).join('\n');
    
    // Extrair com IA
    const result = await extractTaskFromMessage(message, {
      organizationName: 'Consultoria',
      senderName: sender_name || 'Usuário',
      senderWhatsapp: sender_whatsapp || '',
      teamMembers: membersList
    });
    
    if (!result.success) {
      return res.status(500).json({ error: { message: 'Erro na extração', details: result.error } });
    }
    
    const extracted = result.parsed;
    
    // Se tiver responsável, buscar ID
    let assigneeId = null;
    if (extracted.assignee) {
      const matches = await findUserByName(orgId, extracted.assignee);
      if (matches.length > 0) {
        assigneeId = matches[0].user_id;
        extracted.assignee_id = assigneeId;
        extracted.assignee_name = matches[0].user_name;
      }
    }
    
    res.json({
      extracted,
      needs_confirmation: extracted.confidence < 70 || extracted.needs_confirmation,
      model: result.model,
      latency_ms: result.latency
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/tasks/from-extraction
 * Cria tarefa a partir de dados extraídos
 */
router.post('/from-extraction', async (req, res, next) => {
  try {
    const { extracted, organization_id } = req.body;
    
    if (!extracted || !extracted.title) {
      return res.status(400).json({ error: { message: 'Dados de extração inválidos' } });
    }
    
    const task = await createTask({
      organization_id: organization_id || process.env.DEFAULT_ORGANIZATION_ID,
      project_id: extracted.project_id || null,
      title: extracted.title,
      description: extracted.description,
      assignee_id: extracted.assignee_id || null,
      due_date: extracted.due_date,
      priority: extracted.priority || 'normal',
      source: 'whatsapp',
      ai_confidence: extracted.confidence
    });
    
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/tasks/:id
 * Atualiza tarefa
 */
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, assignee_id, due_date, priority, project_id } = req.body;

    const task = await updateTask(id, { title, description, assignee_id, due_date, priority, project_id });

    if (!task) {
      return res.status(404).json({ error: { message: 'Tarefa não encontrada' } });
    }

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/tasks/:id/status
 * Atualiza status da tarefa
 */
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['todo', 'in_progress', 'review', 'done', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: { message: `Status inválido. Use: ${validStatuses.join(', ')}` }
      });
    }

    const task = await updateTask(id, { status });

    if (!task) {
      return res.status(404).json({ error: { message: 'Tarefa não encontrada' } });
    }

    res.json({ task });
  } catch (error) {
    next(error);
  }
});

export default router;
