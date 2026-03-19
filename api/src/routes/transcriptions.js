import { Router } from 'express';
import {
  parseFilename,
  generateChave,
  saveTranscription,
  getTranscriptionByChave,
  listTranscriptions,
  confirmAndProcess,
  listAtas,
  getAtaById
} from '../services/transcription.js';

const router = Router();

// ===========================================
// TRANSCRICOES
// ===========================================

/**
 * POST /api/transcriptions/upload
 * Upload de transcricao via JSON
 * Body: { fileName, content, organization_id, auto_confirm? }
 */
router.post('/upload', async (req, res, next) => {
  try {
    const { fileName, content, organization_id, auto_confirm } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Campo "content" e obrigatorio' });
    }

    const orgId = organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    const name = fileName || `upload_${Date.now()}.txt`;

    // Parsear nome do arquivo
    const parsed = parseFilename(name);
    const chave = generateChave(parsed);

    // Salvar transcricao
    const transcription = await saveTranscription({
      organizationId: orgId,
      chave,
      parsed,
      fileName: name,
      textContent: content,
      source: 'api'
    });

    // Se auto_confirm, processar imediatamente
    if (auto_confirm) {
      try {
        const result = await confirmAndProcess(chave, orgId);
        return res.status(201).json({
          transcription,
          processed: true,
          result
        });
      } catch (err) {
        return res.status(500).json({
          transcription,
          processed: false,
          error: err.message
        });
      }
    }

    res.status(201).json({
      transcription,
      message: 'Transcricao salva. Use POST /api/transcriptions/:chave/confirm para processar.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/transcriptions
 * Lista transcricoes
 * Query: organization_id, status, limit
 */
router.get('/', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    const transcriptions = await listTranscriptions(orgId, {
      status: req.query.status,
      limit: parseInt(req.query.limit) || 50
    });

    res.json({ transcriptions, total: transcriptions.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/transcriptions/:chave
 * Detalhe de uma transcricao
 */
router.get('/:chave', async (req, res, next) => {
  try {
    const transcription = await getTranscriptionByChave(req.params.chave);

    if (!transcription) {
      return res.status(404).json({ error: 'Transcricao nao encontrada' });
    }

    res.json(transcription);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/transcriptions/:chave/confirm
 * Confirma e processa uma transcricao
 */
router.post('/:chave/confirm', async (req, res, next) => {
  try {
    const orgId = req.body.organization_id || process.env.DEFAULT_ORGANIZATION_ID;

    const result = await confirmAndProcess(req.params.chave, orgId);

    res.json(result);
  } catch (error) {
    if (error.message.includes('nao encontrada') || error.message.includes('invalido')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// ===========================================
// ATAS
// ===========================================

/**
 * GET /api/transcriptions/atas/list
 * Lista atas de reuniao
 * Query: organization_id, project_id, limit
 */
router.get('/atas/list', async (req, res, next) => {
  try {
    const orgId = req.query.organization_id || process.env.DEFAULT_ORGANIZATION_ID;
    if (!orgId) {
      return res.status(400).json({ error: 'organization_id e obrigatorio' });
    }

    const atas = await listAtas(orgId, {
      project_id: req.query.project_id,
      limit: parseInt(req.query.limit) || 50
    });

    res.json({ atas, total: atas.length });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/transcriptions/atas/:id
 * Detalhe da ata com acoes, decisoes e riscos
 */
router.get('/atas/:id', async (req, res, next) => {
  try {
    const ata = await getAtaById(req.params.id);

    if (!ata) {
      return res.status(404).json({ error: 'Ata nao encontrada' });
    }

    res.json(ata);
  } catch (error) {
    next(error);
  }
});

// ============================================
// EDIÇÃO DE ATAS E SUBITENS
// ============================================

/**
 * PATCH /api/transcriptions/atas/:id — Editar ata
 */
router.patch('/atas/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { titulo, data_reuniao, participantes, resumo_executivo, conteudo_markdown } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (titulo !== undefined) { fields.push(`titulo = $${idx++}`); values.push(titulo); }
    if (data_reuniao !== undefined) { fields.push(`data_reuniao = $${idx++}`); values.push(data_reuniao); }
    if (participantes !== undefined) { fields.push(`participantes = $${idx++}`); values.push(participantes); }
    if (resumo_executivo !== undefined) { fields.push(`resumo_executivo = $${idx++}`); values.push(resumo_executivo); }
    if (conteudo_markdown !== undefined) { fields.push(`conteudo_markdown = $${idx++}`); values.push(conteudo_markdown); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const result = await query(
      `UPDATE atas SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Ata nao encontrada' } });
    }

    res.json({ ata: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/transcriptions/atas/:id/acoes/:acaoId — Editar acao
 */
router.patch('/atas/:id/acoes/:acaoId', async (req, res, next) => {
  try {
    const { acaoId } = req.params;
    const { descricao, responsavel_nome, responsavel_id, prazo, tipo, evidencia_minima, status } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(descricao); }
    if (responsavel_nome !== undefined) { fields.push(`responsavel_nome = $${idx++}`); values.push(responsavel_nome); }
    if (responsavel_id !== undefined) { fields.push(`responsavel_id = $${idx++}`); values.push(responsavel_id); }
    if (prazo !== undefined) { fields.push(`prazo = $${idx++}`); values.push(prazo); }
    if (tipo !== undefined) { fields.push(`tipo = $${idx++}`); values.push(tipo); }
    if (evidencia_minima !== undefined) { fields.push(`evidencia_minima = $${idx++}`); values.push(evidencia_minima); }
    if (status !== undefined) { fields.push(`status = $${idx++}`); values.push(status); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    values.push(acaoId);

    const result = await query(
      `UPDATE ata_acoes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Acao nao encontrada' } });
    }

    res.json({ acao: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/transcriptions/atas/:id/decisoes/:decisaoId — Editar decisao
 */
router.patch('/atas/:id/decisoes/:decisaoId', async (req, res, next) => {
  try {
    const { decisaoId } = req.params;
    const { descricao, justificativa, impacto } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(descricao); }
    if (justificativa !== undefined) { fields.push(`justificativa = $${idx++}`); values.push(justificativa); }
    if (impacto !== undefined) { fields.push(`impacto = $${idx++}`); values.push(impacto); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    values.push(decisaoId);

    const result = await query(
      `UPDATE ata_decisoes SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Decisao nao encontrada' } });
    }

    res.json({ decisao: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/transcriptions/atas/:id/riscos/:riscoId — Editar risco
 */
router.patch('/atas/:id/riscos/:riscoId', async (req, res, next) => {
  try {
    const { riscoId } = req.params;
    const { descricao, probabilidade, impacto, mitigacao } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (descricao !== undefined) { fields.push(`descricao = $${idx++}`); values.push(descricao); }
    if (probabilidade !== undefined) { fields.push(`probabilidade = $${idx++}`); values.push(probabilidade); }
    if (impacto !== undefined) { fields.push(`impacto = $${idx++}`); values.push(impacto); }
    if (mitigacao !== undefined) { fields.push(`mitigacao = $${idx++}`); values.push(mitigacao); }

    if (fields.length === 0) {
      return res.status(400).json({ error: { message: 'Nenhum campo para atualizar' } });
    }

    values.push(riscoId);

    const result = await query(
      `UPDATE ata_riscos SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Risco nao encontrado' } });
    }

    res.json({ risco: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

export default router;
