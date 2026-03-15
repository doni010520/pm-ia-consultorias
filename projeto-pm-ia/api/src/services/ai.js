import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Clientes de IA
let openai = null;
let anthropic = null;

/**
 * Inicializa clientes de IA
 */
export function initAI() {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    console.log('✅ OpenAI inicializado');
  }

  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('✅ Anthropic inicializado');
  }
}

// Inicializar ao importar
initAI();

/**
 * Carrega template de prompt
 */
function loadPromptTemplate(name) {
  const promptPath = path.join(__dirname, '../../..', 'prompts', `${name}.txt`);
  
  if (fs.existsSync(promptPath)) {
    return fs.readFileSync(promptPath, 'utf-8');
  }
  
  console.warn(`⚠️ Template de prompt não encontrado: ${name}`);
  return null;
}

/**
 * Substitui variáveis no template
 */
function fillTemplate(template, variables) {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value || '');
  }
  
  return result;
}

/**
 * Chama OpenAI (para alto volume)
 */
export async function callOpenAI(prompt, options = {}) {
  if (!openai) {
    throw new Error('OpenAI não configurado');
  }

  const {
    model = process.env.DEFAULT_MODEL_VOLUME || 'gpt-4.1-mini',
    temperature = 0.1,
    maxTokens = 1000,
    jsonMode = true
  } = options;

  const start = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode && { response_format: { type: 'json_object' } })
    });

    const latency = Date.now() - start;
    const content = response.choices[0]?.message?.content || '';

    return {
      success: true,
      content,
      parsed: jsonMode ? JSON.parse(content) : null,
      model,
      tokens: {
        input: response.usage?.prompt_tokens,
        output: response.usage?.completion_tokens
      },
      latency
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      model,
      latency: Date.now() - start
    };
  }
}

/**
 * Chama Claude (para qualidade)
 */
export async function callClaude(prompt, options = {}) {
  if (!anthropic) {
    throw new Error('Anthropic não configurado');
  }

  const {
    model = process.env.DEFAULT_MODEL_QUALITY || 'claude-sonnet-4-20250514',
    temperature = 0.3,
    maxTokens = 2000
  } = options;

  const start = Date.now();

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });

    const latency = Date.now() - start;
    const content = response.content[0]?.text || '';

    // Tentar parsear JSON se parecer ser JSON
    let parsed = null;
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      try {
        parsed = JSON.parse(content);
      } catch {
        // Não é JSON válido, ignorar
      }
    }

    return {
      success: true,
      content,
      parsed,
      model,
      tokens: {
        input: response.usage?.input_tokens,
        output: response.usage?.output_tokens
      },
      latency
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      model,
      latency: Date.now() - start
    };
  }
}

/**
 * Extrai informações de tarefa de uma mensagem
 */
export async function extractTaskFromMessage(message, context) {
  const template = loadPromptTemplate('extrair_tarefa');
  
  if (!template) {
    throw new Error('Template de extração de tarefa não encontrado');
  }

  const prompt = fillTemplate(template, {
    currentDateTime: new Date().toISOString(),
    organizationName: context.organizationName || 'Organização',
    senderName: context.senderName || 'Usuário',
    senderWhatsapp: context.senderWhatsapp || '',
    teamMembers: context.teamMembers || 'Nenhum membro cadastrado',
    userMessage: message
  });

  // Usar GPT para extração (alto volume, resposta estruturada)
  const result = await callOpenAI(prompt, {
    temperature: 0.1,
    jsonMode: true
  });

  return result;
}

/**
 * Analisa risco de um projeto
 */
export async function analyzeProjectRisk(projectData, metrics) {
  const template = loadPromptTemplate('analisar_risco');
  
  const prompt = fillTemplate(template || defaultRiskPrompt(), {
    projectName: projectData.name,
    clientName: projectData.client_name || 'Cliente',
    dueDate: projectData.due_date || 'Não definido',
    budgetHours: projectData.budget_hours || 'Não definido',
    indicators: JSON.stringify(metrics, null, 2)
  });

  // Usar Claude para análise de risco (qualidade)
  return callClaude(prompt, {
    temperature: 0.3,
    maxTokens: 1500
  });
}

