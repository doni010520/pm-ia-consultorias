import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { tool, InvalidToolArgumentsError } from 'ai'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { blindarTools, renomearCampoErrado, corrigirEnumInvalido, repararChamadaDeTool, TOOL_FALHOU } from './blindagem.js'

const silencioso = { warn: () => {}, error: () => {} }

describe('corrigirEnumInvalido', () => {
  const schema = zodToJsonSchema(z.object({
    period: z.enum(['hoje', 'mes', 'mes_passado']).optional(),
    start_date: z.string().optional(),
  }))

  it('descarta a data mandada no campo de preset (caso real da Malu)', () => {
    const r = corrigirEnumInvalido('{"period":"2026-08-01","start_date":"2026-08-01","end_date":"2026-08-31"}', schema)
    expect(JSON.parse(r.args)).toEqual({ start_date: '2026-08-01', end_date: '2026-08-31' })
  })

  it('valor válido não é tocado', () => {
    expect(corrigirEnumInvalido('{"period":"mes"}', schema)).toBeNull()
  })
})

describe('repararChamadaDeTool', () => {
  const parameterSchema = () => zodToJsonSchema(z.object({ campanha: z.string(), period: z.enum(['mes', 'mes_passado']).optional() }))
  const erro = (args) => new InvalidToolArgumentsError({ toolName: 'relatorio_campanhas', toolArgs: args, cause: new Error('x') })

  it('enum inválido é corrigido em vez de estourar', async () => {
    const args = '{"campanha":"gps","period":"2026-08-01"}'
    const r = await repararChamadaDeTool({ toolCall: { toolCallType: 'function', toolCallId: '1', toolName: 'relatorio_campanhas', args }, parameterSchema, error: erro(args), logger: silencioso })
    expect(JSON.parse(r.args)).toEqual({ campanha: 'gps' })
  })

  it('campo com nome errado é renomeado', async () => {
    const args = '{"period":"mes","campaign":"gps"}'
    const r = await repararChamadaDeTool({ toolCall: { toolCallType: 'function', toolCallId: '1', toolName: 'relatorio_campanhas', args }, parameterSchema, error: erro(args), logger: silencioso })
    expect(JSON.parse(r.args)).toEqual({ period: 'mes', campanha: 'gps' })
  })
})

describe('blindarTools', () => {
  it('exceção da tool vira resposta que o modelo contorna', async () => {
    const tools = blindarTools({
      relatorio_campanhas: tool({ description: 'x', parameters: z.object({}), execute: async () => { throw new Error('banco fora') } }),
    }, silencioso)
    await expect(tools.relatorio_campanhas.execute({}, {})).resolves.toEqual(TOOL_FALHOU)
  })

  it('não mexe no resultado de quem funciona', async () => {
    const tools = blindarTools({ ok: tool({ description: 'x', parameters: z.object({}), execute: async () => ({ total: 153 }) }) }, silencioso)
    expect(await tools.ok.execute({}, {})).toEqual({ total: 153 })
  })
})

describe('renomearCampoErrado', () => {
  it('exige que seja inequívoco', () => {
    const schema = { properties: { a: {}, b: {} }, required: ['a', 'b'] }
    expect(renomearCampoErrado('{"a":1,"x":2,"y":3}', schema)).toBeNull()
  })
})
