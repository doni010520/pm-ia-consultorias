import { query, getClient, findUserByName, logAIInteraction } from './database.js';
import { processTranscription } from './ai.js';

// ===========================================
// PARSE DE ARQUIVO
// ===========================================

/**
 * Extrai metadados do nome do arquivo no padrao [Cliente][Projeto][Consultor][Data].txt
 */
export function parseFilename(filename) {
  if (!filename) return null;

  const regex = /^\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\]/;
  const match = filename.match(regex);

  if (!match) {
    console.log(`Nome de arquivo fora do padrao: ${filename}`);
    return null;
  }

  const cliente = match[1].trim();
  const projeto = match[2].trim();
  const consultor = match[3].trim();
  let dataRaw = match[4].replace('.txt', '').trim();

  // Parsear data em varios formatos
  let dataReuniao;
  if (dataRaw.includes('/')) {
    const partes = dataRaw.split('/');
    dataReuniao = `${partes[2]}-${partes[1]}-${partes[0]}`;
  } else if (/^\d{8}$/.test(dataRaw)) {
    const dia = dataRaw.substring(0, 2);
    const mes = dataRaw.substring(2, 4);
    const ano = dataRaw.substring(4, 8);
    dataReuniao = `${ano}-${mes}-${dia}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dataRaw)) {
    dataReuniao = dataRaw;
  } else {
    console.log(`Formato de data nao reconhecido: ${dataRaw}`);
    dataReuniao = new Date().toISOString().split('T')[0];
  }

  return { cliente, projeto, consultor, dataReuniao };
}

/**
 * Gera chave unica a partir dos metadados
 */
export function generateChave(parsed) {
  if (!parsed) {
    return `upload_${Date.now()}`;
  }

  const chave = `${parsed.cliente}_${parsed.projeto}_${parsed.consultor}_${parsed.dataReuniao}`
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');

  return chave;
}

// ===========================================
// OPERACOES DE BANCO
// ===========================================

/**
 * Salva transcricao pendente no banco
 */
export async function saveTranscription({ organizationId, chave, parsed, fileName, textContent, source, sourcePhone }) {
  const result = await query(
    `INSERT INTO transcricoes_pendentes (
      organization_id, chave, cliente_nome, projeto_nome, consultor_nome,
      data_reuniao, nome_arquivo, conteudo_texto, source, source_phone
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (chave) DO UPDATE SET
      conteudo_texto = EXCLUDED.conteudo_texto,
      status = 'aguardando_confirmacao',
      updated_at = NOW()
    RETURNING *`,
    [
      organizationId,
      chave,
      parsed?.cliente || null,
      parsed?.projeto || null,
      parsed?.consultor || null,
      parsed?.dataReuniao || null,
      fileName,
      textContent,
      source || 'api',
      sourcePhone || null
    ]
  );
  return result.rows[0];
}

/**
 * Busca transcricao por chave
 */
export async function getTranscriptionByChave(chave) {
  const result = await query(
    'SELECT * FROM transcricoes_pendentes WHERE chave = $1 LIMIT 1',
    [chave]
  );
  return result.rows[0] || null;
}

/**
 * Lista transcricoes com filtros
 */
export async function listTranscriptions(organizationId, filters = {}) {
  const { status, limit = 50 } = filters;

  let sql = 'SELECT * FROM transcricoes_pendentes WHERE organization_id = $1';
  const params = [organizationId];
  let paramIndex = 2;

  if (status) {
    sql += ` AND status = $${paramIndex++}`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

// ===========================================
// PROCESSAMENTO PRINCIPAL
// ===========================================

/**
 * Confirma e processa uma transcricao:
 * 1. Busca transcricao pendente
 * 2. Chama IA para processar
 * 3. Cria projeto (ou encontra existente)
 * 4. Cria ata com acoes, decisoes, riscos
 * 5. Atualiza status
 */
export async function confirmAndProcess(chave, organizationId) {
  const transcription = await getTranscriptionByChave(chave);

  if (!transcription) {
    throw new Error(`Transcricao nao encontrada: ${chave}`);
  }

  if (!['aguardando_confirmacao', 'confirmado'].includes(transcription.status)) {
    throw new Error(`Transcricao com status invalido para processamento: ${transcription.status}`);
  }

  const orgId = organizationId || transcription.organization_id;

  // Atualizar status para processando
  await query(
    'UPDATE transcricoes_pendentes SET status = $1, updated_at = NOW() WHERE chave = $2',
    ['processando', chave]
  );

  const client = await getClient();

  try {
    // Chamar IA
    const aiResult = await processTranscription(transcription.conteudo_texto, {
      clienteNome: transcription.cliente_nome,
      projetoNome: transcription.projeto_nome,
      consultorNome: transcription.consultor_nome,
      dataReuniao: transcription.data_reuniao
    });

    if (!aiResult.success) {
      await query(
        'UPDATE transcricoes_pendentes SET status = $1, error_message = $2, updated_at = NOW() WHERE chave = $3',
        ['erro', aiResult.error, chave]
      );
      throw new Error(`Erro na IA: ${aiResult.error}`);
    }

    const { json: dados, markdown } = aiResult.parsed;

    // Iniciar transacao
    await client.query('BEGIN');

    // 1. Encontrar ou criar projeto
    let projectId = null;
    const projectName = dados.projeto?.nome || transcription.projeto_nome || 'Projeto sem nome';

    // Tentar encontrar projeto existente pelo nome
    const existingProject = await client.query(
      `SELECT id FROM projects WHERE organization_id = $1 AND name ILIKE $2 LIMIT 1`,
      [orgId, `%${projectName}%`]
    );

    if (existingProject.rows.length > 0) {
      projectId = existingProject.rows[0].id;
      // Atualizar status/fase se informado
      if (dados.projeto?.status || dados.projeto?.fase) {
        await client.query(
          `UPDATE projects SET
            status = COALESCE($1, status),
            description = COALESCE($2, description),
            updated_at = NOW()
          WHERE id = $3`,
          [
            dados.projeto?.status === 'vermelho' ? 'at_risk' :
              dados.projeto?.status === 'bloqueado' ? 'paused' : 'active',
            dados.projeto?.motivo_status,
            projectId
          ]
        );
      }
    } else {
      // Criar novo projeto
      // Tentar encontrar cliente
      let clientId = null;
      const clientName = dados.projeto?.cliente || transcription.cliente_nome;
      if (clientName) {
        const clientResult = await client.query(
          'SELECT id FROM clients WHERE organization_id = $1 AND name ILIKE $2 LIMIT 1',
          [orgId, `%${clientName}%`]
        );
        if (clientResult.rows.length > 0) {
          clientId = clientResult.rows[0].id;
        } else {
          // Criar cliente
          const newClient = await client.query(
            'INSERT INTO clients (organization_id, name) VALUES ($1, $2) RETURNING id',
            [orgId, clientName]
          );
          clientId = newClient.rows[0].id;
        }
      }

      const newProject = await client.query(
        `INSERT INTO projects (organization_id, client_id, name, description, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          orgId,
          clientId,
          projectName,
          dados.projeto?.motivo_status || `Projeto criado a partir de transcricao de reuniao`,
          'active'
        ]
      );
      projectId = newProject.rows[0].id;
    }

    // 2. Criar ata
    const ataResult = await client.query(
      `INSERT INTO atas (
        organization_id, project_id, transcricao_id,
        titulo, data_reuniao, participantes, resumo, conteudo_markdown,
        status_projeto, fase_projeto
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        orgId,
        projectId,
        transcription.id,
        dados.ata?.titulo || `Ata - ${transcription.projeto_nome || projectName}`,
        dados.ata?.data_reuniao || transcription.data_reuniao,
        dados.ata?.participantes || null,
        dados.ata?.resumo || null,
        markdown,
        dados.projeto?.status || null,
        dados.projeto?.fase || null
      ]
    );
    const ata = ataResult.rows[0];

    // 3. Criar acoes
    const acoes = [];
    if (dados.acoes?.length > 0) {
      for (const acao of dados.acoes) {
        // Tentar resolver responsavel
        let responsavelId = null;
        if (acao.responsavel) {
          try {
            const matches = await findUserByName(orgId, acao.responsavel);
            if (matches.length > 0) {
              responsavelId = matches[0].user_id;
            }
          } catch { /* ignorar erro de matching */ }
        }

        const acaoResult = await client.query(
          `INSERT INTO ata_acoes (ata_id, descricao, responsavel, responsavel_id, prazo, tipo, evidencia_minima)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            ata.id,
            acao.descricao || acao.acao,
            acao.responsavel || acao.owner,
            responsavelId,
            acao.prazo,
            acao.tipo,
            acao.evidencia_minima
          ]
        );
        acoes.push(acaoResult.rows[0]);

        // Criar tarefa automaticamente a partir da ação
        if (acaoResult.rows[0]) {
          const acaoData = acaoResult.rows[0];
          const taskResult = await client.query(
            `INSERT INTO tasks (
              organization_id, project_id, title, description,
              assignee_id, due_date, status, priority, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [
              orgId,
              projectId,
              acaoData.descricao?.substring(0, 200) || 'Ação da reunião',
              acaoData.descricao,
              acaoData.responsavel_id,
              acaoData.prazo,
              'todo',
              'medium',
              'ata'
            ]
          );

          // Atualizar ação com o task_id
          if (taskResult.rows[0]) {
            await client.query(
              'UPDATE ata_acoes SET task_id = $1 WHERE id = $2',
              [taskResult.rows[0].id, acaoData.id]
            );
          }
        }
      }
    }

    // 4. Criar decisoes
    const decisoes = [];
    if (dados.decisoes?.length > 0) {
      for (const decisao of dados.decisoes) {
        const decisaoResult = await client.query(
          `INSERT INTO ata_decisoes (ata_id, descricao, responsavel, impacto)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [ata.id, decisao.descricao || decisao.decisao, decisao.responsavel, decisao.impacto]
        );
        decisoes.push(decisaoResult.rows[0]);
      }
    }

    // 5. Criar riscos
    const riscos = [];
    if (dados.riscos?.length > 0) {
      for (const risco of dados.riscos) {
        const riscoResult = await client.query(
          `INSERT INTO ata_riscos (ata_id, descricao, probabilidade, impacto, mitigacao, responsavel)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [ata.id, risco.descricao || risco.risco, risco.probabilidade, risco.impacto, risco.mitigacao, risco.responsavel]
        );
        riscos.push(riscoResult.rows[0]);
      }
    }

    // 6. Atualizar transcricao com referencias
    await client.query(
      `UPDATE transcricoes_pendentes
       SET status = 'processado', projeto_id = $1, ata_id = $2, updated_at = NOW()
       WHERE chave = $3`,
      [projectId, ata.id, chave]
    );

    await client.query('COMMIT');

    // Log da interacao com IA
    await logAIInteraction({
      organization_id: orgId,
      type: 'transcription_processing',
      input_text: transcription.conteudo_texto.substring(0, 500),
      output_structured: dados,
      model: aiResult.model,
      tokens_input: aiResult.tokens?.input,
      tokens_output: aiResult.tokens?.output,
      latency_ms: aiResult.latency,
      confidence: 90,
      success: true
    });

    return {
      success: true,
      project: { id: projectId, name: projectName },
      ata,
      acoes,
      decisoes,
      riscos
    };
  } catch (error) {
    await client.query('ROLLBACK');

    // Atualizar status de erro se nao foi feito ainda
    try {
      await query(
        'UPDATE transcricoes_pendentes SET status = $1, error_message = $2, updated_at = NOW() WHERE chave = $3 AND status = $4',
        ['erro', error.message, chave, 'processando']
      );
    } catch { /* ignorar */ }

    throw error;
  } finally {
    client.release();
  }
}

// ===========================================
// CONSULTAS DE ATAS
// ===========================================

/**
 * Lista atas com filtros
 */
export async function listAtas(organizationId, filters = {}) {
  const { project_id, limit = 50 } = filters;

  let sql = `
    SELECT a.*, p.name as project_name, p.status as project_status,
           (SELECT COUNT(*) FROM ata_acoes WHERE ata_id = a.id) as total_acoes,
           (SELECT COUNT(*) FROM ata_decisoes WHERE ata_id = a.id) as total_decisoes,
           (SELECT COUNT(*) FROM ata_riscos WHERE ata_id = a.id) as total_riscos
    FROM atas a
    LEFT JOIN projects p ON a.project_id = p.id
    WHERE a.organization_id = $1
  `;
  const params = [organizationId];
  let paramIndex = 2;

  if (project_id) {
    sql += ` AND a.project_id = $${paramIndex++}`;
    params.push(project_id);
  }

  sql += ` ORDER BY a.data_reuniao DESC NULLS LAST, a.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Busca ata por ID com todos os dados relacionados
 */
export async function getAtaById(id) {
  const ataResult = await query(
    `SELECT a.*, p.name as project_name, p.status as project_status
     FROM atas a
     LEFT JOIN projects p ON a.project_id = p.id
     WHERE a.id = $1`,
    [id]
  );

  if (ataResult.rows.length === 0) return null;

  const ata = ataResult.rows[0];

  // Buscar dados relacionados em paralelo
  const [acoesResult, decisoesResult, riscosResult] = await Promise.all([
    query('SELECT * FROM ata_acoes WHERE ata_id = $1 ORDER BY prazo ASC NULLS LAST', [id]),
    query('SELECT * FROM ata_decisoes WHERE ata_id = $1 ORDER BY created_at ASC', [id]),
    query('SELECT * FROM ata_riscos WHERE ata_id = $1 ORDER BY created_at ASC', [id])
  ]);

  return {
    ata,
    acoes: acoesResult.rows,
    decisoes: decisoesResult.rows,
    riscos: riscosResult.rows
  };
}

export default {
  parseFilename,
  generateChave,
  saveTranscription,
  getTranscriptionByChave,
  listTranscriptions,
  confirmAndProcess,
  listAtas,
  getAtaById
};
