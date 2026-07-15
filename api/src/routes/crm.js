import { Router } from 'express';
import multer from 'multer';
import { query } from '../services/database.js';
import * as leadJourney from '../services/leadJourney.js';
import * as dealAudit from '../services/dealAudit.js';
import * as gcal from '../services/googleCalendar.js';

const router = Router();

// Multer: store uploads in memory (buffer), max 20 MB
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Helper: get org id from either JWT auth or N8N fallback
function getOrgId(req) {
  return req.user?.organization_id || req.organizationId;
}

// Motivos de perda padrão (opções mostradas ao marcar um lead como perdido).
const LOSS_REASONS = [
  'Cliente optou por não realizar o projeto',
  'Demora no follow',
  'Fechou com outra empresa',
  'Não gosto do produto/serviço',
  'Preço',
  'Sem retorno',
];

// Escopo de visibilidade: usuários 'member' (executivos) só veem os PRÓPRIOS
// leads (owner_id = seu id), em qualquer funil. Admin/gestão veem tudo.
// Requests sem usuário (bot/n8n via fallback de org) NÃO são escopadas.
function isOwnerScoped(req) {
  return !!(req.user && req.user.role === 'member');
}

// ============================================
// AUTOMATION EXECUTION HELPER
// ============================================

async function executeAutomations(dealId, triggerType, triggerData, orgId) {
  try {
    const automationsResult = await query(
      `SELECT * FROM deal_automations
       WHERE organization_id = $1 AND trigger_type = $2 AND is_active = true`,
      [orgId, triggerType]
    );

    for (const automation of automationsResult.rows) {
      try {
        // For stage_change triggers, check if from/to stages match
        if (triggerType === 'stage_change') {
          const config = automation.trigger_config || {};
          if (config.from_stage_id && config.from_stage_id !== triggerData.from_stage_id) continue;
          if (config.to_stage_id && config.to_stage_id !== triggerData.to_stage_id) continue;
        }

        const actionConfig = automation.action_config || {};
        let executed = false;

        switch (automation.action_type) {
          case 'notify_owner': {
            await query(
              `INSERT INTO deal_activities (deal_id, type, description, metadata)
               VALUES ($1, 'automation', $2, $3)`,
              [dealId, `Automacao: ${automation.name} - Notificacao ao responsavel`, { automation_id: automation.id }]
            );
            executed = true;
            break;
          }

          case 'create_task': {
            await query(
              `INSERT INTO tasks (organization_id, title, description, deal_id, assigned_to, due_date, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
              [
                orgId,
                actionConfig.task_title || `Tarefa automatica: ${automation.name}`,
                actionConfig.task_description || null,
                dealId,
                actionConfig.assigned_to || null,
                actionConfig.due_date || null,
              ]
            );
            executed = true;
            break;
          }

          case 'move_stage': {
            if (actionConfig.target_stage_id) {
              // Avoid infinite loops: don't re-trigger automations from this move
              await query(
                `UPDATE deals SET pipeline_stage_id = $1, stage_entered_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [actionConfig.target_stage_id, dealId]
              );
              await query(
                `INSERT INTO deal_activities (deal_id, type, description, metadata)
                 VALUES ($1, 'automation', $2, $3)`,
                [dealId, `Automacao: ${automation.name} - Movido para outra etapa`, { automation_id: automation.id }]
              );
            }
            executed = true;
            break;
          }

          case 'change_field': {
            if (actionConfig.field_name && actionConfig.field_value !== undefined) {
              const allowed = ['temperature', 'source', 'probability', 'expected_close_date', 'tags'];
              if (allowed.includes(actionConfig.field_name)) {
                await query(
                  `UPDATE deals SET ${actionConfig.field_name} = $1, updated_at = NOW() WHERE id = $2`,
                  [actionConfig.field_value, dealId]
                );
              }
            }
            executed = true;
            break;
          }

          case 'assign_owner': {
            if (actionConfig.owner_id) {
              await query(
                `UPDATE deals SET owner_id = $1, updated_at = NOW() WHERE id = $2`,
                [actionConfig.owner_id, dealId]
              );
              await query(
                `INSERT INTO deal_activities (deal_id, type, description, metadata)
                 VALUES ($1, 'automation', $2, $3)`,
                [dealId, `Automacao: ${automation.name} - Responsavel atribuido`, { automation_id: automation.id }]
              );
            }
            executed = true;
            break;
          }
        }

        // Log execution
        if (executed) {
          await query(
            `INSERT INTO deal_automation_log (automation_id, deal_id, trigger_data, action_result, status)
             VALUES ($1, $2, $3, $4, 'success')`,
            [automation.id, dealId, JSON.stringify(triggerData), JSON.stringify({ action_type: automation.action_type })]
          );
          await query(
            `UPDATE deal_automations SET executions_count = COALESCE(executions_count, 0) + 1 WHERE id = $1`,
            [automation.id]
          );
        }
      } catch (err) {
        // Log failed execution but don't break the loop
        await query(
          `INSERT INTO deal_automation_log (automation_id, deal_id, trigger_data, action_result, status)
           VALUES ($1, $2, $3, $4, 'error')`,
          [automation.id, dealId, JSON.stringify(triggerData), JSON.stringify({ error: err.message })]
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('executeAutomations error:', err);
  }
}

// ============================================
// PIPELINES (multi-funnel)
// ============================================

// List pipelines for org
router.get('/pipelines', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM deals d WHERE d.pipeline_id = p.id AND d.status = 'open') as open_deals,
              (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.pipeline_id = p.id AND d.status = 'open') as pipeline_value
       FROM pipelines p
       WHERE p.organization_id = $1 AND p.is_active = true
       ORDER BY p.position`,
      [orgId]
    );
    res.json({ pipelines: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create pipeline
router.post('/pipelines', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, description, position } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name e obrigatorio' } });

    const result = await query(
      `INSERT INTO pipelines (organization_id, name, description, position)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [orgId, name, description || null, position || 0]
    );
    res.status(201).json({ pipeline: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update pipeline
router.patch('/pipelines/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const fields = []; const values = []; let idx = 1;
    for (const key of ['name', 'description', 'position', 'is_active']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    fields.push('updated_at = NOW()');
    values.push(id); values.push(orgId);
    const result = await query(
      `UPDATE pipelines SET ${fields.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Pipeline nao encontrado' } });
    res.json({ pipeline: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete pipeline (only if no deals)
router.delete('/pipelines/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const check = await query('SELECT COUNT(*) as count FROM deals WHERE pipeline_id = $1', [id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ error: { message: 'Pipeline possui deals. Mova os deals antes de excluir.' } });
    }
    const result = await query('DELETE FROM pipelines WHERE id = $1 AND organization_id = $2 RETURNING id', [id, orgId]);
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Pipeline nao encontrado' } });
    // Also delete orphaned stages
    await query('DELETE FROM pipeline_stages WHERE pipeline_id = $1', [id]);
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PIPELINE STAGES
// ============================================

// List stages ordered by position (filter by pipeline_id)
router.get('/pipeline', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { pipeline_id } = req.query;
    let sql = 'SELECT * FROM pipeline_stages WHERE organization_id = $1';
    const params = [orgId];
    if (pipeline_id) {
      sql += ' AND pipeline_id = $2';
      params.push(pipeline_id);
    }
    sql += ' ORDER BY position';
    const result = await query(sql, params);
    res.json({ stages: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create new stage
router.post('/pipeline', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, color, position, max_days, description, pipeline_id } = req.body;

    if (!name) {
      return res.status(400).json({ error: { message: 'name e obrigatorio' } });
    }

    const result = await query(
      `INSERT INTO pipeline_stages (organization_id, pipeline_id, name, color, position, max_days, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orgId, pipeline_id || null, name, color || '#6B7280', position || 0, max_days || null, description || null]
    );

    res.status(201).json({ stage: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Reorder stages (must be before /:id to avoid route conflict)
router.patch('/pipeline/reorder', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { stages } = req.body;

    if (!Array.isArray(stages)) {
      return res.status(400).json({ error: { message: 'stages deve ser um array de {id, position}' } });
    }

    for (const stage of stages) {
      await query(
        'UPDATE pipeline_stages SET position = $1 WHERE id = $2 AND organization_id = $3',
        [stage.position, stage.id, orgId]
      );
    }

    const result = await query(
      'SELECT * FROM pipeline_stages WHERE organization_id = $1 ORDER BY position',
      [orgId]
    );

    res.json({ stages: result.rows });
  } catch (error) {
    next(error);
  }
});

// Update stage
router.patch('/pipeline/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['name', 'color', 'position', 'max_days', 'description', 'is_won', 'is_lost', 'pipeline_id'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    values.push(id);
    values.push(orgId);

    const result = await query(
      `UPDATE pipeline_stages SET ${fields.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Etapa nao encontrada' } });
    }

    res.json({ stage: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete stage
router.delete('/pipeline/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    // Check if stage has deals
    const dealsCheck = await query(
      'SELECT COUNT(*) as count FROM deals WHERE pipeline_stage_id = $1',
      [id]
    );

    if (parseInt(dealsCheck.rows[0].count) > 0) {
      return res.status(400).json({
        error: { message: 'Etapa possui deals. Mova os deals para outra etapa antes de excluir.' },
      });
    }

    const result = await query(
      'DELETE FROM pipeline_stages WHERE id = $1 AND organization_id = $2 RETURNING id',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Etapa nao encontrada' } });
    }

    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// COMPANIES
// ============================================

// List companies
router.get('/companies', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { search, segment, limit: lim } = req.query;
    let sql = `
      SELECT c.*,
             (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id) as contacts_count,
             (SELECT COUNT(*) FROM deals d WHERE d.company_id = c.id) as deals_count,
             (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.company_id = c.id AND d.status = 'open') as pipeline_value
      FROM companies c WHERE c.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (search) {
      sql += ` AND (c.name ILIKE $${idx} OR c.cnpj ILIKE $${idx} OR c.email ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }
    if (segment) { sql += ` AND c.segment = $${idx++}`; params.push(segment); }
    sql += ' ORDER BY c.name';
    if (lim) { sql += ` LIMIT $${idx++}`; params.push(parseInt(lim)); }
    const result = await query(sql, params);
    res.json({ companies: result.rows, count: result.rows.length });
  } catch (error) { next(error); }
});

// Search companies (autocomplete)
router.get('/companies/search', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ companies: [] });
    const result = await query(
      `SELECT id, name, cnpj, segment, city, state FROM companies
       WHERE organization_id = $1 AND name ILIKE $2 ORDER BY name LIMIT 10`,
      [orgId, `%${q}%`]
    );
    res.json({ companies: result.rows });
  } catch (error) { next(error); }
});

// Get company detail
router.get('/companies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [companyResult, contactsResult, dealsResult] = await Promise.all([
      query('SELECT * FROM companies WHERE id = $1', [id]),
      query('SELECT * FROM contacts WHERE company_id = $1 ORDER BY name', [id]),
      query(
        `SELECT d.*, ps.name as stage_name, ps.color as stage_color
         FROM deals d LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         WHERE d.company_id = $1 ORDER BY d.updated_at DESC`,
        [id]
      ),
    ]);
    if (companyResult.rows.length === 0) return res.status(404).json({ error: { message: 'Empresa nao encontrada' } });
    res.json({ company: companyResult.rows[0], contacts: contactsResult.rows, deals: dealsResult.rows });
  } catch (error) { next(error); }
});

// Create company
router.post('/companies', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, cnpj, segment, city, state, phone, email, website, notes } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name e obrigatorio' } });
    const result = await query(
      `INSERT INTO companies (organization_id, name, cnpj, segment, city, state, phone, email, website, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [orgId, name, cnpj || null, segment || null, city || null, state || null, phone || null, email || null, website || null, notes || null]
    );
    res.status(201).json({ company: result.rows[0] });
  } catch (error) { next(error); }
});

// Update company
router.patch('/companies/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const fields = []; const values = []; let idx = 1;
    for (const key of ['name', 'cnpj', 'segment', 'city', 'state', 'phone', 'email', 'website', 'notes']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    fields.push('updated_at = NOW()');
    values.push(id); values.push(orgId);
    const result = await query(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Empresa nao encontrada' } });
    res.json({ company: result.rows[0] });
  } catch (error) { next(error); }
});

// Delete company
router.delete('/companies/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const result = await query('DELETE FROM companies WHERE id = $1 AND organization_id = $2 RETURNING id', [id, orgId]);
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Empresa nao encontrada' } });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// ============================================
// CONTACTS (standalone)
// ============================================

// List contacts
router.get('/contacts', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { search, company_id, limit: lim } = req.query;
    let sql = `
      SELECT ct.*, c.name as company_name,
             (SELECT COUNT(*) FROM deals d WHERE d.contact_id = ct.id) as deals_count
      FROM contacts ct
      LEFT JOIN companies c ON c.id = ct.company_id
      WHERE ct.organization_id = $1`;
    const params = [orgId];
    let idx = 2;
    if (search) {
      sql += ` AND (ct.name ILIKE $${idx} OR ct.phone ILIKE $${idx} OR ct.email ILIKE $${idx})`;
      params.push(`%${search}%`); idx++;
    }
    if (company_id) { sql += ` AND ct.company_id = $${idx++}`; params.push(company_id); }
    sql += ' ORDER BY ct.name';
    if (lim) { sql += ` LIMIT $${idx++}`; params.push(parseInt(lim)); }
    const result = await query(sql, params);
    res.json({ contacts: result.rows, count: result.rows.length });
  } catch (error) { next(error); }
});

// Search contacts (autocomplete)
router.get('/contacts/search', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ contacts: [] });
    const result = await query(
      `SELECT ct.id, ct.name, ct.phone, ct.email, ct.company_id, c.name as company_name
       FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id
       WHERE ct.organization_id = $1 AND (ct.name ILIKE $2 OR ct.phone ILIKE $2)
       ORDER BY ct.name LIMIT 10`,
      [orgId, `%${q}%`]
    );
    res.json({ contacts: result.rows });
  } catch (error) { next(error); }
});