/**
 * Gera relatório executivo
 */
export async function generateReport(reportType, projectData, metrics) {
  const template = loadPromptTemplate('gerar_relatorio');
  
  const now = new Date();
  const periodEnd = now.toISOString().split('T')[0];
  const periodStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const prompt = fillTemplate(template || defaultReportPrompt(), {
    reportType,
    clientName: projectData.client_name || 'Cliente',
    projectName: projectData.name,
    periodStart,
    periodEnd,
    currentDate: periodEnd,
    organizationName: 'Consultoria',
    metricsData: JSON.stringify(metrics, null, 2)
  });

  // Usar Claude para relatórios (qualidade de escrita)
  return callClaude(prompt, {
    temperature: 0.4,
    maxTokens: 3000
  });
}

/**
 * Processa transcrição de reunião e extrai dados estruturados + markdown
 */
export async function processTranscription(transcriptionText, context) {
  const template = loadPromptTemplate('processar_transcricao');

  if (!template) {
    throw new Error('Template processar_transcricao não encontrado');
  }

  const prompt = fillTemplate(template, {
    clienteNome: context.clienteNome || 'Não identificado',
    projetoNome: context.projetoNome || 'Não identificado',
    consultorNome: context.consultorNome || 'Não identificado',
    dataReuniao: context.dataReuniao || new Date().toISOString().split('T')[0],
    currentDateTime: new Date().toISOString(),
    transcricaoTexto: transcriptionText
  });

  const result = await callOpenAI(prompt, {
    model: process.env.DEFAULT_MODEL_VOLUME || 'gpt-4.1-mini',
    temperature: 0.1,
    jsonMode: false,
    maxTokens: 4000
  });

  if (!result.success) {
    return result;
  }

  // Parsear resposta no formato JSON|||MARKDOWN
  const separatorIndex = result.content.indexOf('|||');
  if (separatorIndex === -1) {
    return {
      success: false,
      error: 'Resposta da IA não está no formato esperado (JSON|||MARKDOWN)',
      content: result.content,
      model: result.model,
      tokens: result.tokens,
      latency: result.latency
    };
  }

  const jsonPart = result.content.substring(0, separatorIndex).trim();
  const markdownPart = result.content.substring(separatorIndex + 3).trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonPart);
  } catch (err) {
    return {
      success: false,
      error: `Erro ao parsear JSON da IA: ${err.message}`,
      content: result.content,
      model: result.model,
      tokens: result.tokens,
      latency: result.latency
    };
  }

  // Preencher prazos vazios com default de 7 dias
  const defaultDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  if (parsed.acoes) {
    parsed.acoes = parsed.acoes.map(acao => ({
      ...acao,
      prazo: acao.prazo && acao.prazo !== 'null' ? acao.prazo : defaultDeadline
    }));
  }

  return {
    success: true,
    parsed: {
      json: parsed,
      markdown: markdownPart
    },
    model: result.model,
    tokens: result.tokens,
    latency: result.latency
  };
}

// Prompts fallback
function defaultRiskPrompt() {
  return `Analise os indicadores do projeto e gere um alerta:
PROJETO: {{projectName}}
INDICADORES: {{indicators}}

Responda com severidade (yellow/red), resumo e ações recomendadas.`;
}

function defaultReportPrompt() {
  return `Gere um relatório executivo:
PROJETO: {{projectName}}
PERÍODO: {{periodStart}} a {{periodEnd}}
DADOS: {{metricsData}}

Inclua: resumo, entregas, métricas, próximos passos.`;
}

export default {
  callOpenAI,
  callClaude,
  extractTaskFromMessage,
  analyzeProjectRisk,
  generateReport,
  processTranscription
};
