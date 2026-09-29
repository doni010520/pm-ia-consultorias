import { describe, it, expect, vi } from 'vitest'

vi.mock('../services/database.js', () => ({ query: vi.fn() }))
vi.mock('../services/googleCalendar.js', () => ({ listBusyIntervals: vi.fn(), createCalendarEvent: vi.fn(), getAppUrl: () => 'https://crm' }))

import { calcularSlots, calcularSlotsComExcecao, diasOferecidos, rotulo } from './rica-agenda.js'

const config = { inicioMin: 8 * 60, fimMin: 18 * 60, dias: [1, 2, 3, 4, 5], bufferMin: 0, antecedenciaMin: 30 }
// Horário de Recife (UTC-3) → Date
const recife = (iso) => new Date(`${iso}-03:00`)
const diasDe = (slots) => [...new Set(slots.map((s) => s.rotulo.split(' às ')[0]))]

describe('diasOferecidos (manual GPS, seção 8: D+1 = próximo dia útil)', () => {
  it('quarta: hoje e quinta', () => {
    expect(diasOferecidos(recife('2026-09-30T09:00:00'), config)).toEqual(['2026-09-30', '2026-10-01'])
  })
  it('sexta: hoje e SEGUNDA (sábado não conta)', () => {
    expect(diasOferecidos(recife('2026-10-02T09:00:00'), config)).toEqual(['2026-10-02', '2026-10-05'])
  })
  it('sábado: só segunda (hoje não é dia de atendimento)', () => {
    expect(diasOferecidos(recife('2026-10-03T09:00:00'), config)).toEqual(['2026-10-05'])
  })
})

describe('calcularSlots', () => {
  it('sexta à tarde oferece o resto de sexta e a segunda, com rótulo "segunda" (não "amanhã")', () => {
    const slots = calcularSlots({ agora: recife('2026-10-02T16:00:00'), busy: [], duracao: 30, config })
    expect(diasDe(slots)).toEqual(['hoje (sex, 02/10)', 'segunda (seg, 05/10)'])
  })
  it('não oferece horário ocupado', () => {
    const busy = [{ inicio: recife('2026-09-30T10:00:00'), fim: recife('2026-09-30T11:00:00') }]
    const slots = calcularSlots({ agora: recife('2026-09-30T08:00:00'), busy, duracao: 30, config })
    const hoje = slots.filter((s) => s.rotulo.startsWith('hoje')).map((s) => s.rotulo.split(' às ')[1])
    expect(hoje).not.toContain('10:00')
    expect(hoje).not.toContain('10:30')
    expect(hoje).toContain('11:00')
  })
})

describe('calcularSlotsComExcecao (sem horário em D0/D+1)', () => {
  it('oferece SÓ o próximo dia disponível', () => {
    // quarta e quinta lotadas
    const busy = [{ inicio: recife('2026-09-30T00:00:00'), fim: recife('2026-10-02T00:00:00') }]
    const r = calcularSlotsComExcecao({ agora: recife('2026-09-30T08:00:00'), busy, duracao: 30, config })
    expect(r.excecao).toBe(true)
    expect(diasDe(r.slots)).toEqual(['sexta (sex, 02/10)'])
  })
  it('com horário normal não marca exceção', () => {
    const r = calcularSlotsComExcecao({ agora: recife('2026-09-30T08:00:00'), busy: [], duracao: 30, config })
    expect(r.excecao).toBe(false)
  })
})

describe('rotulo', () => {
  it('amanhã só no dia seguinte', () => {
    expect(rotulo(recife('2026-10-01T14:00:00'), '2026-09-30')).toBe('amanhã (qui, 01/10) às 14:00')
  })
})