// Find contact by phone (for N8N)
router.get('/contacts/by-phone/:phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone } = req.params;
    const result = await query(
      `SELECT ct.*, c.name as company_name
       FROM contacts ct LEFT JOIN companies c ON c.id = ct.company_id
       WHERE ct.organization_id = $1 AND ct.phone = $2 LIMIT 1`,
      [orgId, phone]
    );
    if (result.rows.length === 0) return res.json({ contact: null, exists: false });
    // Also fetch deals for this contact
    const dealsResult = await query(
      `SELECT d.*, ps.name as stage_name FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
       WHERE d.contact_id = $1 ORDER BY d.updated_at DESC`,
      [result.rows[0].id]
    );
    res.json({ contact: { ...result.rows[0], deals: dealsResult.rows }, exists: true });
  } catch (error) { next(error); }
});

// Get contact detail
router.get('/contacts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [contactResult, dealsResult] = await Promise.all([
      query(
        `SELECT ct.*, c.name as company_name FROM contacts ct
         LEFT JOIN companies c ON c.id = ct.company_id WHERE ct.id = $1`,
        [id]
      ),
      query(
        `SELECT d.*, ps.name as stage_name, ps.color as stage_color, p.name as pipeline_name
         FROM deals d LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         LEFT JOIN pipelines p ON p.id = d.pipeline_id
         WHERE d.contact_id = $1 ORDER BY d.updated_at DESC`,
        [id]
      ),
    ]);
    if (contactResult.rows.length === 0) return res.status(404).json({ error: { message: 'Contato nao encontrado' } });
    res.json({ contact: contactResult.rows[0], deals: dealsResult.rows });
  } catch (error) { next(error); }
});

// Create contact
router.post('/contacts', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, email, phone, role, notes, company_id } = req.body;
    if (!name) return res.status(400).json({ error: { message: 'name e obrigatorio' } });
    const result = await query(
      `INSERT INTO contacts (organization_id, company_id, name, email, phone, role, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [orgId, company_id || null, name, email || null, phone || null, role || null, notes || null]
    );
    res.status(201).json({ contact: result.rows[0] });
  } catch (error) { next(error); }
});

// Update contact
router.patch('/contacts/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const fields = []; const values = []; let idx = 1;
    for (const key of ['name', 'email', 'phone', 'role', 'notes', 'company_id']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${idx++}`); values.push(req.body[key]); }
    }
    if (fields.length === 0) return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    fields.push('updated_at = NOW()');
    values.push(id); values.push(orgId);
    const result = await query(
      `UPDATE contacts SET ${fields.join(', ')} WHERE id = $${idx++} AND organization_id = $${idx} RETURNING *`,
      values
    );
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Contato nao encontrado' } });
    res.json({ contact: result.rows[0] });
  } catch (error) { next(error); }
});

// Delete contact
router.delete('/contacts/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const result = await query('DELETE FROM contacts WHERE id = $1 AND organization_id = $2 RETURNING id', [id, orgId]);
    if (result.rows.length === 0) return res.status(404).json({ error: { message: 'Contato nao encontrado' } });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// ============================================
// DEALS
// ============================================

// List deals with filters
router.get('/deals', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const {
      status, pipeline_stage_id, pipeline_id, owner_id, phone, search,
      temperature, source, sort_by, sort_dir,
      min_value, max_value,
    } = req.query;

    let sql = `
      SELECT d.*,
             ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
             ps.max_days as stage_max_days,
             u.name as owner_name,
             co.name as linked_company_name,
             ct.name as linked_contact_name, ct.phone as linked_contact_phone,
             p.name as pipeline_name,
             (SELECT COUNT(*) FROM deal_insights di WHERE di.deal_id = d.id) as insights_count,
             EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400 as days_in_stage
      FROM deals d
      LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN companies co ON co.id = d.company_id
      LEFT JOIN contacts ct ON ct.id = d.contact_id
      LEFT JOIN pipelines p ON p.id = d.pipeline_id
      WHERE d.organization_id = $1`;
    const params = [orgId];
    let idx = 2;

    if (pipeline_id) {
      sql += ` AND d.pipeline_id = $${idx++}`;
      params.push(pipeline_id);
    }
    if (status) {
      sql += ` AND d.status = $${idx++}`;
      params.push(status);
    }
    if (pipeline_stage_id) {
      sql += ` AND d.pipeline_stage_id = $${idx++}`;
      params.push(pipeline_stage_id);
    }
    if (owner_id) {
      sql += ` AND d.owner_id = $${idx++}`;
      params.push(owner_id);
    }
    if (phone) {
      sql += ` AND d.contact_phone = $${idx++}`;
      params.push(phone);
    }
    if (search) {
      sql += ` AND (d.title ILIKE $${idx} OR d.contact_name ILIKE $${idx} OR d.company_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }
    if (temperature) {
      sql += ` AND d.temperature = $${idx++}`;
      params.push(temperature);
    }
    if (source) {
      sql += ` AND d.source = $${idx++}`;
      params.push(source);
    }
    if (min_value) {
      sql += ` AND d.value >= $${idx++}`;
      params.push(min_value);
    }
    if (max_value) {
      sql += ` AND d.value <= $${idx++}`;
      params.push(max_value);
    }

    // Escopo por dono: executivo (member) só vê os próprios leads, em qualquer funil.
    if (isOwnerScoped(req)) {
      sql += ` AND d.owner_id = $${idx++}`;
      params.push(req.user.id);
    }

    // Sorting
    const allowedSorts = ['created_at', 'updated_at', 'value', 'stage_entered_at'];
    const sortColumn = allowedSorts.includes(sort_by) ? `d.${sort_by}` : 'd.updated_at';
    const sortDirection = sort_dir === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortColumn} ${sortDirection}`;

    const result = await query(sql, params);

    // Add is_rotting computed field
    const deals = result.rows.map((deal) => ({
      ...deal,
      days_in_stage: deal.days_in_stage ? Math.floor(deal.days_in_stage) : 0,
      is_rotting: deal.stage_max_days
        ? Math.floor(deal.days_in_stage || 0) > deal.stage_max_days
        : false,
    }));

    res.json({ deals, count: deals.length });
  } catch (error) {
    next(error);
  }
});

