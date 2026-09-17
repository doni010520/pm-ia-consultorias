/**
 * Nenhuma tool pode derrubar a resposta ao time.
 *
 * POR QUE ISTO EXISTE: testando as perguntas reais da Malu, o modelo chamou
 * relatorio_campanhas com period="2026-08-01" (valor que não existe no enum) e a
 * chamada LANÇOU InvalidToolArgumentsError — em produção isso viraria erro na
 * cara de quem perguntou. É a mesma classe de falha que mandava "pode repetir?"
 * ao cliente no rica-bot (ver rica-bot/src/tools/blindagem.ts).
 *
 * Aqui são duas camadas: reparo do argumento quando é inequívoco, e tool que
 * falha devolvendo texto que o modelo contorna em vez de exceção.
 */

import { InvalidToolArgumentsError } from 'ai';

export const TOOL_FALHOU = {
  erro: 'Não consegui completar essa consulta agora.',
  instrucao: 'Diga isso em uma frase e ofereça tentar de novo. Não invente número nem mencione erro técnico.',
};

/** Renomeia UM campo desconhecido para o UNICO obrigatório que falta. */
export function renomearCampoErrado(argsJson, schema) {
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const conhecidos = Object.keys(schema?.properties ?? {});
  const faltando = (schema?.required ?? []).filter((k) => !(k in args));
  const sobrando = Object.keys(args).filter((k) => !conhecidos.includes(k));
  if (faltando.length !== 1 || sobrando.length !== 1) return null;
  const para = faltando[0];
  const de = sobrando[0];
  const { [de]: valor, ...resto } = args;
  return { args: JSON.stringify({ ...resto, [para]: valor }), de, para };
}

/**
 * Valor fora do enum: cai para o default declarado no schema, ou sai do objeto.
 * "period: 2026-08-01" (data no campo de preset) é o caso que apareceu de verdade —
 * as datas vinham certas em start_date/end_date, então basta descartar o period.
 */
export function corrigirEnumInvalido(argsJson, schema) {
  let args;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return null;
  }
  if (!args || typeof args !== 'object') return null;
  const props = schema?.properties ?? {};
  const ajustes = [];
  for (const [chave, valor] of Object.entries(args)) {
    const opcoes = props[chave]?.enum;
    if (!Array.isArray(opcoes) || opcoes.includes(valor)) continue;
    if (props[chave]?.default !== undefined) args[chave] = props[chave].default;
    else delete args[chave];
    ajustes.push(chave);
  }
  if (!ajustes.length) return null;
  return { args: JSON.stringify(args), campos: ajustes };
}

export async function repararChamadaDeTool({ toolCall, parameterSchema, error, logger = console }) {
  if (!InvalidToolArgumentsError.isInstance(error)) return null;
  const schema = parameterSchema({ toolName: toolCall.toolName });

  const renomeado = renomearCampoErrado(toolCall.args, schema);
  if (renomeado) {
    logger.warn?.(`[blindagem] ${toolCall.toolName}: campo "${renomeado.de}" renomeado para "${renomeado.para}"`);
    return { ...toolCall, args: renomeado.args };
  }
  const enumCorrigido = corrigirEnumInvalido(toolCall.args, schema);
  if (enumCorrigido) {
    logger.warn?.(`[blindagem] ${toolCall.toolName}: valor inválido em ${enumCorrigido.campos.join(', ')} descartado`);
    return { ...toolCall, args: enumCorrigido.args };
  }
  return null;
}

/** Exceção dentro da tool vira resultado que o modelo lê e contorna. */
export function blindarTools(tools, logger = console) {
  const out = {};
  for (const [nome, t] of Object.entries(tools)) {
    if (typeof t?.execute !== 'function') {
      out[nome] = t;
      continue;
    }
    const original = t.execute;
    out[nome] = {
      ...t,
      execute: async (args, options) => {
        try {
          return await original(args, options);
        } catch (err) {
          logger.error?.(`[blindagem] tool ${nome} falhou: ${err?.message}`);
          return TOOL_FALHOU;
        }
      },
    };
  }
  return out;
}
