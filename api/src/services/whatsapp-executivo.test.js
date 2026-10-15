/**
 * WhatsApp corporativo do executivo no CRM (Isabell, 15/10/2026). Só entra
 * conversa individual com lead; grupo, status, reação e apagada ficam de fora.
 */
import { describe, it, expect } from 'vitest';
import { lerExecutivos, interpretarWebhook, mesmoTelefone, dddDe } from './whatsapp-executivo.js';

const payload = (message, chat = {}) => ({ EventType: 'messages', message, chat });

describe('whatsapp do executivo', () => {
  it('lê a configuração de executivos', () => {
    const m = lerExecutivos('andre:André:tok123, maria:Maria Helena:tok9');
    expect(m.andre).toEqual({ slug: 'andre', nome: 'André', token: 'tok123' });
    expect(m.maria.nome).toBe('Maria Helena');
    expect(lerExecutivos('')).toEqual({});
  });

  it('mensagem do executivo para o lead', () => {
    const r = interpretarWebhook(payload({
      chatid: '5581999998888@s.whatsapp.net', messageid: 'ABC', fromMe: true,
      text: 'Oi! Vamos marcar?', messageType: 'Conversation', messageTimestamp: 1760500000000,
    }));
    expect(r).toMatchObject({ telefone: '5581999998888', messageId: 'ABC', doExecutivo: true, texto: 'Oi! Vamos marcar?', tipoMidia: null });
    expect(r.quando).toBe(new Date(1760500000000).toISOString());
  });

  it('áudio do lead vem marcado como mídia', () => {
    const r = interpretarWebhook(payload({
      chatid: '558199998888@s.whatsapp.net', messageid: 'X1', fromMe: false, mediaType: 'ptt', messageType: 'AudioMessage',
    }));
    expect(r).toMatchObject({ doExecutivo: false, tipoMidia: 'ptt', texto: '' });
  });

  it('ignora grupo, status, reação, apagada e outros eventos', () => {
    expect(interpretarWebhook(payload({ chatid: '1203634@g.us', messageid: 'a', isGroup: true, text: 'oi' }))).toBeNull();
    expect(interpretarWebhook(payload({ chatid: 'status@broadcast', messageid: 'a', text: 'oi' }))).toBeNull();
    expect(interpretarWebhook(payload({ chatid: '5581999998888@s.whatsapp.net', messageid: 'a', messageType: 'ReactionMessage' }))).toBeNull();
    expect(interpretarWebhook(payload({ chatid: '5581999998888@s.whatsapp.net', messageid: 'a', messageType: 'revokeMessage' }))).toBeNull();
    expect(interpretarWebhook({ EventType: 'connection', message: { chatid: '558199@s.whatsapp.net', messageid: 'a' } })).toBeNull();
  });

  it('casa telefone com e sem 9º dígito e 55, mas não de DDD diferente', () => {
    expect(mesmoTelefone('5581999998888', '558199998888')).toBe(true);
    expect(mesmoTelefone('81999998888', '5581999998888')).toBe(true);
    expect(mesmoTelefone('5511999998888', '5581999998888')).toBe(false);
    expect(dddDe('5511958430345')).toBe('11');
    expect(dddDe('81999998888')).toBe('81');
  });
});
