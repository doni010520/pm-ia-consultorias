import axios from 'axios';

// ===========================================
// CONFIGURAÇÃO GENÉRICA - PROVIDER AGNOSTIC
// ===========================================

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const WHATSAPP_API_INSTANCE = process.env.WHATSAPP_API_INSTANCE || '';
const WHATSAPP_PROVIDER = (process.env.WHATSAPP_PROVIDER || 'generic').toLowerCase();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Providers suportados com suas configurações de endpoints e payloads.
 * Para adicionar um novo provider, basta criar um novo objeto aqui.
 *
 * Cada provider define:
 *   - sendText(instance, number, text) → { url, payload }
 *   - sendDocument(instance, number, fileUrl, caption, fileName) → { url, payload }
 *   - parseMessage(body) → { messageId, from, fromName, text, timestamp, isGroup, type }
 *   - headers(token) → object com headers de autenticação
 */
const PROVIDERS = {

  // ========== EVOLUTION API (v1 e v2) ==========
  evolution: {
    headers: (token) => ({
      'Content-Type': 'application/json',
      'apikey': token
    }),
    sendText: (instance, number, text) => ({
      url: `/message/sendText/${instance}`,
      payload: {
        number: formatPhoneNumber(number),
        textMessage: { text }
      }
    }),
    sendDocument: (instance, number, fileUrl, caption, fileName) => ({
      url: `/message/sendMedia/${instance}`,
      payload: {
        number: formatPhoneNumber(number),
        mediaMessage: {
          mediatype: 'document',
          media: fileUrl,
          caption,
          fileName
        }
      }
    }),
    parseMessage: (body) => {
      const data = body.data || body;
      const key = data.key || {};
      const message = data.message || {};
      const type = detectMessageType(message);
      const parsed = {
        messageId: key.id,
        from: key.remoteJid?.split('@')[0],
        fromName: data.pushName || '',
        text: message.conversation ||
              message.extendedTextMessage?.text ||
              message.text || '',
        timestamp: data.messageTimestamp,
        isGroup: key.remoteJid?.includes('@g.us'),
        type
      };
      if (type === 'document' && message.documentMessage) {
        parsed.documentData = {
          fileName: message.documentMessage.fileName || message.documentMessage.title || '',
          mimetype: message.documentMessage.mimetype || '',
          mediaUrl: message.documentMessage.url || '',
          mediaKey: message.documentMessage.mediaKey || '',
          messageId: key.id
        };
      }
      return parsed;
    }
  },

  // ========== UAZAPI ==========
  uazapi: {
    headers: (token) => ({
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'token': token
    }),
    sendText: (instance, number, text) => ({
      url: `/send/text`,
      payload: {
        number: formatPhoneNumber(number),
        text
      }
    }),
    sendDocument: (instance, number, fileUrl, caption, fileName) => ({
      url: `/send/document`,
      payload: {
        number: formatPhoneNumber(number),
        url: fileUrl,
        caption,
        fileName
      }
    }),
    downloadMedia: (messageId) => ({
      url: `/message/download`,
      payload: {
        id: messageId,
        return_link: true,
        return_base64: false
      }
    }),
    parseMessage: (body) => {
      const data = body.body || body;
      const msg = data.message || {};
      const type = detectMessageType(msg);
      const parsed = {
        messageId: msg.messageid || data.key?.id,
        from: (msg.chatid || data.key?.remoteJid || '')?.split('@')[0],
        fromName: data.chat?.wa_name || data.pushName || msg.senderName || '',
        text: msg.text || msg.conversation ||
              msg.extendedTextMessage?.text || '',
        timestamp: msg.messageTimestamp || data.created_at,
        isGroup: data.chat?.wa_isGroup || data.key?.remoteJid?.includes('@g.us') || false,
        type: msg.messageType ? msg.messageType.toLowerCase().replace('message', '') : type,
        fromMe: msg.fromMe || false
      };
      // Normalizar tipo para 'document' quando messageType = 'DocumentMessage'
      if (msg.messageType === 'DocumentMessage' || type === 'document') {
        parsed.type = 'document';
        parsed.documentData = {
          fileName: msg.content?.fileName || msg.content?.title || msg.documentMessage?.fileName || '',
          mimetype: msg.content?.mimetype || msg.documentMessage?.mimetype || '',
          mediaUrl: msg.content?.URL || msg.documentMessage?.url || '',
          mediaKey: msg.content?.mediaKey || msg.documentMessage?.mediaKey || '',
          messageId: msg.messageid || data.key?.id,
          token: data.token || body.token || ''
        };
      }
      return parsed;
    }
  },

  // ========== Z-API ==========
  zapi: {
    headers: (token) => ({
      'Content-Type': 'application/json',
      'Client-Token': token
    }),
    sendText: (instance, number, text) => ({
      url: `/instances/${instance}/token/${WHATSAPP_API_TOKEN}/send-text`,
      payload: {
        phone: formatPhoneNumber(number),
        message: text
      }
    }),
    sendDocument: (instance, number, fileUrl, caption, fileName) => ({
      url: `/instances/${instance}/token/${WHATSAPP_API_TOKEN}/send-document/${formatPhoneNumber(number)}`,
      payload: {
        document: fileUrl,
        caption,
        fileName
      }
    }),
    parseMessage: (body) => {
      const type = body.image ? 'image' : body.document ? 'document' : body.audio ? 'audio' : 'text';
      const parsed = {
        messageId: body.messageId,
        from: body.phone?.replace(/\D/g, ''),
        fromName: body.senderName || '',
        text: body.text?.message || body.text || '',
        timestamp: body.momment,
        isGroup: body.isGroup || false,
        type
      };
      if (type === 'document' && body.document) {
        parsed.documentData = {
          fileName: body.document.fileName || '',
          mimetype: body.document.mimetype || '',
          mediaUrl: body.document.documentUrl || body.document.url || '',
          messageId: body.messageId
        };
      }
      return parsed;
    }
  },

  // ========== CODECHAT ==========
  codechat: {
    headers: (token) => ({
      'Content-Type': 'application/json',
      'apikey': token
    }),
    sendText: (instance, number, text) => ({
      url: `/message/sendText/${instance}`,
      payload: {
        number: formatPhoneNumber(number),
        textMessage: { text }
      }
    }),
    sendDocument: (instance, number, fileUrl, caption, fileName) => ({
      url: `/message/sendMedia/${instance}`,
      payload: {
        number: formatPhoneNumber(number),
        mediaMessage: {
          mediatype: 'document',
          media: fileUrl,
          caption,
          fileName
        }
      }
    }),
    parseMessage: (body) => {
      const data = body.data || body;
      const key = data.key || {};
      const message = data.message || {};
      const type = detectMessageType(message);
      const parsed = {
        messageId: key.id,
        from: key.remoteJid?.split('@')[0],
        fromName: data.pushName || '',
        text: message.conversation ||
              message.extendedTextMessage?.text || '',
        timestamp: data.messageTimestamp,
        isGroup: key.remoteJid?.includes('@g.us'),
        type
      };
      if (type === 'document' && message.documentMessage) {
        parsed.documentData = {
          fileName: message.documentMessage.fileName || '',
          mimetype: message.documentMessage.mimetype || '',
          mediaUrl: message.documentMessage.url || '',
          mediaKey: message.documentMessage.mediaKey || '',
          messageId: key.id
        };
      }
      return parsed;
    }
  },

  // ========== GENÉRICO (tenta auto-detectar) ==========
  generic: {
    headers: (token) => ({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }),
    sendText: (instance, number, text) => ({
      url: instance ? `/message/sendText/${instance}` : '/message/sendText',
      payload: {
        number: formatPhoneNumber(number),
        text
      }
    }),
    sendDocument: (instance, number, fileUrl, caption, fileName) => ({
      url: instance ? `/message/sendMedia/${instance}` : '/message/sendMedia',
      payload: {
        number: formatPhoneNumber(number),
        mediatype: 'document',
        media: fileUrl,
        caption,
        fileName
      }
    }),
    parseMessage: (body) => autoDetectAndParse(body)
  }
};

