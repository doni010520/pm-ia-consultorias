import { Router } from 'express';
import { query } from '../services/database.js';

const router = Router();

// Helper: get org id from either JWT auth or N8N fallback
function getOrgId(req) {
  return req.user?.organization_id || req.organizationId;
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
// PIPELINE STAGES
// ============================================

// List stages ordered by position
router.get('/pipeline', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const result = await query(
      'SELECT * FROM pipeline_stages WHERE organization_id = $1 ORDER BY position',
      [orgId]
    );
    res.json({ stages: result.rows });
  } catch (error) {
    next(error);
  }
});

// Create new stage
router.post('/pipeline', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { name, color, position, max_days, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: { message: 'name e obrigatorio' } });
    }

    const result = await query(
      `INSERT INTO pipeline_stages (organization_id, name, color, position, max_days, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [orgId, name, color || '#6B7280', position || 0, max_days || null, description || null]
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

    const allowed = ['name', 'color', 'position', 'max_days', 'description', 'is_won', 'is_lost'];

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
// DEALS
// ============================================

// List deals with filters
router.get('/deals', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const {
      status, pipeline_stage_id, owner_id, phone, search,
      temperature, source, sort_by, sort_dir,
      min_value, max_value,
    } = req.query;

    let sql = `
      SELECT d.*,
             ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
             ps.max_days as stage_max_days,
             u.name as owner_name,
             (SELECT COUNT(*) FROM deal_insights di WHERE di.deal_id = d.id) as insights_count,
             EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400 as days_in_stage
      FROM deals d
      LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
      LEFT JOIN users u ON u.id = d.owner_id
      WHERE d.organization_id = $1`;
    const params = [orgId];
    let idx = 2;

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

// Find deal by phone (for N8N)
router.get('/deals/by-phone/:phone', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { phone } = req.params;

    const result = await query(
      `SELECT d.*, ps.name as stage_name, ps.color as stage_color
       FROM deals d
       LEFT JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
       WHERE d.organization_id = $1 AND d.contact_phone = $2
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
      tags, custom_fields,
    } = req.body;

    // Get first pipeline stage
    const stageResult = await query(
      `SELECT id FROM pipeline_stages
       WHERE organization_id = $1 AND is_won = false AND is_lost = false
       ORDER BY position LIMIT 1`,
      [orgId]
    );

    const stageId = stageResult.rows[0]?.id || null;

    const result = await query(
      `INSERT INTO deals (organization_id, pipeline_stage_id, title, contact_name, contact_email,
        contact_phone, company_name, owner_id, value, source, temperature, tags, custom_fields, stage_entered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       RETURNING *`,
      [
        orgId, stageId, title || `Lead - ${contact_name || contact_phone}`,
        contact_name, contact_email, contact_phone, company_name,
        owner_id, value, source, temperature, tags || [], custom_fields || {},
      ]
    );

    // Log creation activity
    await query(
      `INSERT INTO deal_activities (deal_id, type, description)
       VALUES ($1, 'note', $2)`,
      [result.rows[0].id, `Lead criado via ${source}`]
    );

    res.status(201).json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Update deal
router.patch('/deals/:id', async (req, res, next) => {
  try {
    const orgId = getOrgId(req);
    const { id } = req.params;

    // Get current deal state for stage change detection
    const currentDeal = await query('SELECT pipeline_stage_id, status FROM deals WHERE id = $1', [id]);
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
      'pipeline_stage_id',
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

    // If stage changed, create activity
    if (req.body.pipeline_stage_id && req.body.pipeline_stage_id !== oldDeal.pipeline_stage_id) {
      const stageResult = await query('SELECT name FROM pipeline_stages WHERE id = $1', [req.body.pipeline_stage_id]);
      const stageName = stageResult.rows[0]?.name || 'Desconhecida';
      await query(
        `INSERT INTO deal_activities (deal_id, type, description)
         VALUES ($1, 'stage_change', $2)`,
        [id, `Movido para etapa: ${stageName}`]
      );
    }

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
    const { pipeline_stage_id } = req.body;

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
    let statusUpdate = '';
    if (stage.is_won) {
      statusUpdate = `, status = 'won', won_date = NOW()`;
    } else if (stage.is_lost) {
      statusUpdate = `, status = 'lost', lost_date = NOW()`;
    } else {
      statusUpdate = `, status = 'open'`;
    }

    const result = await query(
      `UPDATE deals SET pipeline_stage_id = $1, stage_entered_at = NOW()${statusUpdate}, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [pipeline_stage_id, id]
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

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
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

// Create activity
router.post('/deals/:id/activities', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, description, user_id, metadata, scheduled_at, completed_at } = req.body;

    if (!type) {
      return res.status(400).json({ error: { message: 'type obrigatorio' } });
    }

    const result = await query(
      `INSERT INTO deal_activities (deal_id, user_id, type, description, metadata, scheduled_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, user_id || req.user?.id, type, description, metadata || {}, scheduled_at, completed_at]
    );

    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [id]);

    res.status(201).json({ activity: result.rows[0] });
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
         FROM deals WHERE organization_id = $1`,
        [orgId]
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
         LEFT JOIN deals d ON d.pipeline_stage_id = ps.id AND d.status = 'open'
         WHERE ps.organization_id = $1
         GROUP BY ps.id, ps.name, ps.color, ps.position, ps.max_days
         ORDER BY ps.position`,
        [orgId]
      ),
      query(
        `SELECT da.*, d.title as deal_title, u.name as user_name
         FROM deal_activities da
         JOIN deals d ON d.id = da.deal_id
         LEFT JOIN users u ON u.id = da.user_id
         WHERE d.organization_id = $1
         ORDER BY da.created_at DESC LIMIT 15`,
        [orgId]
      ),
      query(
        `SELECT COUNT(*) as count
         FROM deals d
         JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
         WHERE d.organization_id = $1
           AND d.status = 'open'
           AND ps.max_days IS NOT NULL
           AND EXTRACT(EPOCH FROM (NOW() - d.stage_entered_at)) / 86400 > ps.max_days`,
        [orgId]
      ),
      query(
        `SELECT COALESCE(
           AVG(EXTRACT(EPOCH FROM (won_date - created_at)) / 86400),
           0
         ) as avg_days_to_close
         FROM deals
         WHERE organization_id = $1 AND status = 'won' AND won_date IS NOT NULL`,
        [orgId]
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

export default router;
