/**
 * Serviço de envio de mensagens WhatsApp via UazAPI
 */

const UAZAPI_URL = process.env.UAZAPI_URL || 'https://benitechlab.uazapi.com';
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '';

let initialized = false;

export function initWhatsApp() {
  if (UAZAPI_TOKEN) {
    initialized = true;
    console.log('✅ WhatsApp (UazAPI) inicializado');
  } else {
    console.warn('⚠️ UAZAPI_TOKEN não configurado — alertas WhatsApp desabilitados');
  }
}

/**
 * Envia mensagem de texto via WhatsApp
 * @param {string} number - Número com DDI (ex: 5511999999999)
 * @param {string} text - Texto da mensagem
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function sendText(number, text) {
  if (!initialized || !UAZAPI_TOKEN) {
    console.warn('⚠️ WhatsApp não enviado (token não configurado). Para:', number);
    return { success: false, reason: 'Token não configurado' };
  }

  // Limpar número (remover +, -, espaços, parênteses)
  const cleanNumber = number.replace(/[\s\-\(\)\+]/g, '');

  try {
    const response = await fetch(`${UAZAPI_URL}/send/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': UAZAPI_TOKEN,
      },
      body: JSON.stringify({
        number: cleanNumber,
        text,
        linkPreview: false,
        readchat: true,
        delay: 0,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Erro ao enviar WhatsApp:', data);
      return { success: false, error: data?.message || `HTTP ${response.status}` };
    }

    console.log('✅ WhatsApp enviado para:', cleanNumber);
    return { success: true, data };
  } catch (error) {
    console.error('❌ Erro ao enviar WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Formata número brasileiro para envio
 * Aceita: +55 11 99999-9999, 11999999999, 5511999999999
 * Retorna: 5511999999999
 */
export function formatBrazilianNumber(number) {
  if (!number) return null;
  let clean = number.replace(/[\s\-\(\)\+]/g, '');

  // Se não começa com 55, adiciona
  if (!clean.startsWith('55')) {
    clean = '55' + clean;
  }

  return clean;
}

export default { initWhatsApp, sendText, formatBrazilianNumber };
