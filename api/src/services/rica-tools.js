import { tool } from 'ai';
import { z } from 'zod';
import { query, createTask, getTasks } from './database.js';
import { relatorioCampanhas, resolverPeriodo, resolverCampanha, CAMPANHAS, ETAPAS_DA_LISTA } from './campanhas.js';
import { blindarTools } from './blindagem.js';
import {
  fetchAllConsultantsData,
  generateDayCapacities,
  aggregateByWeek,
} from './capacity.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function orgFilter(orgId) {
  return orgId;
}

// Converte Date/string para 'YYYY-MM-DD' (mesmo formato usado por capacity.js)
function toDateStr(date) {
  if (!date) return null;
  if (typeof date === 'string') return date.substring(0, 10);
  return new Date(date).toISOString().substring(0, 10);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ─── Factory principal ───────────────────────────────────────────────────────

export function buildRicaTools(user) {
  const orgId = user.organization_id;
  const userId = user.id;

  // ── CRM — LEITURA ───────────────────────────────────────────────────────

  const search_deals = tool({
    description: 'Busca leads/deals por nome/empresa/telefone e/ou filtros. Para "meus leads"/"minha carteira" use owner_id com o id do usuário logado. Use antes de qualquer ação em um lead.',
    parameters: z.object({
      search: z.string().optional().describe('Nome do contato, empresa ou parte do telefone. Omita para listar sem busca textual (ex: ao filtrar só por owner_id).'),
      owner_id: z.string().optional().describe('ID do responsável (owner). Para "meus leads", passe o user_id do usuário logado.'),
      status: z.enum(['open', 'won', 'lost']).optional().describe('Filtrar por status'),
      pipeline_id: z.string().optional().describe('ID do funil para filtrar'),
      limit: z.number().int().min(1).max(20).optional().default(10),
    }),
    execute: async ({ search, owner_id, status, pipeline_id, limit }) => {
      let sql = `
        SELECT d.id, d.title, d.contact_name, d.contact_phone, d.company_name,
               d.status, d.temperature, d.value,
               ps.name as stage_name, p.name as pipeline_name,
               u.name as owner_name
        FROM deals d
        LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
        LEFT JOIN pipelines p ON p.id = d.pipeline_id
        LEFT JOIN users u ON u.id = d.owner_id
        WHERE d.organization_id = $1`;
      const params = [orgId];
      let idx = 2;

      if (search) {
        sql += ` AND (d.title ILIKE $${idx} OR d.contact_name ILIKE $${idx} OR d.company_name ILIKE $${idx} OR d.contact_phone ILIKE $${idx})`;
        params.push(`%${search}%`);
        idx++;
      }
      if (owner_id) { sql += ` AND d.owner_id = $${idx++}`; params.push(owner_id); }
      if (status) { sql += ` AND d.status = $${idx++}`; params.push(status); }
      if (pipeline_id) { sql += ` AND d.pipeline_id = $${idx++}`; params.push(pipeline_id); }
      sql += ` ORDER BY d.updated_at DESC LIMIT $${idx}`;
      params.push(limit);

      const result = await query(sql, params);
      return { deals: result.rows, count: result.rows.length };
    },
  });

  const get_deal = tool({
    description: 'Retorna detalhes completos de um lead/deal: contato, empresa, etapa, responsável, valor, temperatura e últimas atividades.',
    parameters: z.object({
      deal_id: z.string().uuid().describe('ID do deal'),
    }),
    execute: async ({ deal_id }) => {
      const [dealResult, activitiesResult] = await Promise.all([
        query(
          `SELECT d.*, ps.name as stage_name, ps.is_won, ps.is_lost,
                  p.name as pipeline_name, u.name as owner_name
           FROM deals d
           LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
           LEFT JOIN pipelines p ON p.id = d.pipeline_id
           LEFT JOIN users u ON u.id = d.owner_id
           WHERE d.id = $1 AND d.organization_id = $2`,
          [deal_id, orgId]
        ),
        query(
          `SELECT type, description, created_at, outcome
           FROM deal_activities WHERE deal_id = $1
           ORDER BY created_at DESC LIMIT 5`,
          [deal_id]
        ),
      ]);

      if (dealResult.rows.length === 0) return { error: 'Deal não encontrado' };
      return { deal: dealResult.rows[0], recent_activities: activitiesResult.rows };
    },
  });

  const list_pipelines = tool({
    description: 'Lista todos os funis ativos com suas etapas. Use para descobrir IDs de funis e etapas.',
    parameters: z.object({}),
    execute: async () => {
      const result = await query(
        `SELECT p.id, p.name, p.position,
                json_agg(json_build_object(
                  'id', ps.id, 'name', ps.name, 'position', ps.position,
                  'is_won', ps.is_won, 'is_lost', ps.is_lost
                ) ORDER BY ps.position) as stages
         FROM pipelines p
         LEFT JOIN pipeline_stages ps ON ps.pipeline_id = p.id
         WHERE p.organization_id = $1 AND p.is_active = true
         GROUP BY p.id, p.name, p.position
         ORDER BY p.position`,
        [orgId]
      );
      return { pipelines: result.rows };
    },
  });

  const list_users = tool({
    description: 'Lista usuários/executivos ativos da organização. Use para descobrir IDs de usuários ao atribuir responsáveis.',
    parameters: z.object({}),
    execute: async () => {
      const result = await query(
        `SELECT id, name, email, role FROM users WHERE organization_id = $1 AND is_active = true ORDER BY name`,
        [orgId]
      );
      return { users: result.rows };
    },
  });

  const list_activities = tool({
    description: 'Lista o histórico de atividades de um lead (ligações, notas, reuniões, etc).',
    parameters: z.object({
      deal_id: z.string().uuid().describe('ID do deal'),
      limit: z.number().int().min(1).max(30).optional().default(10),
    }),
    execute: async ({ deal_id, limit }) => {
      const result = await query(
        `SELECT da.*, u.name as user_name
         FROM deal_activities da
         LEFT JOIN users u ON u.id = da.user_id
         WHERE da.deal_id = $1
         ORDER BY da.created_at DESC LIMIT $2`,
        [deal_id, limit]
      );
      return { activities: result.rows };
    },
  });

  // ── CRM — ESCRITA ────────────────────────────────────────────────────────

  const move_to_stage = tool({
    description: 'Move um lead para uma etapa específica. Com confirmed=false retorna uma prévia; com confirmed=true executa a mudança.',
    parameters: z.object({
      deal_id: z.string().uuid().describe('ID do deal'),
      stage_id: z.string().uuid().describe('ID da etapa de destino'),
      confirmed: z.boolean().describe('false=prévia apenas, true=executar de verdade'),
    }),
    execute: async ({ deal_id, stage_id, confirmed }) => {
      const [dealRes, stageRes] = await Promise.all([
        query(`SELECT contact_name, title FROM deals WHERE id = $1 AND organization_id = $2`, [deal_id, orgId]),
        query(`SELECT name, is_won, is_lost, pipeline_id FROM pipeline_stages WHERE id = $1`, [stage_id]),
      ]);
      const deal = dealRes.rows[0];
      const stage = stageRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };
      if (!stage) return { error: 'Etapa não encontrada.' };

      const leadName = deal.contact_name || deal.title;
      const description = `Mover lead "${leadName}" para a etapa "${stage.name}"`;

      if (!confirmed) return { status: 'preview', description };

      let statusUpdate = `, status = 'open'`;
      if (stage.is_won) statusUpdate = `, status = 'won', won_date = NOW()`;
      if (stage.is_lost) statusUpdate = `, status = 'lost', lost_date = NOW()`;

      await query(
        `UPDATE deals SET pipeline_stage_id = $1, stage_entered_at = NOW()${statusUpdate}, updated_at = NOW()
         WHERE id = $2 AND organization_id = $3`,
        [stage_id, deal_id, orgId]
      );
      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description)
         VALUES ($1, $2, 'stage_change', $3)`,
        [deal_id, userId, `Movido para etapa: ${stage.name} (via Rica)`]
      );
      return { status: 'done', message: `Lead "${leadName}" movido para "${stage.name}" com sucesso.` };
    },
  });

  const move_to_pipeline = tool({
    description: 'Move um lead para um funil diferente. Com confirmed=false retorna prévia; com confirmed=true executa.',
    parameters: z.object({
      deal_id: z.string().uuid(),
      pipeline_id: z.string().uuid().describe('ID do funil de destino'),
      confirmed: z.boolean(),
    }),
    execute: async ({ deal_id, pipeline_id, confirmed }) => {
      const [dealRes, pipelineRes] = await Promise.all([
        query(`SELECT contact_name, title, pipeline_id FROM deals WHERE id = $1 AND organization_id = $2`, [deal_id, orgId]),
        query(`SELECT name, id FROM pipelines WHERE id = $1`, [pipeline_id]),
      ]);
      const deal = dealRes.rows[0];
      const pipeline = pipelineRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };
      if (!pipeline) return { error: 'Funil não encontrado.' };

      const leadName = deal.contact_name || deal.title;
      const description = `Mover lead "${leadName}" para o funil "${pipeline.name}"`;

      if (!confirmed) return { status: 'preview', description };

      const firstStage = await query(
        `SELECT id FROM pipeline_stages WHERE pipeline_id = $1 ORDER BY position LIMIT 1`,
        [pipeline_id]
      );
      const newStageId = firstStage.rows[0]?.id || null;

      await query(
        `UPDATE deals SET pipeline_id = $1, pipeline_stage_id = $2, stage_entered_at = NOW(), updated_at = NOW()
         WHERE id = $3 AND organization_id = $4`,
        [pipeline_id, newStageId, deal_id, orgId]
      );
      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description)
         VALUES ($1, $2, 'note', $3)`,
        [deal_id, userId, `Movido para funil: ${pipeline.name} (via Rica)`]
      );
      return { status: 'done', message: `Lead "${leadName}" movido para o funil "${pipeline.name}".` };
    },
  });

  const assign_owner = tool({
    description: 'Atribui um responsável (owner) a um lead. Com confirmed=false retorna prévia; com confirmed=true executa.',
    parameters: z.object({
      deal_id: z.string().uuid(),
      owner_id: z.string().uuid().describe('ID do usuário responsável'),
      confirmed: z.boolean(),
    }),
    execute: async ({ deal_id, owner_id, confirmed }) => {
      const [dealRes, ownerRes] = await Promise.all([
        query(`SELECT contact_name, title FROM deals WHERE id = $1 AND organization_id = $2`, [deal_id, orgId]),
        query(`SELECT name FROM users WHERE id = $1 AND organization_id = $2`, [owner_id, orgId]),
      ]);
      const deal = dealRes.rows[0];
      const owner = ownerRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };
      if (!owner) return { error: 'Usuário não encontrado.' };

      const leadName = deal.contact_name || deal.title;
      const description = `Atribuir lead "${leadName}" para ${owner.name}`;

      if (!confirmed) return { status: 'preview', description };

      await query(
        `UPDATE deals SET owner_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
        [owner_id, deal_id, orgId]
      );
      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description)
         VALUES ($1, $2, 'note', $3)`,
        [deal_id, userId, `Responsável alterado para ${owner.name} (via Rica)`]
      );
      return { status: 'done', message: `Lead "${leadName}" atribuído a ${owner.name}.` };
    },
  });

  const update_deal = tool({
    description: 'Atualiza campos de um lead: valor, temperatura (hot/warm/cold), título, telefone, etc. Com confirmed=false retorna prévia; com confirmed=true executa.',
    parameters: z.object({
      deal_id: z.string().uuid(),
      fields: z.object({
        title: z.string().optional(),
        value: z.number().optional().describe('Valor em reais'),
        temperature: z.enum(['hot', 'warm', 'cold']).optional(),
        contact_name: z.string().optional(),
        contact_phone: z.string().optional(),
        contact_email: z.string().optional(),
        probability: z.number().min(0).max(100).optional(),
        lost_reason: z.string().optional(),
      }),
      confirmed: z.boolean(),
    }),
    execute: async ({ deal_id, fields, confirmed }) => {
      const dealRes = await query(
        `SELECT contact_name, title FROM deals WHERE id = $1 AND organization_id = $2`,
        [deal_id, orgId]
      );
      const deal = dealRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };

      const leadName = deal.contact_name || deal.title;
      const changeList = Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k} = "${v}"`)
        .join(', ');
      const description = `Atualizar lead "${leadName}": ${changeList}`;

      if (!confirmed) return { status: 'preview', description };

      const allowed = ['title', 'value', 'temperature', 'contact_name', 'contact_phone', 'contact_email', 'probability', 'lost_reason'];
      const setClauses = [];
      const values = [];
      let idx = 1;
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          setClauses.push(`${key} = $${idx++}`);
          values.push(fields[key]);
        }
      }
      if (setClauses.length === 0) return { error: 'Nenhum campo para atualizar.' };
      setClauses.push('updated_at = NOW()');
      values.push(deal_id, orgId);

      await query(
        `UPDATE deals SET ${setClauses.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx}`,
        values
      );
      return { status: 'done', message: `Lead "${leadName}" atualizado: ${changeList}.` };
    },
  });

  const create_note = tool({
    description: 'Registra uma nota/observação no lead. Com confirmed=false retorna prévia; com confirmed=true salva.',
    parameters: z.object({
      deal_id: z.string().uuid(),
      note: z.string().describe('Conteúdo da nota'),
      confirmed: z.boolean(),
    }),
    execute: async ({ deal_id, note, confirmed }) => {
      const dealRes = await query(
        `SELECT contact_name, title FROM deals WHERE id = $1 AND organization_id = $2`,
        [deal_id, orgId]
      );
      const deal = dealRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };

      const leadName = deal.contact_name || deal.title;
      const description = `Adicionar nota no lead "${leadName}": "${note.slice(0, 80)}${note.length > 80 ? '...' : ''}"`;

      if (!confirmed) return { status: 'preview', description };

      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description)
         VALUES ($1, $2, 'note', $3)`,
        [deal_id, userId, note]
      );
      await query(`UPDATE deals SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1`, [deal_id]);
      return { status: 'done', message: `Nota registrada no lead "${leadName}".` };
    },
  });

  const schedule_followup = tool({
    description: 'Agenda um follow-up (ligação, reunião, tarefa) para um lead. Com confirmed=false retorna prévia; com confirmed=true agenda.',
    parameters: z.object({
      deal_id: z.string().uuid(),
      type: z.enum(['call', 'meeting', 'task']).describe('Tipo de atividade'),
      description: z.string().describe('O que deve ser feito'),
      scheduled_at: z.string().describe('Data/hora no formato ISO 8601 ou descrição como "amanhã 14h"'),
      confirmed: z.boolean(),
    }),
    execute: async ({ deal_id, type, description: desc, scheduled_at, confirmed }) => {
      const dealRes = await query(
        `SELECT contact_name, title FROM deals WHERE id = $1 AND organization_id = $2`,
        [deal_id, orgId]
      );
      const deal = dealRes.rows[0];
      if (!deal) return { error: 'Lead não encontrado.' };

      const leadName = deal.contact_name || deal.title;
      const previewDesc = `Agendar ${type} "${desc}" para o lead "${leadName}" em ${scheduled_at}`;

      if (!confirmed) return { status: 'preview', description: previewDesc };

      let scheduledDate = null;
      try { scheduledDate = new Date(scheduled_at).toISOString(); } catch { scheduledDate = null; }

      await query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description, scheduled_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [deal_id, userId, type, desc, scheduledDate]
      );
      return { status: 'done', message: `Follow-up "${desc}" agendado para o lead "${leadName}".` };
    },
  });

  // ── TAREFAS — LEITURA ────────────────────────────────────────────────────

  const list_tasks = tool({
    description: 'Lista tarefas com filtros. Pode filtrar por status, projeto, responsável e se estão atrasadas.',
    parameters: z.object({
      assignee_id: z.string().uuid().optional().describe('ID do responsável (omitir para ver todas)'),
      status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
      project_id: z.string().uuid().optional(),
      overdue_only: z.boolean().optional().describe('Apenas tarefas atrasadas'),
      limit: z.number().int().min(1).max(30).optional().default(15),
    }),
    execute: async ({ assignee_id, status, project_id, overdue_only, limit }) => {
      let sql = `
        SELECT t.id, t.title, t.status, t.priority, t.due_date, t.created_at,
               u.name as assignee_name, p.name as project_name
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE t.organization_id = $1`;
      const params = [orgId];
      let idx = 2;

      if (assignee_id) { sql += ` AND t.assignee_id = $${idx++}`; params.push(assignee_id); }
      if (status) { sql += ` AND t.status = $${idx++}`; params.push(status); }
      if (project_id) { sql += ` AND t.project_id = $${idx++}`; params.push(project_id); }
      if (overdue_only) { sql += ` AND t.due_date < NOW() AND t.status NOT IN ('done','cancelled')`; }

      sql += ` ORDER BY t.due_date ASC NULLS LAST, t.priority DESC LIMIT $${idx}`;
      params.push(limit);

      const result = await query(sql, params);
      return { tasks: result.rows, count: result.rows.length };
    },
  });

  const list_projects = tool({
    description: 'Lista projetos ativos da organização com métricas básicas.',
    parameters: z.object({
      status: z.enum(['active', 'paused', 'completed', 'cancelled']).optional(),
    }),
    execute: async ({ status }) => {
      let sql = `
        SELECT p.id, p.name, p.status, p.priority, p.due_date, p.progress_percent,
               c.name as client_name,
               (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status NOT IN ('done','cancelled')) as open_tasks
        FROM projects p
        LEFT JOIN clients c ON c.id = p.client_id
        WHERE p.organization_id = $1`;
      const params = [orgId];
      if (status) { sql += ` AND p.status = $2`; params.push(status); }
      else { sql += ` AND p.status IN ('active', 'paused')`; }
      sql += ` ORDER BY p.due_date ASC NULLS LAST`;

      const result = await query(sql, params);
      return { projects: result.rows };
    },
  });

  const get_project = tool({
    description: 'Retorna detalhes de um projeto: descrição, status, tarefas em aberto e atrasadas.',
    parameters: z.object({
      project_id: z.string().uuid(),
    }),
    execute: async ({ project_id }) => {
      const [projRes, tasksRes] = await Promise.all([
        query(
          `SELECT p.*, c.name as client_name FROM projects p
           LEFT JOIN clients c ON c.id = p.client_id
           WHERE p.id = $1 AND p.organization_id = $2`,
          [project_id, orgId]
        ),
        query(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date, u.name as assignee_name
           FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
           WHERE t.project_id = $1 AND t.status NOT IN ('done','cancelled')
           ORDER BY t.due_date ASC NULLS LAST LIMIT 20`,
          [project_id]
        ),
      ]);
      if (projRes.rows.length === 0) return { error: 'Projeto não encontrado.' };
      return { project: projRes.rows[0], open_tasks: tasksRes.rows };
    },
  });

  // ── TAREFAS — ESCRITA ────────────────────────────────────────────────────

  const create_task = tool({
    description: 'Cria uma nova tarefa. Com confirmed=false retorna prévia; com confirmed=true cria de verdade.',
    parameters: z.object({
      title: z.string().describe('Título da tarefa'),
      description: z.string().optional(),
      assignee_id: z.string().uuid().optional().describe('ID do responsável'),
      project_id: z.string().uuid().optional(),
      deal_id: z.string().uuid().optional().describe('ID do lead, se relacionado'),
      due_date: z.string().optional().describe('Data de entrega no formato ISO 8601'),
      priority: z.number().int().min(1).max(5).optional().default(3),
      confirmed: z.boolean(),
    }),
    execute: async ({ title, description: desc, assignee_id, project_id, deal_id, due_date, priority, confirmed }) => {
      let assigneeName = 'sem responsável';
      if (assignee_id) {
        const r = await query(`SELECT name FROM users WHERE id = $1`, [assignee_id]);
        assigneeName = r.rows[0]?.name || assignee_id;
      }
      const previewDesc = `Criar tarefa "${title}" para ${assigneeName}${due_date ? ` com prazo ${due_date}` : ''}`;

      if (!confirmed) return { status: 'preview', description: previewDesc };

      const task = await createTask({
        organization_id: orgId,
        project_id: project_id || null,
        deal_id: deal_id || null,
        title,
        description: desc || null,
        assignee_id: assignee_id || null,
        due_date: due_date || null,
        priority: priority || 3,
        source: 'rica_chat',
        ai_confidence: null,
      });
      return { status: 'done', message: `Tarefa "${title}" criada com sucesso.`, task_id: task.id };
    },
  });

  const update_task = tool({
    description: 'Atualiza status, responsável, prazo ou prioridade de uma tarefa. Com confirmed=false retorna prévia; com confirmed=true executa.',
    parameters: z.object({
      task_id: z.string().uuid(),
      fields: z.object({
        status: z.enum(['todo', 'in_progress', 'review', 'done', 'cancelled']).optional(),
        assignee_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        priority: z.number().int().min(1).max(5).optional(),
        title: z.string().optional(),
      }),
      confirmed: z.boolean(),
    }),
    execute: async ({ task_id, fields, confirmed }) => {
      const taskRes = await query(
        `SELECT title FROM tasks WHERE id = $1 AND organization_id = $2`,
        [task_id, orgId]
      );
      const task = taskRes.rows[0];
      if (!task) return { error: 'Tarefa não encontrada.' };

      const changeList = Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${v}"`)
        .join(', ');
      const previewDesc = `Atualizar tarefa "${task.title}": ${changeList}`;

      if (!confirmed) return { status: 'preview', description: previewDesc };

      const setClauses = [];
      const values = [];
      let idx = 1;
      const allowed = ['status', 'assignee_id', 'due_date', 'priority', 'title'];
      for (const key of allowed) {
        if (fields[key] !== undefined) {
          setClauses.push(`${key} = $${idx++}`);
          values.push(fields[key]);
        }
      }
      if (fields.status === 'done') { setClauses.push('completed_at = NOW()'); }
      setClauses.push('updated_at = NOW()');
      values.push(task_id, orgId);

      await query(
        `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx}`,
        values
      );
      return { status: 'done', message: `Tarefa "${task.title}" atualizada.` };
    },
  });

  // ── ATAS — LEITURA ───────────────────────────────────────────────────────

  const search_atas = tool({
    description: 'Busca atas de reunião por título, projeto ou período.',
    parameters: z.object({
      search: z.string().optional().describe('Busca por título ou participante'),
      project_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(20).optional().default(10),
    }),
    execute: async ({ search, project_id, limit }) => {
      let sql = `
        SELECT a.id, a.titulo, a.data_reuniao, a.resumo_executivo,
               p.name as project_name,
               (SELECT COUNT(*) FROM ata_acoes aa WHERE aa.ata_id = a.id) as total_acoes
        FROM atas a
        LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.organization_id = $1`;
      const params = [orgId];
      let idx = 2;
      if (search) { sql += ` AND (a.titulo ILIKE $${idx} OR a.resumo_executivo ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
      if (project_id) { sql += ` AND a.project_id = $${idx++}`; params.push(project_id); }
      sql += ` ORDER BY a.data_reuniao DESC NULLS LAST LIMIT $${idx}`;
      params.push(limit);
      const result = await query(sql, params);
      return { atas: result.rows };
    },
  });

  const get_ata = tool({
    description: 'Retorna detalhes de uma ata: resumo executivo, decisões e lista de ações.',
    parameters: z.object({
      ata_id: z.string().uuid(),
    }),
    execute: async ({ ata_id }) => {
      const [ataRes, acoesRes] = await Promise.all([
        query(
          `SELECT a.*, p.name as project_name FROM atas a
           LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.id = $1 AND a.organization_id = $2`,
          [ata_id, orgId]
        ),
        query(
          `SELECT aa.id, aa.descricao, aa.responsavel_nome, aa.prazo, aa.status
           FROM ata_acoes aa WHERE aa.ata_id = $1 ORDER BY aa.created_at`,
          [ata_id]
        ),
      ]);
      if (ataRes.rows.length === 0) return { error: 'Ata não encontrada.' };
      return { ata: ataRes.rows[0], acoes: acoesRes.rows };
    },
  });

  const update_ata_action = tool({
    description: 'Atualiza o status de uma ação de ata (pendente/concluída). Com confirmed=false retorna prévia; com confirmed=true executa.',
    parameters: z.object({
      action_id: z.string().uuid().describe('ID da ação (ata_acoes.id)'),
      status: z.enum(['pendente', 'em_andamento', 'concluida', 'cancelada']),
      confirmed: z.boolean(),
    }),
    execute: async ({ action_id, status, confirmed }) => {
      const actionRes = await query(
        `SELECT aa.descricao, aa.ata_id FROM ata_acoes aa
         JOIN atas a ON a.id = aa.ata_id
         WHERE aa.id = $1 AND a.organization_id = $2`,
        [action_id, orgId]
      );
      const action = actionRes.rows[0];
      if (!action) return { error: 'Ação não encontrada.' };

      const previewDesc = `Marcar ação "${action.descricao.slice(0, 60)}" como "${status}"`;
      if (!confirmed) return { status: 'preview', description: previewDesc };

      await query(`UPDATE ata_acoes SET status = $1 WHERE id = $2`, [status, action_id]);
      return { status: 'done', message: `Ação marcada como "${status}".` };
    },
  });

  // ── CAPACIDADE — LEITURA ─────────────────────────────────────────────────

  const get_team_capacity = tool({
    description: 'Capacidade e disponibilidade da equipe numa janela de N semanas a partir de hoje. Considera alocações ativas em projetos, tarefas em aberto, fins de semana e bloqueios do calendário (férias, licenças, feriados, treinamentos) — quem está de férias no período aparece com capacidade reduzida ou zerada. Os valores em horas são TOTAIS DA JANELA inteira, não horas por semana. Use para "quem tem disponibilidade nas próximas N semanas", "quem está sobrecarregado", "quem está de férias".',
    parameters: z.object({
      weeks: z.number().int().min(1).max(8).optional().default(4).describe('Tamanho da janela, em semanas a partir de hoje.'),
    }),
    execute: async ({ weeks = 4 }) => {
      // Janela de N semanas a partir de hoje (inclusive)
      const today = new Date();
      const startDate = today.toISOString().split('T')[0];
      const end = new Date(today);
      end.setDate(end.getDate() + weeks * 7 - 1);
      const endDate = end.toISOString().split('T')[0];

      // Reusa o motor de capacidade (mesmo cálculo das rotas /capacity e do Gantt)
      const data = await fetchAllConsultantsData(orgId, startDate, endDate);

      const team = data.users.map((user) => {
        const userAllocations = data.allocations.filter((a) => a.user_id === user.id);
        const userBlocks = data.blocks.filter((b) => b.user_id === user.id);
        const userTasks = data.tasks.filter((t) => t.user_id === user.id);

        const days = generateDayCapacities(user, userAllocations, userBlocks, userTasks, startDate, endDate);
        const semanas = aggregateByWeek(days);

        const weeklyCapacity = parseFloat(user.weekly_capacity) || 40;
        const dailyCapacity = Math.round(weeklyCapacity / 5);
        const blockedDays = days.filter((d) => d.is_blocked).length;

        // capacity_hours ja vem liquido: dias bloqueados e fins de semana valem 0
        const capacityHours = round2(semanas.reduce((acc, w) => acc + w.capacity, 0));
        const allocatedHours = round2(semanas.reduce((acc, w) => acc + w.allocated, 0));
        const freeHours = round2(semanas.reduce((acc, w) => acc + w.available, 0));

        return {
          id: user.id,
          name: user.name,
          weekly_capacity: weeklyCapacity,
          capacity_hours: capacityHours,
          allocated_hours: allocatedHours,
          free_hours: freeHours,
          utilization_pct: capacityHours > 0 ? Math.round((allocatedHours / capacityHours) * 100) : 0,
          blocked_days: blockedDays,
          blocked_hours: round2(blockedDays * dailyCapacity),
          blocks: userBlocks.map((b) => ({
            start_date: toDateStr(b.start_date),
            end_date: toDateStr(b.end_date),
            reason: b.reason,
            block_type: b.block_type,
          })),
          por_semana: semanas,
        };
      });

      return {
        period: { weeks, start_date: startDate, end_date: endDate },
        unidade: `Horas TOTAIS na janela de ${weeks} semana(s) (${startDate} a ${endDate}). capacity_hours e free_hours ja descontam fins de semana e dias bloqueados; blocked_hours e o quanto foi perdido para ferias/licencas no periodo.`,
        team,
      };
    },
  });

  const get_user_calendar = tool({
    description: 'Retorna o calendário de um consultor: alocações e bloqueios (férias, licenças).',
    parameters: z.object({
      user_id: z.string().uuid().describe('ID do consultor'),
    }),
    execute: async ({ user_id }) => {
      const [userRes, blocksRes, allocsRes] = await Promise.all([
        query(`SELECT id, name, weekly_capacity FROM users WHERE id = $1 AND organization_id = $2`, [user_id, orgId]),
        query(
          `SELECT start_date, end_date, reason, block_type FROM consultant_blocks
           WHERE user_id = $1 AND end_date >= NOW() ORDER BY start_date LIMIT 10`,
          [user_id]
        ),
        query(
          `SELECT p.name as project_name, pm.hours_per_week, pm.start_date, pm.end_date
           FROM project_members pm JOIN projects p ON p.id = pm.project_id
           WHERE pm.user_id = $1 AND pm.is_active = true AND p.status = 'active' ORDER BY pm.start_date`,
          [user_id]
        ),
      ]);
      if (userRes.rows.length === 0) return { error: 'Usuário não encontrado.' };
      return { user: userRes.rows[0], blocks: blocksRes.rows, allocations: allocsRes.rows };
    },
  });

  // ── RELATÓRIO — ENTRADA DE LEADS ─────────────────────────────────────────
  const relatorio_leads = tool({
    description: 'Relatório de CARDS NO CRM (funil): quantos negócios foram criados no período, por funil, origem e responsável. Responde "quantos cards no funil GPS", "quantos negócios o André tem", "quantos leads novos por funil". NÃO use para pergunta sobre ANÚNCIO/CAMPANHA/TRÁFEGO nem para "quantos leads chegaram/vieram do GPS/Jornada/Mentoria" — nesses casos a contagem certa é relatorio_campanhas, e este número sai diferente do painel de anúncios. owner_name filtra pelo executivo dono do card. Retorna total, quebra por funil, quebra por responsável e a lista.',
    parameters: z.object({
      period: z.enum(['hoje', 'ontem', 'semana', 'ultimos_7_dias', 'ultimos_30_dias', 'mes', 'mes_passado', 'tudo']).optional().default('mes').describe('Período (horário de Brasília). "semana" = desde segunda, "mes" = mês atual.'),
      pipeline_name: z.string().optional().describe('Nome do funil para filtrar, ex: "GPS". Busca parcial.'),
      owner_name: z.string().optional().describe('Nome do executivo/responsável dono do lead, ex: "André". Busca parcial. Use para "leads enviados pro <executivo>".'),
      source: z.string().optional().describe('Origem. Use "whatsapp" para leads que vieram pela Rica do WhatsApp.'),
      start_date: z.string().optional().describe('Data inicial YYYY-MM-DD, inclusiva (sobrescreve period).'),
      end_date: z.string().optional().describe('Data final YYYY-MM-DD, inclusiva.'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Máximo de leads na lista.'),
    }),
    execute: async ({ period = 'mes', pipeline_name, owner_name, source, start_date, end_date, limit = 50 }) => {
      const periodo = resolverPeriodo({ period, start_date, end_date });
      const params = [orgId, periodo.inicio, periodo.fim];
      let idx = 4;
      let dateCond = ` AND d.created_at >= $2 AND d.created_at < $3`;
      if (pipeline_name) { dateCond += ` AND p.name ILIKE $${idx++}`; params.push(`%${pipeline_name}%`); }
      if (owner_name) { dateCond += ` AND u.name ILIKE $${idx++}`; params.push(`%${owner_name}%`); }
      if (source) { dateCond += ` AND d.source ILIKE $${idx++}`; params.push(`%${source}%`); }

      const where = `FROM deals d
        LEFT JOIN pipelines p ON p.id = d.pipeline_id
        LEFT JOIN users u ON u.id = d.owner_id
        WHERE d.organization_id = $1${dateCond}`;

      const aggResult = await query(
        `SELECT COALESCE(p.name, '(sem funil)') AS funil,
                count(*) AS qtd,
                count(*) FILTER (WHERE d.owner_id IS NULL) AS sem_responsavel
         ${where}
         GROUP BY p.name ORDER BY qtd DESC`,
        params
      );

      const ownerAgg = await query(
        `SELECT COALESCE(u.name, 'Sem responsável') AS responsavel, count(*) AS qtd
         ${where}
         GROUP BY u.name ORDER BY qtd DESC`,
        params
      );

      const listResult = await query(
        `SELECT d.contact_name, d.contact_phone, d.created_at::date AS entrou_em,
                d.status, d.source, COALESCE(p.name, '(sem funil)') AS funil,
                COALESCE(u.name, 'Sem responsável') AS responsavel
         ${where}
         ORDER BY d.created_at DESC LIMIT $${idx}`,
        [...params, limit]
      );

      const total = aggResult.rows.reduce((s, r) => s + Number(r.qtd), 0);
      return {
        periodo: periodo.rotulo,
        criterio: 'Cards criados no CRM no período (funil). Não é o mesmo que quem chegou pelo anúncio — para campanha use relatorio_campanhas.',
        total,
        por_funil: aggResult.rows,
        por_responsavel: ownerAgg.rows,
        leads: listResult.rows,
        mostrando: listResult.rows.length,
        observacao: total > listResult.rows.length ? `Mostrando ${listResult.rows.length} de ${total}. Aumente o limit ou filtre para ver mais.` : undefined,
      };
    },
  });

  // ── RELATÓRIO — ATENDIMENTOS NO WHATSAPP (conversas, não o funil) ──────────
  // Antes: só CONTATOS NOVOS do mês e assunto pela 1ª mensagem do n8n_chat_histories.
  // "Jornada" dava 0 (o anúncio diz "JDL") e quem voltou sumia. Agora conta quem
  // FALOU no período, separando novos de quem retornou.
  const relatorio_atendimentos = tool({
    description: 'Relatório de TODAS as pessoas que falaram com a Rica no WhatsApp no período, novas ou que retornaram, independente de funil. Use para "quantos atendimentos hoje", "quantas pessoas falaram com a Rica essa semana". Para perguntas sobre CAMPANHA/ANÚNCIO/TRÁFEGO (GPS, Jornada/JDL, Mentoria) use relatorio_campanhas, que é a contagem que bate com o painel de anúncios.',
    parameters: z.object({
      period: z.enum(['hoje', 'ontem', 'semana', 'ultimos_7_dias', 'ultimos_30_dias', 'mes', 'mes_passado', 'tudo']).optional().default('semana').describe('Período (horário de Brasília).'),
      start_date: z.string().optional().describe('Data inicial YYYY-MM-DD, inclusiva (sobrescreve period).'),
      end_date: z.string().optional().describe('Data final YYYY-MM-DD, inclusiva.'),
      assunto: z.string().optional().describe('Tema citado por quem escreveu, ex: "GPS", "jornada". Omita para contar todos.'),
      limit: z.number().int().min(1).max(100).optional().default(50),
    }),
    execute: async ({ period = 'semana', start_date, end_date, assunto, limit = 50 }) => {
      const periodo = resolverPeriodo({ period, start_date, end_date });
      const camp = assunto ? resolverCampanha(assunto) : null;
      const termos = camp
        ? CAMPANHAS.find((c) => c.id === camp).apelidos
        : assunto ? [assunto] : null;
      const params = [orgId, periodo.inicio, periodo.fim];
      let filtro = '';
      if (termos) {
        params.push(termos.map((t) => `%${t}%`));
        filtro = ` AND EXISTS (SELECT 1 FROM deal_messages x WHERE x.organization_id = $1
          AND right(x.rica_session_id,8) = p.k AND x.role = 'cliente'
          AND x.occurred_at >= $2 AND x.occurred_at < $3 AND x.content ILIKE ANY($4))`;
      }
      const res = await query(
        `WITH p AS (
           SELECT right(rica_session_id,8) AS k, max(rica_session_id) AS fone, min(occurred_at) AS primeira_no_periodo
           FROM deal_messages
           WHERE organization_id = $1 AND role = 'cliente' AND rica_session_id ~ '^[0-9]{10,13}$'
             AND occurred_at >= $2 AND occurred_at < $3
           GROUP BY 1
         )
         SELECT p.fone, p.primeira_no_periodo,
           NOT EXISTS (SELECT 1 FROM deal_messages y WHERE y.organization_id = $1
             AND right(y.rica_session_id,8) = p.k AND y.occurred_at < $2) AS novo,
           (SELECT left(z.content,120) FROM deal_messages z WHERE z.organization_id = $1
             AND right(z.rica_session_id,8) = p.k AND z.role = 'cliente' AND z.occurred_at >= $2
             ORDER BY z.occurred_at, z.id LIMIT 1) AS primeira_msg
         FROM p
         WHERE p.k NOT IN (SELECT right(regexp_replace(whatsapp,'[^0-9]','','g'),8) FROM users
           WHERE organization_id = $1 AND whatsapp IS NOT NULL)${filtro}
         ORDER BY p.primeira_no_periodo DESC`,
        params
      );
      const rows = res.rows;
      return {
        periodo: periodo.rotulo,
        criterio: 'Pessoas que mandaram mensagem à Rica no período (horário de Brasília), novas ou que retornaram.' +
          (termos ? ` Filtro: mencionaram ${termos.join(' / ')}.` : ''),
        total: rows.length,
        novos: rows.filter((r) => r.novo).length,
        retornaram: rows.filter((r) => !r.novo).length,
        atendimentos: rows.slice(0, limit).map((r) => ({
          telefone: r.fone,
          primeira_mensagem_no_periodo: r.primeira_msg,
          novo: r.novo,
        })),
        mostrando: Math.min(rows.length, limit),
        nota: 'Para números de CAMPANHA (anúncio) use relatorio_campanhas.',
      };
    },
  });

  // ── RELATÓRIO — CAMPANHAS DE TRÁFEGO (bate com o painel de anúncios) ──────
  const relatorio_campanhas = tool({
    description: 'Relatório por CAMPANHA DE ANÚNCIO: quantas pessoas chegaram pela mensagem pronta do anúncio, se a Rica respondeu todas, quantas responderam, quantas foram passadas a executivo (e para quem), quantas receberam link de compra e ONDE as demais pararam. Use para qualquer pergunta sobre tráfego, anúncio, campanha, "conversas iniciadas", "quantos leads do GPS/Jornada/JDL/Mentoria chegaram", "onde os leads param", "a Rica respondeu todos?". Campanhas: ' + CAMPANHAS.map((c) => c.nome).join(', ') + '. PERÍODO: só informe period/start_date/end_date se a pessoa DISSE o período. Se ela não disse (inclusive quando só cita um número do tráfego, ex.: "na jornada foram 34"), NÃO chame esta tool: pergunte antes de qual período ela quer. Chutar o período faz o número sair diferente do dela.',
    parameters: z.object({
      campanha: z.string().optional().describe('Nome livre da campanha ("GPS", "jornada", "JDL", "mentoria coletiva"). Omita para todas + quem chegou sem campanha.'),
      period: z.enum(['hoje', 'ontem', 'semana', 'ultimos_7_dias', 'ultimos_30_dias', 'mes', 'mes_passado', 'tudo']).optional().describe('Período (horário de Brasília).'),
      start_date: z.string().optional().describe('Data inicial YYYY-MM-DD, inclusiva (sobrescreve period).'),
      end_date: z.string().optional().describe('Data final YYYY-MM-DD, inclusiva.'),
      listar: z.enum(['nenhum', 'todos', 'pararam', ...ETAPAS_DA_LISTA]).optional().default('nenhum')
        .describe('Traz a lista nominal de uma etapa. "pararam" = não responderam ou conversaram e pararam.'),
      limit: z.number().int().min(1).max(100).optional().default(50),
    }),
    execute: async ({ campanha, period, start_date, end_date, listar = 'nenhum', limit = 50 }) => {
      if (!period && !start_date && !end_date) {
        return { erro: 'Período não informado. Pergunte ao usuário qual período (ex.: este mês, mês passado, de 01/08 a 31/08) antes de consultar — não assuma.' };
      }
      return relatorioCampanhas({
        orgId,
        campanha,
        periodo: resolverPeriodo({ period, start_date, end_date }),
        listar,
        limite: limit,
      });
    },
  });

  // ── BASE DE CONHECIMENTO (mesma que a Rica usa com o cliente) ───────────

  /**
   * O copiloto não tinha NENHUMA informação de produto: quando o time perguntou
   * "quero saber sobre a jornada online", ele respondeu de cabeça, genérico.
   *
   * A saída não é copiar o catálogo para cá — o prompt do bot e esta cópia
   * divergiriam, que é exatamente o bug que fez a Rica dizer "12 meses" enquanto
   * o site prometia acesso vitalício. Aqui ele consulta a MESMA base vetorial
   * (documents_base) que a Rica-lead consulta, então a fonte é uma só.
   */
  const buscar_conhecimento = tool({
    description:
      'Busca na base de conhecimento da empresa: fichas de produto (preço, o que inclui, '
      + 'formas de pagamento, garantia, link de compra da Jornada da Lucratividade Online) e '
      + 'relatórios técnicos do setor de panificação (CMV, margem, reforma tributária, '
      + 'indicadores PROPAN). USE SEMPRE que perguntarem sobre um produto, preço, condição '
      + 'comercial ou dado do setor — nunca responda esses assuntos de memória.',
    parameters: z.object({
      pergunta: z.string().describe('A pergunta com os TERMOS do usuário, sem reformular.'),
    }),
    execute: async ({ pergunta }) => {
      const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
      const chave = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
      const openaiKey = process.env.OPENAI_API_KEY || '';
      if (!base || !chave || !openaiKey) {
        return { encontrado: false, motivo: 'busca indisponível (faltam credenciais no servidor)' };
      }
      try {
        const er = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text-embedding-3-small', input: pergunta }),
        });
        if (!er.ok) return { encontrado: false, motivo: 'falha ao interpretar a pergunta' };
        const emb = (await er.json()).data[0].embedding;

        const rr = await fetch(`${base}/rest/v1/rpc/match_documents`, {
          method: 'POST',
          headers: { apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query_embedding: emb, match_count: 5, filter: {} }),
        });
        if (!rr.ok) return { encontrado: false, motivo: 'falha na busca' };
        const docs = await rr.json();

        // O pgvector devolve SEMPRE os N mais próximos, mesmo sem relação nenhuma
        // com a pergunta. Sem este piso, "quanto custa X" traz trecho aleatório e
        // o modelo responde aquilo com confiança. Mesmo corte usado no rica-bot.
        const relevantes = (Array.isArray(docs) ? docs : []).filter(d => (d.similarity ?? 0) >= 0.45);
        if (!relevantes.length) {
          return {
            encontrado: false,
            instrucao: 'Nada relevante na base. NÃO invente: diga que vai confirmar e ofereça checar com o comercial.',
          };
        }
        return {
          encontrado: true,
          trechos: relevantes.map(d => ({
            fonte: d.metadata?.arquivo || d.metadata?.source || 'documento interno',
            conteudo: d.content,
            similaridade: Number((d.similarity ?? 0).toFixed(2)),
          })),
        };
      } catch (e) {
        return { encontrado: false, motivo: 'erro ao consultar a base' };
      }
    },
  });

  const todas = {
    buscar_conhecimento,
    search_deals,
    get_deal,
    list_pipelines,
    list_users,
    list_activities,
    move_to_stage,
    move_to_pipeline,
    assign_owner,
    update_deal,
    create_note,
    schedule_followup,
    list_tasks,
    list_projects,
    get_project,
    create_task,
    update_task,
    search_atas,
    get_ata,
    update_ata_action,
    get_team_capacity,
    get_user_calendar,
    relatorio_leads,
    relatorio_atendimentos,
    relatorio_campanhas,
  };

  // Tool que falha responde "não consegui" em vez de estourar exceção e virar
  // erro na cara de quem perguntou (ver blindagem.js).
  return blindarTools(todas);
}
