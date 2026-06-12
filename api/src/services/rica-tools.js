import { tool } from 'ai';
import { z } from 'zod';
import { query, createTask, getTasks } from './database.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function orgFilter(orgId) {
  return orgId;
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
    description: 'Retorna resumo de capacidade e disponibilidade da equipe para as próximas semanas.',
    parameters: z.object({
      weeks: z.number().int().min(1).max(8).optional().default(4),
    }),
    execute: async ({ weeks }) => {
      const result = await query(
        `SELECT u.id, u.name,
                COALESCE(u.weekly_capacity, 40) as weekly_capacity,
                (SELECT COALESCE(SUM(pa.hours_per_week), 0)
                 FROM project_allocations pa
                 JOIN projects p ON p.id = pa.project_id
                 WHERE pa.user_id = u.id AND p.status = 'active') as allocated_hours
         FROM users u
         WHERE u.organization_id = $1 AND u.is_active = true AND u.role = 'consultant'
         ORDER BY u.name`,
        [orgId]
      );
      return {
        team: result.rows.map(r => ({
          ...r,
          free_hours: Math.max(0, (r.weekly_capacity || 40) - (parseFloat(r.allocated_hours) || 0)),
        })),
        period_weeks: weeks,
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
          `SELECT p.name as project_name, pa.hours_per_week, pa.start_date, pa.end_date
           FROM project_allocations pa JOIN projects p ON p.id = pa.project_id
           WHERE pa.user_id = $1 AND p.status = 'active' ORDER BY pa.start_date`,
          [user_id]
        ),
      ]);
      if (userRes.rows.length === 0) return { error: 'Usuário não encontrado.' };
      return { user: userRes.rows[0], blocks: blocksRes.rows, allocations: allocsRes.rows };
    },
  });

  // ── RELATÓRIO — ENTRADA DE LEADS ─────────────────────────────────────────
  const relatorio_leads = tool({
    description: 'Relatório de ENTRADA de leads por período, funil e origem. Responde perguntas como "quantos/quais leads da GPS chegaram este mês via Rica", "quais leads entraram esta semana", "quantos leads novos por funil". Origem "whatsapp" = leads que chegaram pela Rica do WhatsApp. Retorna o total, a quebra por funil e a lista dos leads.',
    parameters: z.object({
      period: z.enum(['hoje', 'semana', 'mes', 'mes_passado', 'tudo']).optional().default('mes').describe('Período. "mes" = mês atual (padrão).'),
      pipeline_name: z.string().optional().describe('Nome do funil para filtrar, ex: "GPS". Busca parcial.'),
      source: z.string().optional().describe('Origem. Use "whatsapp" para leads que vieram pela Rica do WhatsApp.'),
      start_date: z.string().optional().describe('Data inicial ISO (sobrescreve period).'),
      end_date: z.string().optional().describe('Data final ISO (sobrescreve period).'),
      limit: z.number().int().min(1).max(100).optional().default(50).describe('Máximo de leads na lista.'),
    }),
    execute: async ({ period = 'mes', pipeline_name, source, start_date, end_date, limit = 50 }) => {
      const params = [orgId];
      let idx = 2;
      let dateCond = '';
      if (start_date || end_date) {
        if (start_date) { dateCond += ` AND d.created_at >= $${idx++}`; params.push(start_date); }
        if (end_date) { dateCond += ` AND d.created_at <= $${idx++}`; params.push(end_date); }
      } else {
        switch (period) {
          case 'hoje': dateCond = ` AND d.created_at >= date_trunc('day', NOW())`; break;
          case 'semana': dateCond = ` AND d.created_at >= date_trunc('week', NOW())`; break;
          case 'mes_passado': dateCond = ` AND d.created_at >= date_trunc('month', NOW()) - INTERVAL '1 month' AND d.created_at < date_trunc('month', NOW())`; break;
          case 'tudo': dateCond = ''; break;
          case 'mes':
          default: dateCond = ` AND d.created_at >= date_trunc('month', NOW())`; break;
        }
      }
      if (pipeline_name) { dateCond += ` AND p.name ILIKE $${idx++}`; params.push(`%${pipeline_name}%`); }
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
        total,
        por_funil: aggResult.rows,
        leads: listResult.rows,
        mostrando: listResult.rows.length,
        observacao: total > listResult.rows.length ? `Mostrando ${listResult.rows.length} de ${total}. Aumente o limit ou filtre para ver mais.` : undefined,
      };
    },
  });

  return {
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
  };
}