// Find deal by phone (for N8N) — searches both deals.contact_phone and contacts.phone
router.get('/deals/by-phone/:phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone } = req.params;

    // First try via contacts table (new model)
    let result = await query(
      `SELECT d.*, ps.name as stage_name, ps.color as stage_color, p.name as pipeline_name,
              ct.name as linked_contact_name, ct.phone as linked_contact_phone,
              co.name as linked_company_name
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       LEFT JOIN contacts ct ON ct.id = d.contact_id
       LEFT JOIN companies co ON co.id = d.company_id
       WHERE d.organization_id = $1 AND (d.contact_phone = $2 OR ct.phone = $2)
       ORDER BY d.created_at DESC LIMIT 1`,
      [orgId, phone]
    );

    if (result.rows.length === 0) {
      return res.json({ deal: null, exists: false });
    }

    const insightsResult = await query(
      'SELECT * FROM deal_insights WHERE deal_id = $1 ORDER BY created_at DESC',
      [result.rows[0].id]
    );

    res.json({
      deal: { ...result.rows[0], insights: insightsResult.rows },
      exists: true,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// FOLLOW-UP ENDPOINTS (must come BEFORE /deals/:id)
// ============================================

/**
 * GET /api/crm/deals/followup-candidates
 * Retorna deals elegíveis para follow-up baseado em thresholds.
 *
 * IMPORTANTE: precisa ser registrado antes de /deals/:id, senão o
 * Express captura 'followup-candidates' como :id e tenta cast pra UUID.
 *
 * Query params:
 *   - max_followups (default: 3)
 *
 * Regras de cadência (horas sem resposta do cliente):
 *   - followup_count = 0  → threshold = 2h
 *   - followup_count = 1  → threshold = 24h
 *   - followup_count = 2  → threshold = 72h (3 dias)
 *   - followup_count = 3  → encerra (marca lost)
 */
router.get('/deals/followup-candidates', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const maxFollowups = parseInt(req.query.max_followups) || 3;

    // Busca deals abertos elegiveis
    const result = await query(
      `SELECT
        d.id, d.title, d.pipeline_id, d.pipeline_stage_id,
        d.contact_id, d.contact_name, d.contact_phone,
        d.followup_count, d.last_followup_at, d.last_client_message_at,
        d.temperature, d.status, d.created_at, d.stage_entered_at,
        p.name as pipeline_name,
        ps.name as stage_name,
        c.name as contact_full_name, c.email as contact_email,
        co.name as company_name,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(d.last_client_message_at, d.created_at))) / 3600 AS hours_since_activity,
        EXTRACT(EPOCH FROM (NOW() - COALESCE(d.last_followup_at, d.created_at))) / 3600 AS hours_since_followup
       FROM deals d
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN companies co ON co.id = d.company_id
       WHERE d.organization_id = $1
         AND d.status = 'open'
         AND COALESCE(d.followup_count, 0) < $2
         AND (
           (COALESCE(d.followup_count, 0) = 0 AND EXTRACT(EPOCH FROM (NOW() - COALESCE(d.last_client_message_at, d.created_at))) / 3600 >= 2)
           OR
           (COALESCE(d.followup_count, 0) = 1 AND EXTRACT(EPOCH FROM (NOW() - COALESCE(d.last_followup_at, d.created_at))) / 3600 >= 24)
           OR
           (COALESCE(d.followup_count, 0) = 2 AND EXTRACT(EPOCH FROM (NOW() - COALESCE(d.last_followup_at, d.created_at))) / 3600 >= 72)
         )
       ORDER BY d.followup_count ASC, hours_since_activity DESC
       LIMIT 50`,
      [orgId, maxFollowups]
    );

    // Para cada deal, buscar últimos 5 insights (contexto)
    const dealsWithContext = await Promise.all(
      result.rows.map(async (deal) => {
        const insights = await query(
          `SELECT category, content, created_at
           FROM deal_insights
           WHERE deal_id = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [deal.id]
        );
        return { ...deal, recent_insights: insights.rows };
      })
    );

    res.json({ deals: dealsWithContext, total: dealsWithContext.length });
  } catch (error) {
    next(error);
  }
});

// Get deal detail with insights, activities, products, contacts
router.get('/deals/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [dealResult, insightsResult, activitiesResult, productsResult, contactsResult] = await Promise.all([
      query(
        `SELECT d.*, ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
                ps.max_days as stage_max_days, u.name as owner_name,
                EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400 as days_in_stage
         FROM deals d
         LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.id = $1`,
        [id]
      ),
      query('SELECT * FROM deal_insights WHERE deal_id = $1 ORDER BY created_at DESC', [id]),
      query(
        `SELECT da.*, u.name as user_name FROM deal_activities da
         LEFT JOIN users u ON u.id = da.user_id
         WHERE da.deal_id = $1 ORDER BY da.created_at DESC`,
        [id]
      ),
      query('SELECT * FROM deal_products WHERE deal_id = $1 ORDER BY created_at', [id]),
      query('SELECT * FROM deal_contacts WHERE deal_id = $1 ORDER BY is_primary DESC, created_at', [id]),
    ]);

    if (dealResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    const deal = dealResult.rows[0];

    // Escopo por dono: executivo (member) não acessa lead que não é dele.
    if (isOwnerScoped(req) && deal.owner_id !== req.user.id) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    deal.days_in_stage = deal.days_in_stage ? Math.floor(deal.days_in_stage) : 0;
    deal.is_rotting = deal.stage_max_days
      ? deal.days_in_stage > deal.stage_max_days
      : false;

    res.json({
      deal,
      insights: insightsResult.rows,
      activities: activitiesResult.rows,
      products: productsResult.rows,
      contacts: contactsResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

// Create deal
router.post('/deals', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const {
      title, contact_name, contact_email, contact_phone, company_name,
      owner_id, value, source = 'whatsapp', temperature = 'warm',
      tags, custom_fields, pipeline_id, pipeline_stage_id, company_id, contact_id,
      // rastreabilidade
      first_channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      rica_session_id,
    } = req.body;

    // Etapa: honra a etapa escolhida; senao pega a 1a etapa do funil.
    let stageId = pipeline_stage_id || null;
    if (!stageId) {
      let stageQuery = `SELECT id FROM pipeline_stages
         WHERE organization_id = $1 AND is_won = false AND is_lost = false`;
      const stageParams = [orgId];
      if (pipeline_id) {
        stageQuery += ' AND pipeline_id = $2';
        stageParams.push(pipeline_id);
      }
      stageQuery += ' ORDER BY position LIMIT 1';
      const stageResult = await query(stageQuery, stageParams);
      stageId = stageResult.rows[0]?.id || null;
    }

    // Dono: se nao informado, atribui a quem criou (evita lead "orfao" invisivel
    // para executivos que so veem os proprios leads). Bot/n8n (sem req.user) fica null.
    const ownerId = owner_id || req.user?.id || null;

    const result = await query(
      `INSERT INTO deals (organization_id, pipeline_stage_id, pipeline_id, title, contact_name, contact_email,
        contact_phone, company_name, owner_id, value, source, temperature, tags, custom_fields,
        company_id, contact_id, stage_entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       RETURNING *`,
      [
        orgId, stageId, pipeline_id || null,
        title || `Lead - ${contact_name || contact_phone}`,
        contact_name, contact_email, contact_phone, company_name,
        ownerId, value, source, temperature, tags || [], custom_fields || {},
        company_id || null, contact_id || null,
      ]
    );

    const deal = result.rows[0];

    // Log creation activity
    await query(
      `INSERT INTO deal_activities (deal_id, type, description)
       VALUES ($1, 'note', $2)`,
      [deal.id, `Lead criado via ${source}`]
    );

    // Rastreabilidade: grava evento e campos de origem (nao bloqueia resposta se falhar)
    leadJourney.recordLeadCreated({
      dealId: deal.id,
      organizationId: orgId,
      actorUserId: req.user?.id,
      actorType: source === 'whatsapp' ? 'rica' : 'user',
      firstChannel: first_channel || source || 'manual',
      utmSource: utm_source,
      utmMedium: utm_medium,
      utmCampaign: utm_campaign,
      utmContent: utm_content,
      utmTerm: utm_term,
      ricaSessionId: rica_session_id,
    }).catch(err => console.error('[leadJourney] recordLeadCreated error:', err));

    dealAudit.recordCreated(deal.id, orgId, req.user?.id, source === 'whatsapp' ? 'rica' : 'user', {
      title: deal.title, source: deal.source, pipeline_id: deal.pipeline_id,
    }).catch(err => console.error('[dealAudit] recordCreated error:', err));

    res.status(201).json({ deal });
  } catch (error) {
    next(error);
  }
});

// Update deal
router.patch('/deals/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    // Get current deal state for stage change detection + audit diff
    const currentDeal = await query(
      `SELECT d.*, ps.name as stage_name FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
       WHERE d.id = $1`,
      [id]
    );
    if (currentDeal.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }
    const oldDeal = currentDeal.rows[0];

    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'title', 'contact_name', 'contact_email', 'contact_phone', 'company_name',
      'owner_id', 'value', 'probability', 'expected_close_date', 'status',
      'source', 'temperature', 'tags', 'custom_fields', 'lost_reason',
      'pipeline_stage_id', 'pipeline_id', 'company_id', 'contact_id',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    // If pipeline_stage_id changed, update stage_entered_at
    if (req.body.pipeline_stage_id && req.body.pipeline_stage_id !== oldDeal.pipeline_stage_id) {
      fields.push(`stage_entered_at = NOW()`);
    }

    // Status changes
    if (req.body.status === 'won') {
      fields.push(`won_date = NOW()`);
    }
    if (req.body.status === 'lost') {
      fields.push(`lost_date = NOW()`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await query(
      `UPDATE deals SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // If stage changed, create activity + audit + journey
    if (req.body.pipeline_stage_id && req.body.pipeline_stage_id !== oldDeal.pipeline_stage_id) {
      const stageResult = await query('SELECT name, is_won, is_lost FROM pipeline_stages WHERE id = $1', [req.body.pipeline_stage_id]);
      const stage = stageResult.rows[0];
      const stageName = stage?.name || 'Desconhecida';
      await query(
        `INSERT INTO deal_activities (deal_id, type, description)
         VALUES ($1, 'stage_change', $2)`,
        [id, `Movido para etapa: ${stageName}`]
      );
      const actorType = req.actorType || 'user';
      leadJourney.recordStageChange({
        dealId: id, organizationId: orgId,
        actorUserId: req.user?.id, actorType,
        fromStageId: oldDeal.pipeline_stage_id, fromStageName: oldDeal.stage_name,
        toStageId: req.body.pipeline_stage_id, toStageName: stageName,
        isWon: stage?.is_won || false, isLost: stage?.is_lost || false,
      }).catch(() => {});
      dealAudit.recordStageChange(
        id, orgId, req.user?.id, actorType,
        oldDeal.pipeline_stage_id, oldDeal.stage_name,
        req.body.pipeline_stage_id, stageName
      ).catch(() => {});
    }

    // Audit diff for other changed fields
    dealAudit.recordDiff(id, orgId, req.user?.id, req.actorType || 'user', oldDeal, req.body)
      .catch(() => {});

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Move deal to stage (with automation execution)
router.patch('/deals/:id/stage', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { pipeline_stage_id, lost_reason } = req.body;

    if (!pipeline_stage_id) {
      return res.status(400).json({ error: { message: 'pipeline_stage_id obrigatorio' } });
    }

    // Get current deal stage
    const currentDeal = await query('SELECT pipeline_stage_id FROM deals WHERE id = $1', [id]);
    if (currentDeal.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }
    const fromStageId = currentDeal.rows[0].pipeline_stage_id;

    // Get target stage info
    const stageResult = await query('SELECT name, is_won, is_lost FROM pipeline_stages WHERE id = $1', [pipeline_stage_id]);
    const stage = stageResult.rows[0];

    if (!stage) {
      return res.status(404).json({ error: { message: 'Etapa nao encontrada' } });
    }

    // Build status update
    const params = [pipeline_stage_id, id];
    let statusUpdate = '';
    if (stage.is_won) {
      statusUpdate = `, status = 'won', won_date = NOW()`;
    } else if (stage.is_lost) {
      statusUpdate = `, status = 'lost', lost_date = NOW()`;
      if (lost_reason) {
        params.push(lost_reason);
        statusUpdate += `, lost_reason = $${params.length}`;
      }
    } else {
      statusUpdate = `, status = 'open'`;
    }

    const result = await query(
      `UPDATE deals SET pipeline_stage_id = $1, stage_entered_at = NOW()${statusUpdate}, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      params
    );

    // Log activity
    await query(
      `INSERT INTO deal_activities (deal_id, type, description)
       VALUES ($1, 'stage_change', $2)`,
      [id, `Movido para etapa: ${stage.name}`]
    );

    // Execute automations for stage_change
    await executeAutomations(id, 'stage_change', {
      from_stage_id: fromStageId,
      to_stage_id: pipeline_stage_id,
    }, orgId);

    // Journey + audit
    const fromStageNameResult = await query('SELECT name FROM pipeline_stages WHERE id = $1', [fromStageId]);
    const fromStageName = fromStageNameResult.rows[0]?.name || null;
    leadJourney.recordStageChange({
      dealId: id, organizationId: orgId,
      actorUserId: req.user?.id, actorType: req.actorType || 'user',
      fromStageId, fromStageName,
      toStageId: pipeline_stage_id, toStageName: stage.name,
      isWon: stage.is_won, isLost: stage.is_lost,
    }).catch(() => {});
    dealAudit.recordStageChange(
      id, orgId, req.user?.id, req.actorType || 'user',
      fromStageId, fromStageName, pipeline_stage_id, stage.name
    ).catch(() => {});

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Motivos de perda disponíveis (para o seletor ao marcar um lead como perdido)
router.get('/loss-reasons', async (req, res) => {
  res.json({ loss_reasons: LOSS_REASONS });
});

// Delete deal
router.delete('/deals/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM deals WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }
    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// INSIGHTS (AI annotations from N8N)
// ============================================

// Add single insight
router.post('/deals/:id/insights', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { category, content, confidence, source = 'ai_agent', raw_message } = req.body;

    if (!category || !content) {
      return res.status(400).json({ error: { message: 'category e content obrigatorios' } });
    }

    const result = await query(
      `INSERT INTO deal_insights (deal_id, category, content, confidence, source, raw_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, category, content, confidence, source, raw_message]
    );

    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [id]);

    res.status(201).json({ insight: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Add multiple insights (batch from N8N)
router.post('/deals/:id/insights/batch', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { insights } = req.body;

    if (!Array.isArray(insights) || insights.length === 0) {
      return res.status(400).json({ error: { message: 'insights deve ser um array' } });
    }

    const results = [];
    for (const insight of insights) {
      const result = await query(
        `INSERT INTO deal_insights (deal_id, category, content, confidence, source, raw_message)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [id, insight.category, insight.content, insight.confidence, insight.source || 'ai_agent', insight.raw_message]
      );
      results.push(result.rows[0]);
    }

    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [id]);

    res.status(201).json({ insights: results });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ACTIVITIES
// ============================================

// List activities for deal
router.get('/deals/:id/activities', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT da.*, u.name as user_name FROM deal_activities da
       LEFT JOIN users u ON u.id = da.user_id
       WHERE da.deal_id = $1 ORDER BY da.created_at DESC`,
      [id]
    );
    res.json({ activities: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create activity (enriquecido com outcome, transcription, direction, duration)
router.post('/deals/:id/activities', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const {
      type, description, user_id, metadata, scheduled_at, completed_at,
      outcome, transcription, direction, duration_minutes,
    } = req.body;

    if (!type) {
      return res.status(400).json({ error: { message: 'type obrigatorio' } });
    }

    const result = await query(
      `INSERT INTO deal_activities
         (deal_id, user_id, type, description, metadata, scheduled_at, completed_at,
          outcome, transcription, direction, duration_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id, user_id || req.user?.id, type, description, metadata || {},
        scheduled_at || null, completed_at || null,
        outcome || null, transcription || null,
        direction || null, duration_minutes || null,
      ]
    );

    await query('UPDATE deals SET last_activity_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);

    const activity = result.rows[0];

    // Google Agenda: se a atividade tem data/hora, cria o evento na agenda do
    // responsável (usuário informado, o logado, ou o dono do deal). Nunca quebra.
    if (activity.scheduled_at) {
      try {
        const dealRes = await query(
          `SELECT owner_id, title, contact_name, contact_phone, company_name FROM deals WHERE id = $1`,
          [id]
        );
        const deal = dealRes.rows[0] || {};
        const calUserId = user_id || req.user?.id || deal.owner_id;
        if (calUserId) {
          const created = await gcal.createEventForActivity({ userId: calUserId, activity, deal });
          if (created?.eventId) {
            await query(
              `UPDATE deal_activities SET google_event_id = $1, google_calendar_id = $2 WHERE id = $3`,
              [created.eventId, created.calendarId, activity.id]
            );
            activity.google_event_id = created.eventId;
            activity.google_calendar_id = created.calendarId;
          }
        }
      } catch (e) {
        console.warn('[crm] sync Google Agenda falhou:', e.message);
      }
    }

    // Journey event (fire and forget)
    leadJourney.recordActivityLogged({
      dealId: id, organizationId: orgId,
      actorUserId: user_id || req.user?.id,
      actorType: req.actorType || 'user',
      activityType: type,
      direction: direction || null,
      isScheduled: !!scheduled_at && type === 'meeting',
    }).catch(() => {});

    dealAudit.recordChange(id, orgId, user_id || req.user?.id, req.actorType || 'user',
      'activity_added', null, null, { type, direction, outcome }, {}
    ).catch(() => {});

    res.status(201).json({ activity });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/crm/agenda ───────────────────────────────────────────────────────
// Atividades AGENDADAS (com scheduled_at) num intervalo — alimenta a visão de
// calendário do CRM. Executivo (member) vê só as dos próprios leads.
router.get('/agenda', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { start, end, user_id } = req.query;

    const params = [orgId];
    let idx = 2;
    let sql = `
      SELECT da.id, da.deal_id, da.type, da.description, da.scheduled_at,
             da.duration_minutes, da.outcome, da.google_event_id,
             da.user_id, u.name as user_name,
             d.title as deal_title, d.contact_name, d.contact_phone,
             d.company_name, d.owner_id, d.status as deal_status,
             ow.name as owner_name
      FROM deal_activities da
      JOIN deals d ON d.id = da.deal_id
      LEFT JOIN users u ON u.id = da.user_id
      LEFT JOIN users ow ON ow.id = d.owner_id
      WHERE d.organization_id = $1
        AND da.scheduled_at IS NOT NULL`;

    if (start) { sql += ` AND da.scheduled_at >= $${idx++}`; params.push(start); }
    if (end) { sql += ` AND da.scheduled_at <= $${idx++}`; params.push(end); }
    if (user_id) { sql += ` AND (da.user_id = $${idx} OR d.owner_id = $${idx})`; params.push(user_id); idx++; }

    // Escopo por dono: member só vê a própria agenda.
    if (isOwnerScoped(req)) { sql += ` AND d.owner_id = $${idx++}`; params.push(req.user.id); }

    sql += ` ORDER BY da.scheduled_at ASC`;

    const result = await query(sql, params);
    res.json({ activities: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

// ============================================
// CONTACTS (multiple per deal)
// ============================================

// List contacts for deal
router.get('/deals/:id/contacts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT * FROM deal_contacts WHERE deal_id = $1 ORDER BY is_primary DESC, created_at',
      [id]
    );
    res.json({ contacts: result.rows });
  } catch (error) {
    next(error);
  }
});

// Add contact to deal
router.post('/deals/:id/contacts', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role, is_primary, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: { message: 'name e obrigatorio' } });
    }

    // If is_primary, unset other primary contacts for this deal
    if (is_primary) {
      await query('UPDATE deal_contacts SET is_primary = false WHERE deal_id = $1', [id]);
    }

    const result = await query(
      `INSERT INTO deal_contacts (deal_id, name, email, phone, role, is_primary, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, name, email || null, phone || null, role || null, is_primary || false, notes || null]
    );

    res.status(201).json({ contact: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update contact
router.patch('/deals/:id/contacts/:contactId', async (req, res, next) => {
  try {
    const { id, contactId } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['name', 'email', 'phone', 'role', 'is_primary', 'notes'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    // If setting as primary, unset others first
    if (req.body.is_primary) {
      await query('UPDATE deal_contacts SET is_primary = false WHERE deal_id = $1', [id]);
    }

    values.push(contactId);
    values.push(id);

    const result = await query(
      `UPDATE deal_contacts SET ${fields.join(', ')}
       WHERE id = $${idx++} AND deal_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Contato nao encontrado' } });
    }

    res.json({ contact: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete contact
router.delete('/deals/:id/contacts/:contactId', async (req, res, next) => {
  try {
    const { id, contactId } = req.params;
    const result = await query(
      'DELETE FROM deal_contacts WHERE id = $1 AND deal_id = $2 RETURNING id',
      [contactId, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Contato nao encontrado' } });
    }

    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// AUTOMATIONS
// ============================================

// List automations for org
router.get('/automations', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await query(
      'SELECT * FROM deal_automations WHERE organization_id = $1 ORDER BY created_at DESC',
      [orgId]
    );
    res.json({ automations: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create automation
router.post('/automations', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, trigger_type, trigger_config, action_type, action_config } = req.body;

    if (!name || !trigger_type || !action_type) {
      return res.status(400).json({ error: { message: 'name, trigger_type e action_type obrigatorios' } });
    }

    const result = await query(
      `INSERT INTO deal_automations (organization_id, name, trigger_type, trigger_config, action_type, action_config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orgId, name, trigger_type, trigger_config || {}, action_type, action_config || {}]
    );

    res.status(201).json({ automation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update automation
router.patch('/automations/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['name', 'trigger_type', 'trigger_config', 'action_type', 'action_config', 'is_active'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    fields.push('updated_at = NOW()');
    values.push(id);
    values.push(orgId);

    const result = await query(
      `UPDATE deal_automations SET ${fields.join(', ')}
       WHERE id = $${idx++} AND organization_id = $${idx}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Automacao nao encontrada' } });
    }

    res.json({ automation: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Delete automation
router.delete('/automations/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    const result = await query(
      'DELETE FROM deal_automations WHERE id = $1 AND organization_id = $2 RETURNING id',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Automacao nao encontrada' } });
    }

    res.json({ deleted: true });
  } catch (error) {
    next(error);
  }
});

// Get automation execution history
router.get('/automations/:id/log', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    // Verify automation belongs to org
    const automationCheck = await query(
      'SELECT id FROM deal_automations WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (automationCheck.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Automacao nao encontrada' } });
    }

    const result = await query(
      `SELECT dal.*, d.title as deal_title
       FROM deal_automation_log dal
       LEFT JOIN deals d ON d.id = dal.deal_id
       WHERE dal.automation_id = $1
       ORDER BY dal.created_at DESC
       LIMIT 100`,
      [id]
    );

    res.json({ log: result.rows });
  } catch (error) {
    next(error);
  }
});

// ============================================
// STATS / DASHBOARD
// ============================================

router.get('/stats', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { pipeline_id } = req.query;

    // Build pipeline filter clause
    const pipelineFilter = pipeline_id ? ' AND pipeline_id = $2' : '';
    const pipelineStageFilter = pipeline_id ? ' AND ps.pipeline_id = $2' : '';
    const dealsPipelineFilter = pipeline_id ? ' AND d.pipeline_id = $2' : '';
    const baseParams = pipeline_id ? [orgId, pipeline_id] : [orgId];

    // Escopo por dono: executivo (member) só vê métricas dos próprios leads.
    const scoped = isOwnerScoped(req);
    if (scoped) baseParams.push(req.user.id);
    const oIdx = baseParams.length;                       // índice do param do dono (último)
    const ofDeals = scoped ? ` AND owner_id = $${oIdx}` : '';   // tabela deals (sem alias)
    const ofD = scoped ? ` AND d.owner_id = $${oIdx}` : '';     // alias d.

    const [dealsResult, stagesResult, recentResult, rottingResult, avgCloseResult] = await Promise.all([
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open') as open_deals,
           COUNT(*) FILTER (WHERE status = 'won') as won_deals,
           COUNT(*) FILTER (WHERE status = 'lost') as lost_deals,
           COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0) as pipeline_value,
           COALESCE(SUM(value) FILTER (WHERE status = 'won'), 0) as won_value,
           COUNT(*) FILTER (WHERE status = 'won' AND won_date >= NOW() - INTERVAL '30 days') as won_last_30d,
           COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as new_last_7d
         FROM deals WHERE organization_id = $1${pipelineFilter}${ofDeals}`,
        baseParams
      ),
      query(
        `SELECT ps.id, ps.name, ps.color, ps.position, ps.max_days,
                COUNT(d.id) as deal_count,
                COALESCE(SUM(d.value), 0) as total_value,
                COALESCE(
                  AVG(EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400),
                  0
                ) as avg_days_in_stage
         FROM pipeline_stages ps
         LEFT JOIN deals d ON d.pipeline_stage_id = ps.id AND d.status = 'open'${ofD}
         WHERE ps.organization_id = $1${pipelineStageFilter}
         GROUP BY ps.id, ps.name, ps.color, ps.position, ps.max_days
         ORDER BY ps.position`,
        baseParams
      ),
      query(
        `SELECT da.*, d.title as deal_title, u.name as user_name
         FROM deal_activities da
         JOIN deals d ON d.id = da.deal_id
         LEFT JOIN users u ON u.id = da.user_id
         WHERE d.organization_id = $1${dealsPipelineFilter}${ofD}
         ORDER BY da.created_at DESC LIMIT 15`,
        baseParams
      ),
      query(
        `SELECT COUNT(*) as count
         FROM deals d
         JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         WHERE d.organization_id = $1${dealsPipelineFilter}${ofD}
           AND d.status = 'open'
           AND ps.max_days IS NOT NULL
           AND EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400 > ps.max_days`,
        baseParams
      ),
      query(
        `SELECT COALESCE(
           AVG(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400),
           0
         ) as avg_days_to_close
         FROM deals
         WHERE organization_id = $1${pipelineFilter} AND status = 'won' AND won_date IS NOT NULL${ofDeals}`,
        baseParams
      ),
    ]);

    const stats = dealsResult.rows[0];
    const wonCount = parseInt(stats.won_deals) || 0;
    const lostCount = parseInt(stats.lost_deals) || 0;
    const conversionRate = (wonCount + lostCount) > 0
      ? Math.round((wonCount / (wonCount + lostCount)) * 10000) / 100
      : 0;

    res.json({
      stats: {
        ...stats,
        avg_days_to_close: Math.round(avgCloseResult.rows[0].avg_days_to_close * 100) / 100,
        conversion_rate: conversionRate,
        rotting_deals: parseInt(rottingResult.rows[0].count) || 0,
      },
      stages_summary: stagesResult.rows.map((s) => ({
        ...s,
        avg_days_in_stage: Math.round(s.avg_days_in_stage * 100) / 100,
      })),
      recent_activities: recentResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// REGISTER LEAD (N8N transactional endpoint)
// ============================================
// CNPJ Lookup via BrasilAPI
// ============================================
router.get('/cnpj/:cnpj', async (req, res, next) => {
  try {
    const digits = req.params.cnpj.replace(/\D/g, '');
    if (digits.length !== 14) return res.status(400).json({ error: 'CNPJ deve ter 14 dígitos' });

    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (!response.ok) return res.status(404).json({ error: 'CNPJ não encontrado' });

    const data = await response.json();
    res.json({
      cnpj: data.cnpj,
      razao_social: data.razao_social,
      nome_fantasia: data.nome_fantasia,
      segment: data.cnae_fiscal_descricao,
      city: data.municipio,
      state: data.uf,
      phone: data.ddd_telefone_1 || null,
      email: data.email || null,
      endereco: data.logradouro ? `${data.logradouro}, ${data.numero} - ${data.bairro}` : null,
      cep: data.cep,
      situacao: data.descricao_situacao_cadastral,
      abertura: data.data_inicio_atividade,
    });
  } catch (err) { next(err); }
});

// ============================================
// Single call: creates contact + company + deal in one go
router.post('/register-lead', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const {
      contact_name, contact_phone, contact_email,
      company_name, company_cnpj, company_segment, company_city, company_state,
      pipeline_name, pipeline_stage_name, deal_title, source = 'whatsapp', source_detail = null,
      temperature = 'warm', value,
    } = req.body;

    if (!contact_name && !contact_phone) {
      return res.status(400).json({ error: { message: 'contact_name ou contact_phone obrigatorio' } });
    }

    let contactId = null;
    let companyId = null;

    // 1. Find or create company
    if (company_name) {
      const existing = await query(
        'SELECT id FROM companies WHERE organization_id = $1 AND name = $2 LIMIT 1',
        [orgId, company_name]
      );
      if (existing.rows.length > 0) {
        companyId = existing.rows[0].id;
      } else {
        const created = await query(
          `INSERT INTO companies (organization_id, name, cnpj, segment, city, state)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [orgId, company_name, company_cnpj || null, company_segment || null, company_city || null, company_state || null]
        );
        companyId = created.rows[0].id;
      }
    }

    // 2. Find or create contact (by phone)
    if (contact_phone) {
      const existing = await query(
        'SELECT id FROM contacts WHERE organization_id = $1 AND phone = $2 LIMIT 1',
        [orgId, contact_phone]
      );
      if (existing.rows.length > 0) {
        contactId = existing.rows[0].id;
        // Update company link if needed
        if (companyId) {
          await query('UPDATE contacts SET company_id = $1, updated_at = NOW() WHERE id = $2 AND company_id IS NULL', [companyId, contactId]);
        }
      } else {
        const created = await query(
          `INSERT INTO contacts (organization_id, company_id, name, email, phone)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [orgId, companyId, contact_name || 'Sem nome', contact_email || null, contact_phone]
        );
        contactId = created.rows[0].id;
      }
    } else {
      // No phone — create contact by name
      const created = await query(
        `INSERT INTO contacts (organization_id, company_id, name, email)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [orgId, companyId, contact_name, contact_email || null]
      );
      contactId = created.rows[0].id;
    }

    // 3. Find pipeline by name (or use first active)
    let pipelineId = null;
    if (pipeline_name) {
      const pResult = await query(
        'SELECT id FROM pipelines WHERE organization_id = $1 AND name = $2 AND is_active = true LIMIT 1',
        [orgId, pipeline_name]
      );
      pipelineId = pResult.rows[0]?.id || null;
    }
    if (!pipelineId) {
      const pResult = await query(
        'SELECT id FROM pipelines WHERE organization_id = $1 AND is_active = true ORDER BY position LIMIT 1',
        [orgId]
      );
      pipelineId = pResult.rows[0]?.id || null;
    }

    // 4. Get stage of the pipeline (by name if provided, otherwise first)
    let stageId = null;
    if (pipelineId && pipeline_stage_name) {
      const sResult = await query(
        `SELECT id FROM pipeline_stages
         WHERE organization_id = $1 AND pipeline_id = $2 AND name ILIKE $3
         ORDER BY position LIMIT 1`,
        [orgId, pipelineId, pipeline_stage_name]
      );
      stageId = sResult.rows[0]?.id || null;
    }
    if (!stageId && pipelineId) {
      const sResult = await query(
        `SELECT id FROM pipeline_stages
         WHERE organization_id = $1 AND pipeline_id = $2 AND is_won = false AND is_lost = false
         ORDER BY position LIMIT 1`,
        [orgId, pipelineId]
      );
      stageId = sResult.rows[0]?.id || null;
    }

    // 5. Create deal
    const dealResult = await query(
      `INSERT INTO deals (organization_id, pipeline_id, pipeline_stage_id, title,
        contact_name, contact_phone, contact_email, company_name,
        company_id, contact_id, source, source_detail, temperature, value, tags, custom_fields, stage_entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
       RETURNING *`,
      [
        orgId, pipelineId, stageId,
        deal_title || `Lead - ${contact_name || contact_phone}`,
        contact_name, contact_phone, contact_email, company_name,
        companyId, contactId, source, source_detail, temperature, value || null, [], {},
      ]
    );

    const deal = dealResult.rows[0];

    // 6. Log activity
    await query(
      `INSERT INTO deal_activities (deal_id, type, description)
       VALUES ($1, 'note', $2)`,
      [deal.id, `Lead registrado via ${source}${pipeline_name ? ' - Funil: ' + pipeline_name : ''}`]
    );

    // Return all created entities
    const [contactData, companyData] = await Promise.all([
      contactId ? query('SELECT * FROM contacts WHERE id = $1', [contactId]) : { rows: [] },
      companyId ? query('SELECT * FROM companies WHERE id = $1', [companyId]) : { rows: [] },
    ]);

    res.status(201).json({
      deal,
      contact: contactData.rows[0] || null,
      company: companyData.rows[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// FOLLOW-UP ENDPOINTS (continuação)
// O endpoint GET /deals/followup-candidates foi movido pra antes de /deals/:id
// pra não ser capturado pelo wildcard (cast pra UUID falhava).
// ============================================

/**
 * PATCH /api/crm/deals/:id/followup
 * Registra que um follow-up foi enviado. Incrementa counter e atualiza timestamp.
 */
router.patch('/deals/:id/followup', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { message_sent, followup_text } = req.body;
    const followupNote = message_sent || followup_text;

    // Incrementa followup_count e atualiza last_followup_at
    const result = await query(
      `UPDATE deals
       SET followup_count = COALESCE(followup_count, 0) + 1,
           last_followup_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    // Registra como atividade
    if (followupNote) {
      await query(
        `INSERT INTO deal_activities (deal_id, organization_id, type, description)
         VALUES ($1, $2, 'followup', $3)`,
        [id, orgId, `Follow-up #${result.rows[0].followup_count} enviado: ${String(followupNote).slice(0, 500)}`]
      );
    }

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/assign-owner-by-phone
 * Atribui um executivo (owner) a TODOS os deals abertos de um contato pelo telefone.
 *
 * Usado pelo workflow notificar_equipe quando um lead é transferido.
 * Resolve o user_id pelo email do executivo.
 *
 * Body: { phone: "5511...", executivo_email: "andre@..." }
 * Retorna: { updated, deal_ids, owner_id, owner_name }
 */
router.post('/deals/assign-owner-by-phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone, executivo_email } = req.body;

    if (!phone || !executivo_email) {
      return res.status(400).json({ error: { message: 'phone e executivo_email obrigatorios' } });
    }

    // 1. Resolve user_id pelo email
    const userResult = await query(
      'SELECT id, name FROM users WHERE organization_id = $1 AND email = $2 AND is_active = true LIMIT 1',
      [orgId, executivo_email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: { message: `executivo nao encontrado: ${executivo_email}` }
      });
    }

    const owner = userResult.rows[0];
    const cleanPhone = String(phone).replace(/\D/g, '');

    // 2. Atualiza owner_id de todos os deals abertos do contato
    // Tambem registra assigned_via, assigned_at, assigned_by para rastreabilidade
    const result = await query(
      `UPDATE deals d
       SET owner_id = $3,
           assigned_via = COALESCE($4, 'notificar_equipe'),
           assigned_at = NOW(),
           assigned_by = COALESCE($5, 'system'),
           updated_at = NOW()
       FROM contacts c
       WHERE d.contact_id = c.id
         AND d.organization_id = $1
         AND d.status = 'open'
         AND REGEXP_REPLACE(c.phone, '\\D', '', 'g') = $2
       RETURNING d.id, c.name AS contact_name`,
      [orgId, cleanPhone, owner.id, req.body.assigned_via || null, req.body.assigned_by || null]
    );

    // Journey + audit + atividade de contato para cada deal atualizado
    for (const row of result.rows) {
      leadJourney.recordOwnerAssigned({
        dealId: row.id, organizationId: orgId,
        actorUserId: null, actorType: 'rica',
        ownerId: owner.id, ownerName: owner.name,
      }).catch(() => {});
      dealAudit.recordOwnerAssigned(row.id, orgId, null, 'rica', owner.id, owner.name).catch(() => {});

      // Registra atividade "entrar em contato" — aparece no CRM como tarefa pendente
      query(
        `INSERT INTO deal_activities (deal_id, user_id, type, description, scheduled_at, metadata)
         VALUES ($1, $2, 'call', $3, NOW(), $4)`,
        [
          row.id,
          owner.id,
          `Entrar em contato com ${row.contact_name || 'o lead'}`,
          { source: 'rica_transfer', assigned_via: req.body.assigned_via || 'notificar_equipe' },
        ]
      ).catch(() => {});
    }

    res.json({
      updated: result.rows.length,
      deal_ids: result.rows.map(r => r.id),
      owner_id: owner.id,
      owner_name: owner.name,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/client-message-by-phone
 * Dispara quando qualquer mensagem do cliente chega. Reseta o counter de follow-ups
 * de TODOS os deals abertos que o contato tem (em qualquer funil).
 *
 * Body: { phone: "5511999999999" }
 * Seguro chamar mesmo se o contato nao existe no CRM (retorna updated: 0).
 */
router.post('/client-message-by-phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: { message: 'phone obrigatorio' } });
    }

    // Normaliza telefone - remove nao-digitos
    const cleanPhone = String(phone).replace(/\D/g, '');

    const result = await query(
      `UPDATE deals
       SET last_client_message_at = NOW(),
           followup_count = 0,
           updated_at = NOW()
       WHERE organization_id = $1
         AND status = 'open'
         AND contact_id IN (
           SELECT id FROM contacts
           WHERE organization_id = $1
             AND REGEXP_REPLACE(phone, '\\D', '', 'g') = $2
         )
       RETURNING id`,
      [orgId, cleanPhone]
    );

    res.json({ updated: result.rows.length, deal_ids: result.rows.map(r => r.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/:id/client-message
 * Registra que o cliente enviou uma mensagem. Reseta o counter de follow-ups
 * e atualiza last_client_message_at.
 */
router.post('/deals/:id/client-message', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    const result = await query(
      `UPDATE deals
       SET last_client_message_at = NOW(),
           followup_count = 0,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, followup_count, last_client_message_at`,
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/close-inactive
 * Fecha em massa todos os deals com followup_count >= 3 e ultimo followup ha mais de N dias.
 * Query param: days (default 7)
 */
router.post('/deals/close-inactive', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const days = parseInt(req.query.days) || 7;

    const candidates = await query(
      `SELECT d.id, d.pipeline_id
       FROM deals d
       WHERE d.organization_id = $1
         AND d.status = 'open'
         AND COALESCE(d.followup_count, 0) >= 3
         AND d.last_followup_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (NOW() - d.last_followup_at)) / 86400 >= $2`,
      [orgId, days]
    );

    let closed = 0;
    for (const deal of candidates.rows) {
      const lostStage = await query(
        `SELECT id FROM pipeline_stages
         WHERE organization_id = $1 AND pipeline_id = $2 AND is_lost = true
         ORDER BY position DESC LIMIT 1`,
        [orgId, deal.pipeline_id]
      );

      await query(
        `UPDATE deals
         SET status = 'lost',
             lost_reason = 'sem_resposta_followup',
             pipeline_stage_id = COALESCE($3, pipeline_stage_id),
             closed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [deal.id, orgId, lostStage.rows[0]?.id || null]
      );

      await query(
        `INSERT INTO deal_activities (deal_id, organization_id, type, description)
         VALUES ($1, $2, 'system', 'Deal encerrado automaticamente - sem resposta apos 3 follow-ups')`,
        [deal.id, orgId]
      );
      closed++;
    }

    res.json({ closed, total_candidates: candidates.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/crm/deals/:id/close-no-response
 * Marca deal como perdido por ausencia de resposta apos X follow-ups.
 */
router.patch('/deals/:id/close-no-response', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    // Buscar o estagio "Perdido" do pipeline do deal
    const dealInfo = await query(
      'SELECT pipeline_id FROM deals WHERE id = $1 AND organization_id = $2',
      [id, orgId]
    );

    if (dealInfo.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    const lostStage = await query(
      `SELECT id FROM pipeline_stages
       WHERE organization_id = $1 AND pipeline_id = $2 AND is_lost = true
       ORDER BY position DESC LIMIT 1`,
      [orgId, dealInfo.rows[0].pipeline_id]
    );

    const result = await query(
      `UPDATE deals
       SET status = 'lost',
           lost_reason = 'sem_resposta_followup',
           pipeline_stage_id = COALESCE($3, pipeline_stage_id),
           closed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING *`,
      [id, orgId, lostStage.rows[0]?.id || null]
    );

    await query(
      `INSERT INTO deal_activities (deal_id, organization_id, type, description)
       VALUES ($1, $2, 'system', 'Deal encerrado automaticamente - sem resposta apos follow-ups')`,
      [id, orgId]
    );

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// ============================================
// MENSAGENS (RASTREABILIDADE TOTAL)
// ============================================

/**
 * POST /api/crm/messages
 * Registra uma mensagem trocada com o cliente (in/out).
 * Pode ser chamado pelo workflow Rica em paralelo (nao bloqueia).
 *
 * Body: {
 *   phone: "5511...",         // OBRIGATORIO
 *   direction: "in" | "out",  // OBRIGATORIO
 *   text: string,
 *   sender: "cliente" | "rica_ai" | "system_followup" | "executive" | "system_catchup",
 *   content_type: "text" | "image" | "audio" | "document" | "system_note",
 *   media_url: string (opcional),
 *   sent_at: ISO timestamp (opcional, default NOW()),
 *   n8n_execution_id: string (opcional),
 *   workflow_name: string (opcional),
 *   raw_payload: object (opcional)
 * }
 *
 * Resolve automaticamente contact_id e deal_id (mais recente aberto) pelo phone.
 * Retorna o message_id criado.
 */
router.post('/messages', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const {
      phone, direction, text, sender,
      content_type = 'text', media_url = null,
      sent_at = null, deal_id: bodyDealId = null,
      workflow_name = null,
    } = req.body;

    if (!phone || !direction) {
      return res.status(400).json({ error: { message: 'phone e direction obrigatorios' } });
    }
    if (!['in', 'out'].includes(direction)) {
      return res.status(400).json({ error: { message: 'direction deve ser "in" ou "out"' } });
    }

    const cleanPhone = String(phone).replace(/\D/g, '');

    // Resolve deal_id pelo telefone se não veio no body
    let deal_id = bodyDealId || null;
    if (!deal_id) {
      const contactRes = await query(
        `SELECT c.id as contact_id, d.id as deal_id
         FROM contacts c
         LEFT JOIN deals d ON d.contact_id = c.id AND d.organization_id = $1 AND d.status = 'open'
         WHERE c.organization_id = $1
           AND REGEXP_REPLACE(c.phone, '\\D', '', 'g') = $2
         ORDER BY d.created_at DESC NULLS LAST
         LIMIT 1`,
        [orgId, cleanPhone]
      );
      deal_id = contactRes.rows[0]?.deal_id || null;
    }

    // Mapeia campos do Rica para schema real da tabela deal_messages:
    // direction+sender → role (lead=cliente in, rica_ai=rica out)
    const role = direction === 'in' ? (sender || 'lead') : (sender || 'rica_ai');
    const channel = 'whatsapp';
    const mediaType = content_type !== 'text' ? content_type : null;

    const result = await query(
      `INSERT INTO deal_messages
        (organization_id, deal_id, role, channel, content, media_url, media_type,
         rica_session_id, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()))
       RETURNING id, occurred_at`,
      [
        orgId, deal_id, role, channel, text || null, media_url, mediaType,
        cleanPhone,
        JSON.stringify({ direction, sender, workflow_name }),
        sent_at,
      ]
    );

    res.status(201).json({
      message_id: result.rows[0].id,
      sent_at: result.rows[0].occurred_at,
      deal_id,
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEAL MESSAGES (Conversa Rica)
// ============================================

/**
 * POST /api/crm/deals/:id/messages
 * Grava uma mensagem da conversa. Idempotente via external_message_id.
 * Chamado pelo workflow n8n a cada turno da conversa.
 *
 * Body: { role, channel, content, media_url, media_type,
 *         external_message_id, rica_session_id, metadata, occurred_at }
 */
router.post('/deals/:id/messages', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const {
      role = 'client', channel = 'whatsapp', content,
      media_url, media_type, external_message_id,
      rica_session_id, metadata = {}, occurred_at,
    } = req.body;

    if (!content) return res.status(400).json({ error: { message: 'content obrigatorio' } });

    const result = await query(
      `INSERT INTO deal_messages
         (deal_id, organization_id, role, channel, content, media_url, media_type,
          external_message_id, rica_session_id, metadata, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, NOW()))
       ON CONFLICT (deal_id, external_message_id) DO UPDATE
         SET content = EXCLUDED.content, metadata = EXCLUDED.metadata
       RETURNING *`,
      [id, orgId, role, channel, content, media_url || null, media_type || null,
       external_message_id || null, rica_session_id || null,
       JSON.stringify(metadata), occurred_at || null]
    );

    const msg = result.rows[0];

    // Atualizar last_client_message_at e rica_session_id no deal
    if (role === 'client') {
      await query(
        `UPDATE deals SET last_client_message_at = COALESCE($2::timestamptz, NOW()),
         rica_session_id = COALESCE(rica_session_id, $3), updated_at = NOW() WHERE id = $1`,
        [id, occurred_at || null, rica_session_id || null]
      );
    }

    // Evento de jornada
    leadJourney.recordEvent({
      dealId: id, organizationId: orgId, eventType: 'rica_message',
      actorType: role === 'rica' ? 'rica' : (role === 'client' ? 'system' : 'user'),
      toValue: { role, channel, external_message_id },
      metadata: { rica_session_id },
    }).catch(() => {});

    res.status(201).json({ message: msg });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/deals/:id/messages
 * Retorna mensagens de um deal, com paginacao por cursor (before) e campos enriquecidos.
 */
router.get('/deals/:id/messages', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { before } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

    let sql = `SELECT id, role, channel, content as text, media_url, media_type,
              rica_session_id as phone, metadata, occurred_at as sent_at, created_at,
              metadata->>'direction' as direction,
              metadata->>'sender' as sender
       FROM deal_messages
       WHERE deal_id = $1 AND organization_id = $2`;
    const params = [id, orgId];
    let idx = 3;

    if (before) {
      sql += ` AND occurred_at < $${idx++}`;
      params.push(before);
    }

    sql += ` ORDER BY occurred_at ASC LIMIT $${idx}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json({ messages: result.rows, total: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/contacts/:phone/messages
 * Retorna todas mensagens trocadas com o telefone, mesmo que ainda nao tenha deal_id.
 */
router.get('/contacts/by-phone/:phone/messages', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const cleanPhone = String(req.params.phone).replace(/\D/g, '');
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

    const result = await query(
      `SELECT id, deal_id, role, channel, content as text, media_url, media_type,
              rica_session_id as phone, metadata, occurred_at as sent_at, created_at,
              metadata->>'direction' as direction,
              metadata->>'sender' as sender
       FROM deal_messages
       WHERE organization_id = $1
         AND rica_session_id = $2
       ORDER BY occurred_at ASC
       LIMIT $3`,
      [orgId, cleanPhone, limit]
    );
    res.json({ messages: result.rows, total: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/:id/source-detail
 * Atualiza o source_detail de um deal (origem detalhada do trafego).
 * Usado pelo workflow da Rica quando detecta a fonte (anuncio_gps_padaria, etc).
 */
router.post('/deals/:id/source-detail', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { source_detail } = req.body;
    if (!source_detail) {
      return res.status(400).json({ error: { message: 'source_detail obrigatorio' } });
    }
    const result = await query(
      `UPDATE deals SET source_detail = $3, updated_at = NOW()
       WHERE id = $1 AND organization_id = $2
       RETURNING id, source_detail`,
      [id, orgId, source_detail]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'deal nao encontrado' } });
    }
    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/:id/messages/batch
 * Insere multiplas mensagens de uma vez (bulk import).
 */
router.post('/deals/:id/messages/batch', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages deve ser um array nao vazio' } });
    }

    const inserted = [];
    for (const m of messages) {
      const r = await query(
        `INSERT INTO deal_messages
           (deal_id, organization_id, role, channel, content, media_url, media_type,
            external_message_id, rica_session_id, metadata, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11::timestamptz, NOW()))
         ON CONFLICT (deal_id, external_message_id) DO NOTHING
         RETURNING *`,
        [id, orgId, m.role || 'client', m.channel || 'whatsapp', m.content,
         m.media_url || null, m.media_type || null, m.external_message_id || null,
         m.rica_session_id || null, JSON.stringify(m.metadata || {}), m.occurred_at || null]
      );
      if (r.rows.length > 0) inserted.push(r.rows[0]);
    }

    res.status(201).json({ inserted: inserted.length, messages: inserted });
  } catch (error) {
    next(error);
  }
});

// ============================================
// LEAD JOURNEY (Rastreabilidade)
// ============================================

/**
 * GET /api/crm/deals/:id/journey
 * Retorna os eventos da jornada do lead em ordem cronologica.
 */
router.get('/deals/:id/journey', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT lj.*, u.name as actor_name
       FROM lead_journey_events lj
       LEFT JOIN users u ON u.id = lj.actor_user_id
       WHERE lj.deal_id = $1
       ORDER BY lj.occurred_at ASC`,
      [id]
    );
    res.json({ events: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/source-detail-by-phone
 * Mesma coisa que /deals/:id/source-detail mas resolve pelo telefone.
 * Aplica em todos os deals abertos do contato.
 */
router.post('/deals/source-detail-by-phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone, source_detail } = req.body;
    if (!phone || !source_detail) {
      return res.status(400).json({ error: { message: 'phone e source_detail obrigatorios' } });
    }
    const cleanPhone = String(phone).replace(/\D/g, '');
    const result = await query(
      `UPDATE deals d
       SET source_detail = $3, updated_at = NOW()
       FROM contacts c
       WHERE d.contact_id = c.id
         AND d.organization_id = $1
         AND d.status = 'open'
         AND REGEXP_REPLACE(c.phone, '\\D', '', 'g') = $2
       RETURNING d.id`,
      [orgId, cleanPhone, source_detail]
    );
    res.json({ updated: result.rows.length, deal_ids: result.rows.map(r => r.id) });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/journey/funnel
 * Agrega contagens e tempo medio por tipo de evento (para dashboard de jornada).
 * Query params: pipeline_id, from, to, first_channel
 */
router.get('/journey/funnel', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { pipeline_id, from, to, first_channel } = req.query;

    // Contagem de deals que passaram por cada evento
    let dealFilter = `WHERE d.organization_id = $1`;
    const params = [orgId];
    let idx = 2;

    if (pipeline_id) { dealFilter += ` AND d.pipeline_id = $${idx++}`; params.push(pipeline_id); }
    if (from) { dealFilter += ` AND d.created_at >= $${idx++}`; params.push(from); }
    if (to) { dealFilter += ` AND d.created_at <= $${idx++}`; params.push(to); }
    if (first_channel) { dealFilter += ` AND d.first_channel = $${idx++}`; params.push(first_channel); }

    const result = await query(
      `WITH filtered_deals AS (
         SELECT d.id FROM deals d ${dealFilter}
       ),
       event_counts AS (
         SELECT lj.event_type,
                COUNT(DISTINCT lj.deal_id) as deals_reached,
                AVG(EXTRACT(EPOCH FROM (lj.occurred_at - d.created_at))/3600) as avg_hours_from_creation
         FROM lead_journey_events lj
         JOIN filtered_deals fd ON fd.id = lj.deal_id
         JOIN deals d ON d.id = lj.deal_id
         GROUP BY lj.event_type
       )
       SELECT * FROM event_counts
       ORDER BY deals_reached DESC`,
      params
    );

    // Total de leads no periodo
    const totalResult = await query(
      `SELECT COUNT(*) as total FROM deals d ${dealFilter}`,
      params
    );

    res.json({
      funnel: result.rows,
      total_leads: parseInt(totalResult.rows[0]?.total || 0),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/metrics/owner/:user_id?from=2026-05-01&to=2026-05-31
 * Retorna metricas de leads atribuidos a um executivo no periodo.
 */
router.get('/metrics/owner/:user_id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { user_id } = req.params;
    const from = req.query.from || '1970-01-01';
    const to = req.query.to || new Date().toISOString();

    const summary = await query(
      `SELECT
         COUNT(*) FILTER (WHERE assigned_via = 'notificar_equipe') AS via_notificar,
         COUNT(*) FILTER (WHERE assigned_via = 'manual') AS via_manual,
         COUNT(*) FILTER (WHERE assigned_via = 'catchup') AS via_catchup,
         COUNT(*) FILTER (WHERE assigned_via = 'reassigned') AS via_reassigned,
         COUNT(*) FILTER (WHERE assigned_via = 'historico') AS via_historico,
         COUNT(*) AS total
       FROM deals
       WHERE organization_id = $1
         AND owner_id = $2
         AND assigned_at >= $3
         AND assigned_at <= $4`,
      [orgId, user_id, from, to]
    );

    const bySource = await query(
      `SELECT source_detail, COUNT(*) AS count
       FROM deals
       WHERE organization_id = $1 AND owner_id = $2
         AND assigned_at >= $3 AND assigned_at <= $4
       GROUP BY source_detail ORDER BY count DESC`,
      [orgId, user_id, from, to]
    );

    const byPipeline = await query(
      `SELECT p.name AS pipeline, COUNT(*) AS count
       FROM deals d LEFT JOIN pipelines p ON p.id = d.pipeline_id
       WHERE d.organization_id = $1 AND d.owner_id = $2
         AND d.assigned_at >= $3 AND d.assigned_at <= $4
       GROUP BY p.name ORDER BY count DESC`,
      [orgId, user_id, from, to]
    );

    res.json({
      user_id, from, to,
      summary: summary.rows[0],
      by_source_detail: bySource.rows,
      by_pipeline: byPipeline.rows,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/journey/sources
 * Breakdown de leads por first_channel e UTM source.
 */
router.get('/journey/sources', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { from, to } = req.query;

    let where = 'WHERE d.organization_id = $1';
    const params = [orgId];
    let idx = 2;
    if (from) { where += ` AND d.created_at >= $${idx++}`; params.push(from); }
    if (to) { where += ` AND d.created_at <= $${idx++}`; params.push(to); }

    const result = await query(
      `SELECT
         COALESCE(d.first_channel, 'unknown') as channel,
         COALESCE(d.utm_source, 'direct') as utm_source,
         d.utm_medium, d.utm_campaign,
         COUNT(*) as leads,
         COUNT(*) FILTER (WHERE d.status = 'won') as won,
         COUNT(*) FILTER (WHERE d.status = 'lost') as lost,
         COALESCE(SUM(d.value) FILTER (WHERE d.status = 'won'), 0) as won_value
       FROM deals d
       ${where}
       GROUP BY d.first_channel, d.utm_source, d.utm_medium, d.utm_campaign
       ORDER BY leads DESC`,
      params
    );

    res.json({ sources: result.rows });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/journey/distribution?from=...&to=...
 * Status de distribuição dos leads: quantos foram para executivos e
 * quantos continuam sem dono (parados na entrada). Mais a quebra por executivo.
 */
router.get('/journey/distribution', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { from, to } = req.query;

    let where = 'WHERE d.organization_id = $1';
    const params = [orgId];
    let idx = 2;
    if (from) { where += ` AND d.created_at >= $${idx++}`; params.push(from); }
    if (to) { where += ` AND d.created_at <= $${idx++}`; params.push(to); }

    // Totais: distribuídos (tem owner) vs não distribuídos (sem owner)
    const totals = await query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE d.owner_id IS NOT NULL) AS distributed,
         COUNT(*) FILTER (WHERE d.owner_id IS NULL) AS undistributed
       FROM deals d ${where}`,
      params
    );

    // Quebra por executivo (apenas leads com dono)
    const byExec = await query(
      `SELECT u.name AS executive,
         COUNT(*) AS leads,
         COUNT(*) FILTER (WHERE d.status = 'won') AS won,
         COUNT(*) FILTER (WHERE d.status = 'lost') AS lost,
         COUNT(*) FILTER (WHERE d.status NOT IN ('won','lost')) AS open
       FROM deals d
       JOIN users u ON u.id = d.owner_id
       ${where}
       GROUP BY u.name
       ORDER BY leads DESC`,
      params
    );

    // Onde os não distribuídos estão parados (por funil)
    const undistByPipeline = await query(
      `SELECT COALESCE(p.name, '—') AS pipeline, COUNT(*) AS leads
       FROM deals d
       LEFT JOIN pipelines p ON p.id = d.pipeline_id
       ${where} AND d.owner_id IS NULL
       GROUP BY p.name
       ORDER BY leads DESC`,
      params
    );

    const t = totals.rows[0] || {};
    res.json({
      total_leads: parseInt(t.total || 0),
      distributed: parseInt(t.distributed || 0),
      undistributed: parseInt(t.undistributed || 0),
      by_executive: byExec.rows.map(r => ({
        executive: r.executive,
        leads: parseInt(r.leads),
        won: parseInt(r.won),
        lost: parseInt(r.lost),
        open: parseInt(r.open),
      })),
      undistributed_by_pipeline: undistByPipeline.rows.map(r => ({
        pipeline: r.pipeline,
        leads: parseInt(r.leads),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// COCKPIT DO GESTOR
// ============================================

/**
 * GET /api/crm/manager/overview
 * Painel de controle do gestor: saúde do pipeline, accountability por executivo,
 * gargalos de atrito e disciplina de dados. Sempre relativo a NOW().
 */
router.get('/manager/overview', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);

    const [healthResult, accountabilityResult, frictionResult, disciplineResult] = await Promise.all([
      // 1. Saúde do pipeline
      query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'open') AS total_open,
          COUNT(*) FILTER (WHERE status = 'open' AND updated_at < NOW() - INTERVAL '7 days') AS stopped_7d,
          COUNT(*) FILTER (WHERE status = 'open' AND updated_at < NOW() - INTERVAL '30 days') AS stopped_30d,
          COUNT(*) FILTER (WHERE status = 'open' AND updated_at < NOW() - INTERVAL '60 days') AS stopped_60d
         FROM deals WHERE organization_id = $1`,
        [orgId]
      ),

      // 2. Accountability: executivos com leads parados
      query(
        `SELECT
          u.name AS executive,
          COUNT(*) AS total_leads,
          COUNT(*) FILTER (WHERE d.updated_at < NOW() - INTERVAL '7 days') AS stale_7d,
          COUNT(*) FILTER (WHERE d.updated_at < NOW() - INTERVAL '30 days') AS stale_30d,
          MAX(d.updated_at) AS last_activity
         FROM deals d
         JOIN users u ON u.id = d.owner_id
         WHERE d.organization_id = $1 AND d.status = 'open'
         GROUP BY u.id, u.name
         ORDER BY stale_7d DESC, total_leads DESC`,
        [orgId]
      ),

      // 3. Gargalos: etapas com maior taxa de perda
      query(
        `SELECT
          ps.name AS stage,
          p.name AS pipeline,
          COUNT(*) FILTER (WHERE d.status = 'lost') AS lost,
          COUNT(*) AS total,
          ROUND(COUNT(*) FILTER (WHERE d.status = 'lost') * 100.0 / NULLIF(COUNT(*), 0)) AS loss_rate
         FROM deals d
         JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         JOIN pipelines p ON p.id = d.pipeline_id
         WHERE d.organization_id = $1
         GROUP BY ps.id, ps.name, p.name
         HAVING COUNT(*) >= 3 AND COUNT(*) FILTER (WHERE d.status = 'lost') > 0
         ORDER BY loss_rate DESC, lost DESC
         LIMIT 8`,
        [orgId]
      ),

      // 4. Disciplina de dados
      query(
        `SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'open') AS open_total,
          COUNT(*) FILTER (WHERE owner_id IS NULL) AS no_owner,
          COUNT(*) FILTER (WHERE owner_id IS NULL AND status = 'open') AS open_no_owner,
          COUNT(*) FILTER (WHERE value IS NULL OR value = 0) AS no_value,
          COUNT(*) FILTER (WHERE status = 'won' AND (value IS NULL OR value = 0)) AS won_no_value
         FROM deals WHERE organization_id = $1`,
        [orgId]
      ),
    ]);

    const h = healthResult.rows[0] || {};
    const d = disciplineResult.rows[0] || {};

    res.json({
      health: {
        total_open: parseInt(h.total_open || 0),
        stopped_7d: parseInt(h.stopped_7d || 0),
        stopped_30d: parseInt(h.stopped_30d || 0),
        stopped_60d: parseInt(h.stopped_60d || 0),
      },
      accountability: accountabilityResult.rows.map(r => ({
        executive: r.executive,
        total_leads: parseInt(r.total_leads),
        stale_7d: parseInt(r.stale_7d),
        stale_30d: parseInt(r.stale_30d),
        last_activity: r.last_activity,
      })),
      friction: frictionResult.rows.map(r => ({
        stage: r.stage,
        pipeline: r.pipeline,
        lost: parseInt(r.lost),
        total: parseInt(r.total),
        loss_rate: parseInt(r.loss_rate || 0),
      })),
      discipline: {
        total: parseInt(d.total || 0),
        open_total: parseInt(d.open_total || 0),
        no_owner: parseInt(d.no_owner || 0),
        open_no_owner: parseInt(d.open_no_owner || 0),
        no_value: parseInt(d.no_value || 0),
        won_no_value: parseInt(d.won_no_value || 0),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// RICA AI — KPIs & STATS
// ============================================

/**
 * GET /api/crm/rica/stats
 * Retorna KPIs de performance da Rica AI.
 * Usado no painel de acompanhamento (Dashboard CRM).
 */
router.get('/rica/stats', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);

    const [
      qualifiedResult,
      byExecResult,
      byProductResult,
      pendingResult,
      actionRateResult,
      recentLeadsResult,
    ] = await Promise.all([
      // 1. Leads qualificados (hoje / semana / mês)
      query(
        `SELECT
           COUNT(*) FILTER (WHERE assigned_at::date = CURRENT_DATE) AS today,
           COUNT(*) FILTER (WHERE assigned_at >= date_trunc('week', CURRENT_DATE)) AS week,
           COUNT(*) FILTER (WHERE assigned_at >= date_trunc('month', CURRENT_DATE)) AS month,
           COUNT(*) AS total
         FROM deals
         WHERE organization_id = $1 AND assigned_by = 'rica_ai'`,
        [orgId]
      ),

      // 2. Distribuição por executivo (mês atual)
      query(
        `SELECT u.id AS user_id, u.name, COUNT(d.id) AS count
         FROM deals d
         JOIN users u ON u.id = d.owner_id
         WHERE d.organization_id = $1
           AND d.assigned_by = 'rica_ai'
           AND d.assigned_at >= date_trunc('month', CURRENT_DATE)
         GROUP BY u.id, u.name
         ORDER BY count DESC`,
        [orgId]
      ),

      // 3. Leads por produto (via metadata de atividade escalation)
      query(
        `SELECT
           COALESCE(da.metadata->>'product', 'Não especificado') AS product,
           COUNT(DISTINCT da.deal_id) AS count
         FROM deal_activities da
         JOIN deals d ON d.id = da.deal_id
         WHERE d.organization_id = $1
           AND da.type = 'escalation'
           AND da.created_at >= date_trunc('month', CURRENT_DATE)
           AND da.metadata->>'product' IS NOT NULL
         GROUP BY da.metadata->>'product'
         ORDER BY count DESC
         LIMIT 10`,
        [orgId]
      ),

      // 4. Sem retorno — leads assignados pela Rica onde executivo não agiu
      query(
        `SELECT d.id, d.contact_name, d.contact_phone, d.title, d.assigned_at, d.assigned_via,
                u.name AS executive_name
         FROM deals d
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.organization_id = $1
           AND d.assigned_by = 'rica_ai'
           AND d.status = 'open'
           AND d.assigned_at >= NOW() - INTERVAL '30 days'
           AND NOT EXISTS (
             SELECT 1 FROM deal_activities da
             WHERE da.deal_id = d.id
               AND da.user_id IS NOT NULL
               AND da.type NOT IN ('escalation', 'exec_followup', 'automation')
               AND da.created_at > d.assigned_at
           )
         ORDER BY d.assigned_at ASC
         LIMIT 50`,
        [orgId]
      ),

      // 5. Taxa de ação — % de leads Rica onde exec interagiu
      query(
        `SELECT
           COUNT(*) AS total,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM deal_activities da
               WHERE da.deal_id = d.id
                 AND da.user_id IS NOT NULL
                 AND da.type NOT IN ('escalation', 'exec_followup', 'automation')
                 AND da.created_at > d.assigned_at
             )
           ) AS acted
         FROM deals d
         WHERE d.organization_id = $1
           AND d.assigned_by = 'rica_ai'
           AND d.assigned_at >= date_trunc('month', CURRENT_DATE)`,
        [orgId]
      ),

      // 6. Leads recentes (drill-down, mês atual)
      query(
        `SELECT d.id, d.contact_name, d.contact_phone, d.title, d.status,
                d.assigned_at, d.assigned_via,
                u.name AS executive_name,
                (SELECT da.metadata->>'product'
                 FROM deal_activities da
                 WHERE da.deal_id = d.id AND da.type = 'escalation'
                 ORDER BY da.created_at DESC LIMIT 1) AS product
         FROM deals d
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.organization_id = $1
           AND d.assigned_by = 'rica_ai'
           AND d.assigned_at >= date_trunc('month', CURRENT_DATE)
         ORDER BY d.assigned_at DESC
         LIMIT 100`,
        [orgId]
      ),
    ]);

    const total = parseInt(actionRateResult.rows[0]?.total) || 0;
    const acted = parseInt(actionRateResult.rows[0]?.acted) || 0;

    res.json({
      qualified_leads: {
        today: parseInt(qualifiedResult.rows[0]?.today) || 0,
        week: parseInt(qualifiedResult.rows[0]?.week) || 0,
        month: parseInt(qualifiedResult.rows[0]?.month) || 0,
        total: parseInt(qualifiedResult.rows[0]?.total) || 0,
      },
      by_executive: byExecResult.rows.map(r => ({
        user_id: r.user_id,
        name: r.name,
        count: parseInt(r.count) || 0,
      })),
      by_product: byProductResult.rows.map(r => ({
        product: r.product,
        count: parseInt(r.count) || 0,
      })),
      pending_followups: {
        count: pendingResult.rows.length,
        deals: pendingResult.rows.map(r => ({
          id: r.id,
          contact_name: r.contact_name,
          contact_phone: r.contact_phone,
          title: r.title,
          executive_name: r.executive_name,
          assigned_at: r.assigned_at,
          assigned_via: r.assigned_via,
        })),
      },
      action_rate: {
        total_assigned: total,
        exec_acted: acted,
        rate: total > 0 ? Math.round((acted / total) * 1000) / 10 : 0,
      },
      recent_leads: recentLeadsResult.rows.map(r => ({
        id: r.id,
        contact_name: r.contact_name,
        contact_phone: r.contact_phone,
        title: r.title,
        status: r.status,
        executive_name: r.executive_name,
        product: r.product,
        assigned_at: r.assigned_at,
        assigned_via: r.assigned_via,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEAL AUDIT LOG (Historico de alteracoes)
// ============================================

/**
 * GET /api/crm/deals/:id/audit
 * Retorna o historico de alteracoes do deal.
 */
router.get('/deals/:id/audit', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { limit = 100 } = req.query;

    const result = await query(
      `SELECT dal.*, u.name as actor_name
       FROM deal_audit_log dal
       LEFT JOIN users u ON u.id = dal.user_id
       WHERE dal.deal_id = $1
       ORDER BY dal.created_at DESC
       LIMIT $2`,
      [id, Math.min(parseInt(limit) || 100, 500)]
    );

    res.json({ audit: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEAL TASKS (Tarefas vinculadas ao deal)
// ============================================

/**
 * GET /api/crm/deals/:id/tasks
 * Lista tarefas vinculadas a um deal.
 */
router.get('/deals/:id/tasks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.query;

    let sql = `
      SELECT t.*, u.name as assignee_name
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.deal_id = $1`;
    const params = [id];

    if (status) {
      sql += ' AND t.status = $2';
      params.push(status);
    }
    sql += ' ORDER BY t.created_at DESC';

    const result = await query(sql, params);
    res.json({ tasks: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/:id/tasks
 * Cria uma tarefa vinculada a um deal.
 */
router.post('/deals/:id/tasks', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description, assignee_id, due_date, priority, organization_id } = req.body;

    if (!title) return res.status(400).json({ error: { message: 'Título é obrigatório' } });

    // Resolve org_id from deal if not provided
    let orgId = organization_id;
    if (!orgId) {
      const { rows } = await query('SELECT organization_id FROM deals WHERE id = $1', [id]);
      if (!rows.length) return res.status(404).json({ error: { message: 'Deal não encontrado' } });
      orgId = rows[0].organization_id;
    }

    const { rows } = await query(
      `INSERT INTO tasks (organization_id, deal_id, title, description, assignee_id, due_date, priority, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'crm')
       RETURNING *`,
      [orgId, id, title, description || null, assignee_id || null, due_date || null, priority || 'normal']
    );

    const task = rows[0];

    // Fire journey event (fire-and-forget)
    import('../services/leadJourney.js').then(({ recordEvent }) => {
      const dealRow = query('SELECT organization_id FROM deals WHERE id = $1', [id])
        .then(r => r.rows[0])
        .catch(() => null);
      dealRow.then(d => {
        if (!d) return;
        recordEvent({
          dealId: id,
          organizationId: d.organization_id,
          eventType: 'task_created',
          actorUserId: req.user?.id,
          actorType: 'user',
          metadata: { task_id: task.id, title, due_date }
        }).catch(() => {});
      });
    }).catch(() => {});

    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEAL FILES (Upload de arquivos)
// ============================================

/**
 * POST /api/crm/deals/:id/files
 * Upload de arquivo para um deal. Espera multipart/form-data.
 * Campos: file (binary), category, description
 */
router.post('/deals/:id/files', upload.single('file'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate deal exists and get org
    const { rows: dealRows } = await query('SELECT organization_id FROM deals WHERE id = $1', [id]);
    if (!dealRows.length) return res.status(404).json({ error: { message: 'Deal não encontrado' } });
    const orgId = dealRows[0].organization_id;

    // multer puts file in req.file
    if (!req.file) return res.status(400).json({ error: { message: 'Arquivo não enviado' } });

    const { originalname, mimetype, size, buffer } = req.file;
    const category = req.body.category || 'other';
    const description = req.body.description || null;

    const { uploadFile } = await import('../services/storage.js');
    const { storagePath } = await uploadFile({
      orgId,
      dealId: id,
      originalName: originalname,
      buffer,
      mimeType: mimetype
    });

    const { rows } = await query(
      `INSERT INTO deal_files (deal_id, organization_id, uploaded_by, file_name, file_size, mime_type, storage_path, category, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, orgId, req.user?.id || null, originalname, size, mimetype, storagePath, category, description]
    );

    res.status(201).json({ file: rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/deals/:id/files
 * Lista arquivos de um deal.
 */
router.get('/deals/:id/files', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT df.*, u.name as uploaded_by_name
       FROM deal_files df
       LEFT JOIN users u ON u.id = df.uploaded_by
       WHERE df.deal_id = $1
       ORDER BY df.created_at DESC`,
      [id]
    );
    res.json({ files: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/crm/deals/:id/files/:fileId/download
 * Retorna URL assinada para download do arquivo.
 */
router.get('/deals/:id/files/:fileId/download', async (req, res, next) => {
  try {
    const { id, fileId } = req.params;
    const { rows } = await query(
      'SELECT * FROM deal_files WHERE id = $1 AND deal_id = $2',
      [fileId, id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Arquivo não encontrado' } });

    const { getSignedUrl } = await import('../services/storage.js');
    const url = await getSignedUrl(rows[0].storage_path, 3600);
    res.json({ url, expires_in: 3600 });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/crm/deals/:id/files/:fileId
 * Remove arquivo do deal e do Storage.
 */
router.delete('/deals/:id/files/:fileId', async (req, res, next) => {
  try {
    const { id, fileId } = req.params;
    const { rows } = await query(
      'SELECT * FROM deal_files WHERE id = $1 AND deal_id = $2',
      [fileId, id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Arquivo não encontrado' } });

    const { removeFile } = await import('../services/storage.js');
    await removeFile(rows[0].storage_path).catch(() => {}); // soft-fail if already gone

    await query('DELETE FROM deal_files WHERE id = $1', [fileId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// PROPOSAL TEMPLATES
// ============================================

/**
 * GET /api/crm/proposal-templates
 */
router.get('/proposal-templates', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    const result = await query(
      `SELECT pt.*, u.name as created_by_name
       FROM proposal_templates pt
       LEFT JOIN users u ON u.id = pt.created_by
       WHERE pt.organization_id = $1
       ORDER BY pt.created_at DESC`,
      [orgId]
    );
    res.json({ templates: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/proposal-templates
 */
router.post('/proposal-templates', async (req, res, next) => {
  try {
    const { organization_id, name, description, body_markdown, variables } = req.body;
    if (!name || !body_markdown) {
      return res.status(400).json({ error: { message: 'name e body_markdown são obrigatórios' } });
    }
    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    const { rows } = await query(
      `INSERT INTO proposal_templates (organization_id, created_by, name, description, body_markdown, variables)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orgId, req.user?.id || null, name, description || null, body_markdown, JSON.stringify(variables || [])]
    );
    res.status(201).json({ template: rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/crm/proposal-templates/:id
 */
router.put('/proposal-templates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, body_markdown, variables, is_active } = req.body;

    const sets = [];
    const params = [];
    let pi = 1;

    if (name !== undefined)          { sets.push(`name = $${pi++}`);           params.push(name); }
    if (description !== undefined)   { sets.push(`description = $${pi++}`);    params.push(description); }
    if (body_markdown !== undefined) { sets.push(`body_markdown = $${pi++}`);  params.push(body_markdown); }
    if (variables !== undefined)     { sets.push(`variables = $${pi++}`);      params.push(JSON.stringify(variables)); }
    if (is_active !== undefined)     { sets.push(`is_active = $${pi++}`);      params.push(is_active); }

    if (!sets.length) return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    sets.push(`updated_at = NOW()`);
    params.push(id);

    const { rows } = await query(
      `UPDATE proposal_templates SET ${sets.join(', ')} WHERE id = $${pi} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Template não encontrado' } });
    res.json({ template: rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/crm/proposal-templates/:id
 */
router.delete('/proposal-templates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await query('DELETE FROM proposal_templates WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEAL PROPOSALS
// ============================================

/**
 * GET /api/crm/deals/:id/proposals
 */
router.get('/deals/:id/proposals', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT dp.*, pt.name as template_name, u.name as created_by_name,
              df.file_name, df.storage_path
       FROM deal_proposals dp
       LEFT JOIN proposal_templates pt ON pt.id = dp.template_id
       LEFT JOIN users u ON u.id = dp.created_by
       LEFT JOIN deal_files df ON df.id = dp.file_id
       WHERE dp.deal_id = $1
       ORDER BY dp.created_at DESC`,
      [id]
    );
    res.json({ proposals: result.rows, count: result.rows.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/crm/deals/:id/proposals
 * Gera PDF a partir de um template e salva.
 * Body: { template_id, title, variable_values }
 */
router.post('/deals/:id/proposals', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { template_id, title, variable_values } = req.body;

    if (!template_id) return res.status(400).json({ error: { message: 'template_id é obrigatório' } });

    // Load deal + template
    const [dealRes, tmplRes] = await Promise.all([
      query('SELECT organization_id, contact_name FROM deals WHERE id = $1', [id]),
      query('SELECT * FROM proposal_templates WHERE id = $1', [template_id])
    ]);
    if (!dealRes.rows.length)  return res.status(404).json({ error: { message: 'Deal não encontrado' } });
    if (!tmplRes.rows.length)  return res.status(404).json({ error: { message: 'Template não encontrado' } });

    const deal = dealRes.rows[0];
    const tmpl = tmplRes.rows[0];
    const proposalTitle = title || `Proposta - ${deal.contact_name || 'Cliente'}`;

    // Insert proposal as "generating"
    const { rows: insRows } = await query(
      `INSERT INTO deal_proposals (deal_id, organization_id, template_id, created_by, title, variable_values, rendered_markdown, status)
       VALUES ($1, $2, $3, $4, $5, $6, '', 'generating')
       RETURNING *`,
      [id, deal.organization_id, template_id, req.user?.id || null, proposalTitle, JSON.stringify(variable_values || {})]
    );
    const proposal = insRows[0];

    // Generate async (don't block response)
    (async () => {
      try {
        const { renderAndUpload } = await import('../services/proposals.js');
        const { storagePath, renderedMarkdown, fileName } = await renderAndUpload({
          orgId: deal.organization_id,
          dealId: id,
          templateMarkdown: tmpl.body_markdown,
          variables: variable_values || {},
          title: proposalTitle
        });

        // Save file record
        const { rows: fileRows } = await query(
          `INSERT INTO deal_files (deal_id, organization_id, uploaded_by, file_name, mime_type, storage_path, category)
           VALUES ($1, $2, $3, $4, 'application/pdf', $5, 'proposal')
           RETURNING id`,
          [id, deal.organization_id, req.user?.id || null, fileName, storagePath]
        );
        const fileId = fileRows[0].id;

        await query(
          `UPDATE deal_proposals SET status = 'ready', rendered_markdown = $1, file_id = $2, updated_at = NOW()
           WHERE id = $3`,
          [renderedMarkdown, fileId, proposal.id]
        );
      } catch (err) {
        console.error('[proposals] generation failed:', err);
        await query(`UPDATE deal_proposals SET status = 'draft', updated_at = NOW() WHERE id = $1`, [proposal.id]);
      }
    })();

    res.status(202).json({ proposal, message: 'Proposta sendo gerada…' });
  } catch (error) {
    next(error);
  }
});

export default router;

