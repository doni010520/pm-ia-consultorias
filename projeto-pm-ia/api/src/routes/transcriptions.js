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

export default router;
