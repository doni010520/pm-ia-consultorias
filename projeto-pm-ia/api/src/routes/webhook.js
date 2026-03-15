import { Router } from 'express';
import { validateWebhook, parseIncomingMessage, sendTextMessage, sendTaskConfirmation, sendConfirmationRequest, downloadDocument, getActiveProvider } from '../services/whatsapp.js';
import { classifyIntent, extractTaskFromMessage } from '../services/ai.js';
import { getTeamMembers, createTask, findUserByName, logAIInteraction, query, getConversation, saveConversation, updateConversation, deleteConversation } from '../services/database.js';
import { parseFilename, generateChave, saveTranscription, confirmAndProcess } from '../services/transcription.js';

const router = Router();

/**
 * POST /webhook/whatsapp
 * Recebe mensagens de qualquer API de WhatsApp (Evolution, Uazapi, Z-API, etc.)
 * Configure o webhook do seu provedor para apontar para este endpoint.
 */
router.post('/whatsapp', async (req, res, next) => {
  try {
    // Validar webhook
    if (!validateWebhook(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Responder imediatamente (provedores esperam resposta rápida)
    res.json({ success: true });

    // Processar mensagem de forma assíncrona
    processIncomingMessage(req.body).catch(err => {
      console.error('Erro ao processar mensagem:', err);
    });
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Processa mensagem recebida
 */
async function processIncomingMessage(webhookData) {
  const message = parseIncomingMessage(webhookData);

  // Ignorar mensagens de grupo
  if (message.isGroup) return;

  // Ignorar mensagens enviadas por mim (fromMe)
  if (message.fromMe) return;

  // Ignorar mensagens sem texto E sem documento
  if (!message.text && message.type !== 'document') return;

  const organizationId = process.env.DEFAULT_ORGANIZATION_ID;

  console.log(`📩 Mensagem de ${message.fromName || message.from}: ${message.text || `[${message.type}]`}`);

  // Se for documento, tratar fluxo de transcricao
  if (message.type === 'document' && message.documentData) {
    await handleDocumentMessage(message, organizationId);
    return;
  }

  // Verificar se há conversa pendente no banco
  const pending = await getConversation(message.from);

  if (pending) {
    await handlePendingConversation(message, pending, organizationId);
    return;
  }

  // Classificar intenção
  const classificationStart = Date.now();
  const classificationResult = await classifyIntent(message.text);

  if (!classificationResult.success) {
    console.error('Erro na classificação:', classificationResult.error);
    await sendTextMessage(message.from, '❌ Desculpe, tive um problema ao processar sua mensagem. Pode tentar novamente?');
    return;
  }

  const classification = classificationResult.parsed;

  // Log da interação
  await logAIInteraction({
    organization_id: organizationId,
    type: 'intent_classification',
    input_text: message.text,
    output_structured: classification,
    model: classificationResult.model,
    latency_ms: Date.now() - classificationStart,
    confidence: classification.confidence,
    success: true
  });

  console.log(`🎯 Intenção: ${classification.category} (${classification.confidence}%)`);

  // Processar baseado na intenção
  switch (classification.category) {
    case 'CRIAR_TAREFA':
      await handleCreateTask(message, organizationId);
      break;

    case 'STATUS_PROJETO':
      await handleProjectStatus(message, organizationId, classification.entities?.project_name);
      break;

    case 'STATUS_TAREFAS':
    case 'ATRASADOS':
    case 'PROXIMAS_ENTREGAS':
      await handleTasksStatus(message, organizationId, classification.category);
      break;

    case 'STATUS_EQUIPE':
      await handleTeamStatus(message, organizationId);
      break;

    case 'FINANCEIRO':
      await handleFinancialQuery(message, organizationId);
      break;

    case 'RELATORIO':
      await handleReportRequest(message, organizationId);
      break;

    case 'ATUALIZAR_TAREFA':
      await handleUpdateTask(message, organizationId);
      break;

    default:
      await sendTextMessage(message.from,
        `👋 Olá ${message.fromName || ''}!\n\nPosso ajudar você com:\n\n` +
        `📌 *Criar tarefas* - Ex: "Pedir pro João fazer relatório até sexta"\n` +
        `📊 *Ver status* - Ex: "Como está o projeto ABC?"\n` +
        `⚠️ *Ver atrasados* - Ex: "O que está atrasado?"\n` +
        `📄 *Gerar relatório* - Ex: "Gerar relatório semanal"\n\n` +
        `Como posso ajudar?`
      );
  }
}

/**
 * Manipula criação de tarefa
 */
async function handleCreateTask(message, organizationId) {
  // Buscar membros da equipe
  const teamMembers = await getTeamMembers(organizationId);
  const membersList = teamMembers.map(m => `- ${m.name}`).join('\n');

  // Extrair tarefa com IA
  const extractionStart = Date.now();
  const extractionResult = await extractTaskFromMessage(message.text, {
    organizationName: 'Consultoria',
    senderName: message.fromName || 'Usuário',
    senderWhatsapp: message.from,
    teamMembers: membersList
  });

  if (!extractionResult.success) {
    await sendTextMessage(message.from, '❌ Não consegui entender a tarefa. Pode reformular?');
    return;
  }

  const extracted = extractionResult.parsed;

  // Log da extração
  await logAIInteraction({
    organization_id: organizationId,
    type: 'task_extraction',
    input_text: message.text,
    output_structured: extracted,
    model: extractionResult.model,
    latency_ms: Date.now() - extractionStart,
    confidence: extracted.confidence,
    success: true
  });

  // Se precisa confirmação
  if (extracted.confidence < 70 || extracted.needs_confirmation) {
    await saveConversation(message.from, organizationId, 'waiting_confirmation', {
      type: 'task_confirmation',
      extracted
    });

    const confirmMessage = extracted.confirmation_message ||
      `Entendi: *${extracted.title}*\n` +
      `👤 Para: ${extracted.assignee || 'você'}\n` +
      `📅 Prazo: ${extracted.due_date ? new Date(extracted.due_date).toLocaleDateString('pt-BR') : 'não definido'}\n\n` +
      `Confirma a criação?`;

    await sendConfirmationRequest(message.from, confirmMessage, ['✅ Sim, criar', '❌ Cancelar', '✏️ Editar']);
    return;
  }

  // Criar tarefa diretamente
  await createAndNotifyTask(message, organizationId, extracted);
}

/**
 * Cria tarefa e notifica
 */
async function createAndNotifyTask(message, organizationId, extracted) {
  // Buscar ID do responsável
  let assigneeId = null;
  let assigneeName = extracted.assignee;

  if (extracted.assignee) {
    const matches = await findUserByName(organizationId, extracted.assignee);
    if (matches.length > 0) {
      assigneeId = matches[0].user_id;
      assigneeName = matches[0].user_name;
    }
  }

  // Criar tarefa
  const task = await createTask({
    organization_id: organizationId,
    project_id: extracted.project_id || null,
    title: extracted.title,
    description: extracted.description,
    assignee_id: assigneeId,
    due_date: extracted.due_date,
    priority: extracted.priority || 'normal',
    source: 'whatsapp',
    ai_confidence: extracted.confidence
  });

  // Confirmar criação
  await sendTaskConfirmation(message.from, {
    ...task,
    assignee_name: assigneeName
  });
}

/**
 * Manipula conversa pendente (persistida no banco)
 */
async function handlePendingConversation(message, pending, organizationId) {
  const response = message.text.toLowerCase();
  const context = typeof pending.context === 'string' ? JSON.parse(pending.context) : pending.context;

  if (context.type === 'task_confirmation') {
    if (response.includes('sim') || response.includes('criar') || response === '1') {
      await deleteConversation(pending.id);
      await createAndNotifyTask(message, organizationId, context.extracted);
    } else if (response.includes('não') || response.includes('cancelar') || response === '2') {
      await deleteConversation(pending.id);
      await sendTextMessage(message.from, '❌ Tarefa cancelada.');
    } else if (response.includes('editar') || response === '3') {
      await sendTextMessage(message.from, '✏️ Me diga o que quer alterar na tarefa.');
    } else {
      await deleteConversation(pending.id);
      await handleCreateTask(message, organizationId);
    }
  }

  if (context.type === 'transcription_confirmation') {
    if (response.includes('sim') || response === '1') {
      await deleteConversation(pending.id);
      await sendTextMessage(message.from, '⏳ Processando transcricao... Isso pode levar alguns segundos.');

      try {
        const result = await confirmAndProcess(context.chave, organizationId);
        const acoes = result.acoes?.length || 0;
        const decisoes = result.decisoes?.length || 0;
        const riscos = result.riscos?.length || 0;

        await sendTextMessage(message.from,
          `✅ *Transcricao processada!*\n\n` +
          `📁 *Projeto:* ${result.project.name}\n` +
          `📋 *Ata:* ${result.ata.titulo}\n\n` +
          `📊 Extraido:\n` +
          `• ${acoes} acao(oes)\n` +
          `• ${decisoes} decisao(oes)\n` +
          `• ${riscos} risco(s)\n\n` +
          `Use a API para ver os detalhes completos.`
        );
      } catch (err) {
        console.error('Erro ao processar transcricao:', err);
        await sendTextMessage(message.from, `❌ Erro ao processar: ${err.message}`);
      }
    } else if (response.includes('não') || response.includes('cancelar') || response === '2') {
      await deleteConversation(pending.id);
      await query(
        "UPDATE transcricoes_pendentes SET status = 'cancelado', updated_at = NOW() WHERE chave = $1",
        [context.chave]
      );
      await sendTextMessage(message.from, '❌ Transcricao cancelada.');
    } else {
      await sendTextMessage(message.from, 'Responda *sim* para processar ou *nao* para cancelar.');
    }
  }
}

/**
 * Manipula consulta de status do projeto
 */
async function handleProjectStatus(message, organizationId, projectName) {
  try {
    let sql = `
      SELECT p.*, c.name as client_name,
             COUNT(t.id) FILTER (WHERE t.status != 'cancelled') as total_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW()) as overdue_tasks
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id
      LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.organization_id = $1 AND p.status = 'active'
    `;
    const params = [organizationId];

    if (projectName) {
      sql += ` AND (p.name ILIKE $2 OR c.name ILIKE $2)`;
      params.push(`%${projectName}%`);
    }

    sql += ` GROUP BY p.id, c.name LIMIT 1`;

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      await sendTextMessage(message.from, '🔍 Não encontrei nenhum projeto ativo com esse nome.');
      return;
    }

    const project = result.rows[0];
    const progress = Math.round((project.completed_tasks / Math.max(project.total_tasks, 1)) * 100);

    const statusMessage = `📊 *${project.name}*\n` +
      `Cliente: ${project.client_name || 'N/A'}\n\n` +
      `✅ Progresso: ${progress}% (${project.completed_tasks}/${project.total_tasks} tarefas)\n` +
      `⚠️ Atrasadas: ${project.overdue_tasks}\n` +
      `📅 Prazo: ${project.due_date ? new Date(project.due_date).toLocaleDateString('pt-BR') : 'Não definido'}\n\n` +
      `${project.overdue_tasks > 0 ? '🔴 Atenção: há tarefas atrasadas!' : '🟢 Projeto no prazo'}`;

    await sendTextMessage(message.from, statusMessage);
  } catch (error) {
    console.error('Erro ao buscar status:', error);
    await sendTextMessage(message.from, '❌ Erro ao buscar status do projeto.');
  }
}

/**
 * Manipula consulta de tarefas
 */
async function handleTasksStatus(message, organizationId, queryType) {
  try {
    let sql = `
      SELECT t.title, t.due_date, t.priority, t.status, u.name as assignee_name
      FROM tasks t
      LEFT JOIN users u ON t.assignee_id = u.id
      WHERE t.organization_id = $1 AND t.status NOT IN ('done', 'cancelled')
    `;

    if (queryType === 'ATRASADOS') {
      sql += ` AND t.due_date < NOW()`;
    } else if (queryType === 'PROXIMAS_ENTREGAS') {
      sql += ` AND t.due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'`;
    }

    sql += ` ORDER BY t.due_date ASC NULLS LAST LIMIT 10`;

    const result = await query(sql, [organizationId]);

    if (result.rows.length === 0) {
      const noResultsMessage = queryType === 'ATRASADOS'
        ? '✅ Nenhuma tarefa atrasada! 🎉'
        : '📋 Nenhuma tarefa pendente encontrada.';
      await sendTextMessage(message.from, noResultsMessage);
      return;
    }

    const priorityEmoji = { low: '🔵', normal: '🟢', high: '🟡', urgent: '🔴' };

    const header = queryType === 'ATRASADOS'
      ? '⚠️ *Tarefas Atrasadas*\n\n'
      : queryType === 'PROXIMAS_ENTREGAS'
        ? '📅 *Próximas Entregas (7 dias)*\n\n'
        : '📋 *Tarefas Pendentes*\n\n';

    const tasksList = result.rows.map((t, i) => {
      const dueDate = t.due_date ? new Date(t.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'S/D';
      return `${i + 1}. ${priorityEmoji[t.priority] || '🟢'} ${t.title}\n   👤 ${t.assignee_name || 'N/A'} | 📅 ${dueDate}`;
    }).join('\n\n');

    await sendTextMessage(message.from, header + tasksList);
  } catch (error) {
    console.error('Erro ao buscar tarefas:', error);
    await sendTextMessage(message.from, '❌ Erro ao buscar tarefas.');
  }
}

/**
 * Manipula consulta de equipe
 */
async function handleTeamStatus(message, organizationId) {
  try {
    const result = await query(`
      SELECT u.name,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled')) as active_tasks,
             COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW()) as overdue_tasks
      FROM users u
      LEFT JOIN tasks t ON t.assignee_id = u.id
      WHERE u.organization_id = $1 AND u.is_active = true
      GROUP BY u.id
      ORDER BY active_tasks DESC
    `, [organizationId]);

    const statusMessage = '👥 *Carga da Equipe*\n\n' +
      result.rows.map(u => {
        const status = u.overdue_tasks > 0 ? '🔴' : u.active_tasks > 5 ? '🟡' : '🟢';
        return `${status} *${u.name}*: ${u.active_tasks} tarefas${u.overdue_tasks > 0 ? ` (${u.overdue_tasks} atrasadas)` : ''}`;
      }).join('\n');

    await sendTextMessage(message.from, statusMessage);
  } catch (error) {
    console.error('Erro ao buscar equipe:', error);
    await sendTextMessage(message.from, '❌ Erro ao buscar status da equipe.');
  }
}

/**
 * Manipula consulta financeira
 */
async function handleFinancialQuery(message, organizationId) {
  try {
    const result = await query(`
      SELECT
        SUM(te.hours) as total_hours,
        SUM(te.hours) FILTER (WHERE te.is_billable) as billable_hours,
        SUM(te.hours * COALESCE(te.hourly_rate, 0)) FILTER (WHERE te.is_billable) as total_value
      FROM time_entries te
      WHERE te.organization_id = $1
        AND te.date >= date_trunc('month', CURRENT_DATE)
    `, [organizationId]);

    const data = result.rows[0];
    const utilizationRate = data.total_hours > 0
      ? Math.round((data.billable_hours / data.total_hours) * 100)
      : 0;

    const financialMessage = '💰 *Resumo Financeiro (Mês Atual)*\n\n' +
      `⏱️ Total de horas: ${parseFloat(data.total_hours || 0).toFixed(1)}h\n` +
      `💼 Horas faturáveis: ${parseFloat(data.billable_hours || 0).toFixed(1)}h\n` +
      `📊 Taxa de utilização: ${utilizationRate}%\n` +
      `💵 Valor estimado: R$ ${parseFloat(data.total_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
      `${utilizationRate >= 75 ? '🟢 Boa utilização!' : utilizationRate >= 50 ? '🟡 Utilização pode melhorar' : '🔴 Atenção: utilização baixa'}`;

    await sendTextMessage(message.from, financialMessage);
  } catch (error) {
    console.error('Erro ao buscar financeiro:', error);
    await sendTextMessage(message.from, '❌ Erro ao buscar dados financeiros.');
  }
}

/**
 * Manipula solicitação de relatório
 */
async function handleReportRequest(message, organizationId) {
  await sendTextMessage(message.from,
    '📊 *Geração de Relatório*\n\n' +
    'Para gerar um relatório, especifique:\n\n' +
    '• "Relatório semanal do projeto X"\n' +
    '• "Relatório mensal da Empresa Y"\n\n' +
    '_Qual relatório você precisa?_'
  );
}

/**
 * Manipula atualização de tarefa
 */
async function handleUpdateTask(message, organizationId) {
  await sendTextMessage(message.from,
    '✏️ *Atualizar Tarefa*\n\n' +
    'Me diga qual tarefa quer atualizar:\n\n' +
    '• "Concluir tarefa [nome]"\n' +
    '• "Marcar [nome] como em andamento"\n' +
    '• "Alterar prazo de [nome] para [data]"'
  );
}

/**
 * Manipula recebimento de documento (transcricao .txt)
 */
async function handleDocumentMessage(message, organizationId) {
  const { documentData } = message;
  const fileName = documentData.fileName || '';

  // Verificar se e um arquivo de texto
  const isText = fileName.endsWith('.txt') ||
    (documentData.mimetype && documentData.mimetype.includes('text'));

  if (!isText) {
    await sendTextMessage(message.from,
      '📄 Recebi o arquivo, mas no momento so processo arquivos *.txt* de transcricao.\n\n' +
      'Envie um arquivo .txt no formato:\n`[Cliente][Projeto][Consultor][Data].txt`'
    );
    return;
  }

  // Baixar documento
  await sendTextMessage(message.from, '⏳ Baixando arquivo...');

  const download = await downloadDocument(documentData);

  if (!download.success) {
    await sendTextMessage(message.from, `❌ Erro ao baixar arquivo: ${download.error}`);
    return;
  }

  // Parsear nome do arquivo
  const parsed = parseFilename(fileName);
  const chave = generateChave(parsed);

  // Salvar transcricao
  try {
    const transcription = await saveTranscription({
      organizationId,
      chave,
      parsed,
      fileName,
      textContent: download.content,
      source: 'whatsapp',
      sourcePhone: message.from
    });

    // Montar mensagem de confirmacao
    let confirmMsg;
    if (parsed) {
      confirmMsg = `📋 *Transcricao recebida!*\n\n` +
        `Confirme os dados:\n` +
        `👤 *Cliente:* ${parsed.cliente}\n` +
        `📁 *Projeto:* ${parsed.projeto}\n` +
        `🧑‍💼 *Consultor:* ${parsed.consultor}\n` +
        `📅 *Data:* ${parsed.dataReuniao}\n\n` +
        `Os dados estao corretos? Responda *sim* para processar ou *nao* para cancelar.`;
    } else {
      confirmMsg = `📋 *Arquivo recebido:* ${fileName}\n\n` +
        `Nao consegui extrair os metadados do nome do arquivo.\n` +
        `Deseja processar mesmo assim? Responda *sim* ou *nao*.`;
    }

    // Salvar conversa pendente para aguardar confirmacao
    await saveConversation(message.from, organizationId, 'waiting_confirmation', {
      type: 'transcription_confirmation',
      chave
    });

    await sendTextMessage(message.from, confirmMsg);
  } catch (error) {
    console.error('Erro ao salvar transcricao:', error);
    await sendTextMessage(message.from, `❌ Erro ao processar arquivo: ${error.message}`);
  }
}

export default router;