// ===========================================
// CLIENTE HTTP
// ===========================================

function getProvider() {
  const provider = PROVIDERS[WHATSAPP_PROVIDER];
  if (!provider) {
    console.warn(`⚠️ Provider "${WHATSAPP_PROVIDER}" não reconhecido. Usando "generic".`);
    return PROVIDERS.generic;
  }
  return provider;
}

function createClient() {
  if (!WHATSAPP_API_URL) {
    console.warn('⚠️ WHATSAPP_API_URL não configurada. Envio de mensagens desabilitado.');
    return null;
  }

  const provider = getProvider();
  return axios.create({
    baseURL: WHATSAPP_API_URL,
    headers: provider.headers(WHATSAPP_API_TOKEN),
    timeout: 30000
  });
}

const client = createClient();

// ===========================================
// FUNÇÕES DE ENVIO (Provider-agnostic)
// ===========================================

/**
 * Envia mensagem de texto
 */
export async function sendTextMessage(number, text) {
  if (!client) {
    console.log(`📤 [SEM PROVIDER] Mensagem para ${number}: ${text.substring(0, 100)}...`);
    return { success: false, error: 'WHATSAPP_API_URL não configurada' };
  }

  try {
    const provider = getProvider();
    const { url, payload } = provider.sendText(WHATSAPP_API_INSTANCE, number, text);

    const response = await client.post(url, payload);

    return {
      success: true,
      messageId: response.data?.key?.id || response.data?.messageId || response.data?.id,
      data: response.data
    };
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Envia documento/arquivo
 */
export async function sendDocument(number, fileUrl, caption, fileName) {
  if (!client) {
    console.log(`📤 [SEM PROVIDER] Documento para ${number}: ${fileName}`);
    return { success: false, error: 'WHATSAPP_API_URL não configurada' };
  }

  try {
    const provider = getProvider();
    const { url, payload } = provider.sendDocument(WHATSAPP_API_INSTANCE, number, fileUrl, caption, fileName);

    const response = await client.post(url, payload);

    return {
      success: true,
      messageId: response.data?.key?.id || response.data?.messageId || response.data?.id,
      data: response.data
    };
  } catch (error) {
    console.error('Erro ao enviar documento:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.message || error.message
    };
  }
}

/**
 * Baixa documento enviado via WhatsApp
 * Tenta: (1) URL direta do media, (2) endpoint de download do provider
 * Retorna o conteúdo como texto (tratando encoding UTF-16)
 */
export async function downloadDocument(documentData) {
  if (!documentData) {
    return { success: false, error: 'Sem dados do documento' };
  }

  try {
    let buffer = null;

    // Tentar baixar pela URL direta do media
    if (documentData.mediaUrl) {
      try {
        const response = await axios.get(documentData.mediaUrl, {
          responseType: 'arraybuffer',
          timeout: 30000
        });
        buffer = Buffer.from(response.data);
      } catch (err) {
        console.log('URL direta falhou, tentando via provider...', err.message);
      }
    }

    // Fallback: tentar via endpoint de download do provider
    if (!buffer && client && documentData.messageId) {
      try {
        const provider = getProvider();

        // Se o provider tem downloadMedia definido (ex: Uazapi), usar
        if (provider.downloadMedia) {
          const { url, payload } = provider.downloadMedia(documentData.messageId);
          const response = await client.post(url, payload);

          if (response.data?.fileURL) {
            const fileResponse = await axios.get(response.data.fileURL, {
              responseType: 'arraybuffer',
              timeout: 30000
            });
            buffer = Buffer.from(fileResponse.data);
          } else if (response.data?.base64Data) {
            buffer = Buffer.from(response.data.base64Data, 'base64');
          }
        }

        // Fallback generico para outros providers
        if (!buffer) {
          const genericEndpoints = [
            `/message/download`,
            `/chat/getBase64FromMediaMessage/${WHATSAPP_API_INSTANCE}`
          ];

          for (const endpoint of genericEndpoints) {
            try {
              const response = await client.post(endpoint, {
                id: documentData.messageId,
                message: { key: { id: documentData.messageId } }
              });

              if (response.data?.fileURL) {
                const fileResponse = await axios.get(response.data.fileURL, {
                  responseType: 'arraybuffer',
                  timeout: 30000
                });
                buffer = Buffer.from(fileResponse.data);
                break;
              } else if (response.data?.base64 || response.data?.base64Data) {
                buffer = Buffer.from(response.data.base64 || response.data.base64Data, 'base64');
                break;
              }
            } catch {
              continue;
            }
          }
        }
      } catch (err) {
        console.log('Download via provider falhou:', err.message);
      }
    }

    if (!buffer) {
      return { success: false, error: 'Nao foi possivel baixar o documento' };
    }

    // Converter buffer para texto (tratando encodings)
    const content = convertBufferToText(buffer, documentData.mimetype);

    return {
      success: true,
      content,
      fileName: documentData.fileName || 'documento.txt',
      mimeType: documentData.mimetype || 'text/plain'
    };
  } catch (error) {
    console.error('Erro ao baixar documento:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Converte buffer para texto tratando diferentes encodings (UTF-8, UTF-16)
 */
function convertBufferToText(buffer, mimetype = '') {
  // Detectar BOM (Byte Order Mark)
  if (buffer.length >= 2) {
    // UTF-16 BE BOM: 0xFE 0xFF
    if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
      return buffer.slice(2).swap16().toString('utf16le');
    }
    // UTF-16 LE BOM: 0xFF 0xFE
    if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
      return buffer.slice(2).toString('utf16le');
    }
  }

  // Detectar por mimetype
  if (mimetype.includes('utf-16be')) {
    return buffer.slice(2).swap16().toString('utf16le');
  }
  if (mimetype.includes('utf-16le') || mimetype.includes('utf-16')) {
    return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  }

  // Default: UTF-8
  let text = buffer.toString('utf8');
  // Remover null bytes (comum em conversoes)
  text = text.replace(/\x00/g, '');
  return text;
}

/**
 * Envia mensagem de confirmação de tarefa
 */
export async function sendTaskConfirmation(number, task) {
  const priorityEmoji = {
    low: '🔵',
    normal: '🟢',
    high: '🟡',
    urgent: '🔴'
  };

  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleDateString('pt-BR', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit'
      })
    : 'Não definido';

  const message = `✅ *Tarefa criada!*

📌 *${task.title}*

👤 Responsável: ${task.assignee_name || 'Você'}
📅 Prazo: ${dueDate}
${priorityEmoji[task.priority] || '🟢'} Prioridade: ${task.priority}

🔗 ID: \`${task.id?.substring(0, 8) || 'N/A'}\``;

  return sendTextMessage(number, message);
}

/**
 * Envia pergunta de confirmação (como texto simples — funciona em qualquer provider)
 */
export async function sendConfirmationRequest(number, question, options = ['Sim', 'Não']) {
  const optionsText = options.map((opt, i) => `${i + 1}. ${opt}`).join('\n');
  return sendTextMessage(number, `${question}\n\n${optionsText}\n\n_Responda com o número da opção_`);
}

/**
 * Envia alerta de risco
 */
export async function sendRiskAlert(number, alert) {
  const severityEmoji = alert.severity === 'red' ? '🔴' : '🟡';

  const message = `${severityEmoji} *ALERTA: ${alert.project_name}*

📊 *Situação:* ${alert.summary}

⚠️ *Indicadores críticos:*
${alert.indicators_flagged.map(i => `• ${i}`).join('\n')}

✅ *Ações recomendadas:*
${alert.recommended_actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

📅 Próximo checkpoint: ${alert.next_review_date || 'A definir'}`;

  return sendTextMessage(number, message);
}

/**
 * Envia relatório (como documento)
 */
export async function sendReport(number, reportUrl, reportName, summary) {
  await sendTextMessage(number, `📊 *Relatório Disponível*\n\n${summary}\n\n_Enviando documento..._`);
  return sendDocument(number, reportUrl, 'Relatório em anexo', reportName);
}

// ===========================================
// FUNÇÕES DE RECEBIMENTO (Webhook)
// ===========================================

/**
 * Valida webhook (verifica secret se configurado)
 */
export function validateWebhook(req) {
  if (!WEBHOOK_SECRET) return true;

  // Tenta diferentes headers de assinatura conforme o provider
  const signature = req.headers['x-webhook-signature'] ||
                    req.headers['x-hub-signature'] ||
                    req.headers['x-api-key'] ||
                    req.headers['authorization'];

  if (signature === WEBHOOK_SECRET || signature === `Bearer ${WEBHOOK_SECRET}`) {
    return true;
  }

  console.warn('⚠️ Webhook com assinatura inválida recebido');
  return false;
}

/**
 * Extrai informações da mensagem recebida (auto-detecta formato do provider)
 */
export function parseIncomingMessage(webhookData) {
  const provider = getProvider();
  try {
    return provider.parseMessage(webhookData);
  } catch (error) {
    console.warn(`⚠️ Falha no parser do provider "${WHATSAPP_PROVIDER}". Tentando auto-detecção...`);
    return autoDetectAndParse(webhookData);
  }
}

// ===========================================
// AUTO-DETECÇÃO DE FORMATO
// ===========================================

/**
 * Tenta detectar automaticamente o formato do webhook e extrair dados
 */
function autoDetectAndParse(body) {
  // Formato Evolution API / CodeChat (data.key.remoteJid)
  if (body.data?.key?.remoteJid) {
    return PROVIDERS.evolution.parseMessage(body);
  }

  // Formato Uazapi (body.key.remoteJid ou key no root)
  if (body.key?.remoteJid || (body.body && body.body.key?.remoteJid)) {
    return PROVIDERS.uazapi.parseMessage(body);
  }

  // Formato Z-API (body.phone)
  if (body.phone) {
    return PROVIDERS.zapi.parseMessage(body);
  }

  // Fallback — tenta extrair o que der
  console.warn('⚠️ Formato de webhook não reconhecido. Tentando fallback...');
  return {
    messageId: body.messageId || body.id || body.key?.id || null,
    from: extractPhone(body),
    fromName: body.pushName || body.senderName || body.name || '',
    text: extractText(body),
    timestamp: body.messageTimestamp || body.timestamp || body.momment || Date.now(),
    isGroup: body.isGroup || body.key?.remoteJid?.includes('@g.us') || false,
    type: 'text'
  };
}

/**
 * Tenta extrair telefone de qualquer formato de payload
 */
function extractPhone(body) {
  if (body.phone) return body.phone.replace(/\D/g, '');
  if (body.from) return body.from.replace(/\D/g, '').split('@')[0];
  if (body.key?.remoteJid) return body.key.remoteJid.split('@')[0];
  if (body.data?.key?.remoteJid) return body.data.key.remoteJid.split('@')[0];
  if (body.body?.key?.remoteJid) return body.body.key.remoteJid.split('@')[0];
  return '';
}

/**
 * Tenta extrair texto de qualquer formato de payload
 */
function extractText(body) {
  return body.text?.message ||
         body.text ||
         body.message?.conversation ||
         body.message?.extendedTextMessage?.text ||
         body.message?.text ||
         body.data?.message?.conversation ||
         body.data?.message?.extendedTextMessage?.text ||
         body.body?.message?.conversation ||
         body.body?.message?.extendedTextMessage?.text ||
         '';
}

// ===========================================
// UTILIDADES
// ===========================================

/**
 * Formata número de telefone para padrão internacional
 */
function formatPhoneNumber(number) {
  let cleaned = String(number).replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }

  // Se não tiver código do país, adiciona Brasil (+55)
  if (!cleaned.startsWith('55') && cleaned.length <= 11) {
    cleaned = '55' + cleaned;
  }

  return cleaned;
}

/**
 * Detecta tipo de mensagem a partir do objeto message
 */
function detectMessageType(message) {
  if (!message) return 'unknown';

  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.documentMessage) return 'document';
  if (message.audioMessage) return 'audio';
  if (message.videoMessage) return 'video';
  if (message.buttonsResponseMessage) return 'button_response';
  if (message.listResponseMessage) return 'list_response';

  return 'unknown';
}

/**
 * Retorna o nome do provider ativo
 */
export function getActiveProvider() {
  return {
    name: WHATSAPP_PROVIDER,
    configured: !!WHATSAPP_API_URL,
    url: WHATSAPP_API_URL || '(não configurado)',
    instance: WHATSAPP_API_INSTANCE || '(não configurado)'
  };
}

export default {
  sendTextMessage,
  sendDocument,
  downloadDocument,
  sendTaskConfirmation,
  sendConfirmationRequest,
  sendRiskAlert,
  sendReport,
  validateWebhook,
  parseIncomingMessage,
  getActiveProvider
};
