import { Router } from 'express';
import { query } from '../services/database.js';

const router = Router();

// ============================================
// PIPELINE STAGES
// ============================================

// Listar etapas do funil
router.get('/pipeline', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId;
    const result = await query(
      'SELECT * FROM pipeline_stages WHERE organization_id = $1 ORDER BY position',
      [orgId]
    );
    res.json({ stages: result.rows });
  } catch (error) {
    next(error);
  }
});

// ============================================
// DEALS
// ============================================

// Listar deals (com filtros)
router.get('/deals', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId;
    const { status, pipeline_stage_id, owner_id, phone, search } = req.query;

    let sql = `
      SELECT d.*, ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
             u.name as owner_name
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

    sql += ' ORDER BY d.updated_at DESC';

    const result = await query(sql, params);

    // Buscar insights e atividades recentes para cada deal
    const dealIds = result.rows.map((d) => d.id);
    let insights = [];
    let activities = [];

    if (dealIds.length > 0) {
      const placeholders = dealIds.map((_, i) => `$${i + 1}`).join(',');
      const [insightsResult, activitiesResult] = await Promise.all([
        query(
          `SELECT * FROM deal_insights WHERE deal_id IN (${placeholders}) ORDER BY created_at DESC`,
          dealIds
        ),
        query(
          `SELECT da.*, u.name as user_name FROM deal_activities da
           LEFT JOIN users u ON u.id = da.user_id
           WHERE da.deal_id IN (${placeholders}) ORDER BY da.created_at DESC LIMIT 50`,
          dealIds
        ),
      ]);
      insights = insightsResult.rows;
      activities = activitiesResult.rows;
    }

    // Agrupar por deal
    const deals = result.rows.map((deal) => ({
      ...deal,
      insights: insights.filter((i) => i.deal_id === deal.id),
      recent_activities: activities.filter((a) => a.deal_id === deal.id).slice(0, 3),
    }));

    res.json({ deals, count: deals.length });
  } catch (error) {
    next(error);
  }
});

// Buscar deal por telefone (para N8N - verifica se lead ja existe)
router.get('/deals/by-phone/:phone', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId;
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

    // Buscar insights do deal
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

// Obter deal por ID
router.get('/deals/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [dealResult, insightsResult, activitiesResult, productsResult] = await Promise.all([
      query(
        `SELECT d.*, ps.name as stage_name, ps.color as stage_color, ps.position as stage_position,
                u.name as owner_name
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
    ]);

    if (dealResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    res.json({
      deal: dealResult.rows[0],
      insights: insightsResult.rows,
      activities: activitiesResult.rows,
      products: productsResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

// Criar deal (usado pelo N8N quando novo lead chega)
router.post('/deals', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId;
    const {
      title,
      contact_name,
      contact_email,
      contact_phone,
      company_name,
      owner_id,
      value,
      source = 'whatsapp',
      temperature = 'warm',
      tags,
      custom_fields,
    } = req.body;

    // Buscar primeira etapa do funil (Novo Lead)
    const stageResult = await query(
      'SELECT id FROM pipeline_stages WHERE organization_id = $1 AND is_won = false AND is_lost = false ORDER BY position LIMIT 1',
      [orgId]
    );

    const stageId = stageResult.rows[0]?.id || null;

    const result = await query(
      `INSERT INTO deals (organization_id, pipeline_stage_id, title, contact_name, contact_email,
        contact_phone, company_name, owner_id, value, source, temperature, tags, custom_fields)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [orgId, stageId, title || `Lead - ${contact_name || contact_phone}`,
       contact_name, contact_email, contact_phone, company_name,
       owner_id, value, source, temperature, tags || [], custom_fields || {}]
    );

    // Registrar atividade de criacao
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

// Atualizar deal
router.patch('/deals/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'title', 'contact_name', 'contact_email', 'contact_phone', 'company_name',
      'owner_id', 'value', 'probability', 'expected_close_date', 'status',
      'source', 'temperature', 'tags', 'custom_fields', 'lost_reason',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    // Status especiais
    if (req.body.status === 'won' && !req.body.won_date) {
      fields.push(`won_date = NOW()`);
    }
    if (req.body.status === 'lost' && !req.body.lost_date) {
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

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Mover deal para outra etapa do funil
router.patch('/deals/:id/stage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pipeline_stage_id } = req.body;

    if (!pipeline_stage_id) {
      return res.status(400).json({ error: { message: 'pipeline_stage_id obrigatorio' } });
    }

    // Buscar nome da etapa
    const stageResult = await query('SELECT name, is_won, is_lost FROM pipeline_stages WHERE id = $1', [pipeline_stage_id]);
    const stage = stageResult.rows[0];

    if (!stage) {
      return res.status(404).json({ error: { message: 'Etapa nao encontrada' } });
    }

    // Atualizar deal
    const updates = { pipeline_stage_id };
    let statusUpdate = '';
    if (stage.is_won) {
      statusUpdate = `, status = 'won', won_date = NOW()`;
    } else if (stage.is_lost) {
      statusUpdate = `, status = 'lost', lost_date = NOW()`;
    } else {
      statusUpdate = `, status = 'open'`;
    }

    const result = await query(
      `UPDATE deals SET pipeline_stage_id = $1${statusUpdate}, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [pipeline_stage_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Deal nao encontrado' } });
    }

    // Registrar atividade
    await query(
      `INSERT INTO deal_activities (deal_id, type, description)
       VALUES ($1, 'stage_change', $2)`,
      [id, `Movido para etapa: ${stage.name}`]
    );

    res.json({ deal: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Deletar deal
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
// INSIGHTS (anotacoes da IA / N8N)
// ============================================

// Adicionar insight ao deal
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

    // Atualizar updated_at do deal
    await query('UPDATE deals SET updated_at = NOW() WHERE id = $1', [id]);

    res.status(201).json({ insight: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

// Adicionar multiplos insights de uma vez (batch do N8N)
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

// Listar atividades do deal
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

// Registrar atividade
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
// STATS / DASHBOARD
// ============================================

router.get('/stats', async (req, res, next) => {
  try {
    const orgId = req.user?.organization_id || req.organizationId;

    const [dealsResult, stagesResult, recentResult] = await Promise.all([
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
        `SELECT ps.id, ps.name, ps.color, ps.position, COUNT(d.id) as deal_count,
                COALESCE(SUM(d.value), 0) as total_value
         FROM pipeline_stages ps
         LEFT JOIN deals d ON d.pipeline_stage_id = ps.id AND d.status = 'open'
         WHERE ps.organization_id = $1
         GROUP BY ps.id, ps.name, ps.color, ps.position
         ORDER BY ps.position`,
        [orgId]
      ),
      query(
        `SELECT da.*, d.title as deal_title, u.name as user_name
         FROM deal_activities da
         JOIN deals d ON d.id = da.deal_id
         LEFT JOIN users u ON u.id = da.user_id
         WHERE d.organization_id = $1
         ORDER BY da.created_at DESC LIMIT 10`,
        [orgId]
      ),
    ]);

    res.json({
      stats: dealsResult.rows[0],
      stages_summary: stagesResult.rows,
      recent_activities: recentResult.rows,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
