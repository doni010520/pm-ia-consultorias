import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks devem ser declarados antes do import do módulo testado
vi.mock('./database.js', () => ({
  query: vi.fn(),
  createTask: vi.fn(),
  getTasks: vi.fn(),
}))

import { buildRicaTools } from './rica-tools.js'
import { query, createTask } from './database.js'

const FAKE_USER = {
  id: 'user-111',
  organization_id: 'org-aaa',
  name: 'Teste',
  email: 'teste@teste.com',
  role: 'admin',
}

const DEAL_ID = 'deal-001'
const STAGE_ID = 'stage-001'

// ─── move_to_stage ────────────────────────────────────────────────────────────

describe('move_to_stage', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview sem executar UPDATE', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'João Silva', title: 'Lead João' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Negociação', is_won: false, is_lost: false, pipeline_id: 'pipe-1' }] })

    const result = await tools.move_to_stage.execute({ deal_id: DEAL_ID, stage_id: STAGE_ID, confirmed: false })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('João Silva')
    expect(result.description).toContain('Negociação')
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })

  it('confirmed=true executa UPDATE com org isolation e registra atividade', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'João Silva', title: 'Lead João' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Negociação', is_won: false, is_lost: false, pipeline_id: 'pipe-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await tools.move_to_stage.execute({ deal_id: DEAL_ID, stage_id: STAGE_ID, confirmed: true })

    expect(result.status).toBe('done')
    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE deals'))
    expect(updateCall).toBeDefined()
    expect(updateCall[1]).toContain(STAGE_ID)
    expect(updateCall[1]).toContain(DEAL_ID)
    expect(updateCall[1]).toContain('org-aaa')
  })

  it('retorna erro se deal não pertencer à organização', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })  // deal não encontrado pois org filtra
      .mockResolvedValueOnce({ rows: [{ name: 'Negociação', is_won: false, is_lost: false }] })

    const result = await tools.move_to_stage.execute({ deal_id: 'deal-outra-org', stage_id: STAGE_ID, confirmed: true })

    expect(result.error).toBeDefined()
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })

  it('etapa is_won define status=won no UPDATE', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Ana', title: 'Lead Ana' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Fechado/Ganho', is_won: true, is_lost: false, pipeline_id: 'pipe-1' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    await tools.move_to_stage.execute({ deal_id: DEAL_ID, stage_id: 'stage-won', confirmed: true })

    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE deals'))
    expect(updateCall[0]).toContain("status = 'won'")
  })
})

// ─── assign_owner ─────────────────────────────────────────────────────────────

describe('assign_owner', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview sem UPDATE', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Maria', title: 'Lead Maria' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Carlos' }] })

    const result = await tools.assign_owner.execute({ deal_id: DEAL_ID, owner_id: 'user-carlos', confirmed: false })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Carlos')
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })

  it('confirmed=true executa UPDATE com org isolation', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Maria', title: 'Lead Maria' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Carlos' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await tools.assign_owner.execute({ deal_id: DEAL_ID, owner_id: 'user-carlos', confirmed: true })

    expect(result.status).toBe('done')
    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE deals SET owner_id'))
    expect(updateCall[1]).toContain('org-aaa')
  })

  it('retorna erro se usuário não pertencer à organização', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Maria', title: 'Lead Maria' }] })
      .mockResolvedValueOnce({ rows: [] })  // owner não encontrado na org

    const result = await tools.assign_owner.execute({ deal_id: DEAL_ID, owner_id: 'user-outra-org', confirmed: true })

    expect(result.error).toBeDefined()
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })
})

// ─── move_to_pipeline ─────────────────────────────────────────────────────────

describe('move_to_pipeline', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Pedro', title: 'Lead Pedro', pipeline_id: 'pipe-old' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Funil Novo', id: 'pipe-new' }] })

    const result = await tools.move_to_pipeline.execute({ deal_id: DEAL_ID, pipeline_id: 'pipe-new', confirmed: false })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Funil Novo')
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })

  it('confirmed=true move para primeira etapa do funil destino', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Pedro', title: 'Lead Pedro', pipeline_id: 'pipe-old' }] })
      .mockResolvedValueOnce({ rows: [{ name: 'Funil Novo', id: 'pipe-new' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'stage-first' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await tools.move_to_pipeline.execute({ deal_id: DEAL_ID, pipeline_id: 'pipe-new', confirmed: true })

    expect(result.status).toBe('done')
    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE deals SET pipeline_id'))
    expect(updateCall[1]).toContain('pipe-new')
    expect(updateCall[1]).toContain('stage-first')
    expect(updateCall[1]).toContain('org-aaa')
  })

  it('retorna erro se deal não pertencer à organização', async () => {
    // Promise.all([deal, pipeline]) — precisa de 2 mocks
    query
      .mockResolvedValueOnce({ rows: [] })  // deal não encontrado (org filter)
      .mockResolvedValueOnce({ rows: [{ name: 'Funil Qualquer', id: 'pipe-new' }] })

    const result = await tools.move_to_pipeline.execute({ deal_id: 'deal-outra-org', pipeline_id: 'pipe-new', confirmed: true })

    expect(result.error).toBeDefined()
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })
})

// ─── create_note ──────────────────────────────────────────────────────────────

describe('create_note', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview com trecho da nota', async () => {
    query.mockResolvedValueOnce({ rows: [{ contact_name: 'Lúcia', title: 'Lead Lúcia' }] })

    const result = await tools.create_note.execute({
      deal_id: DEAL_ID,
      note: 'Cliente pediu proposta até sexta-feira.',
      confirmed: false,
    })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Lúcia')
    expect(result.description).toContain('Cliente pediu proposta')
    expect(query.mock.calls.some(c => c[0].includes('INSERT'))).toBe(false)
  })

  it('confirmed=true insere atividade e atualiza last_activity_at', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ contact_name: 'Lúcia', title: 'Lead Lúcia' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await tools.create_note.execute({
      deal_id: DEAL_ID,
      note: 'Cliente pediu proposta.',
      confirmed: true,
    })

    expect(result.status).toBe('done')
    const insertCall = query.mock.calls.find(c => c[0].includes('INSERT INTO deal_activities'))
    expect(insertCall[1]).toContain('Cliente pediu proposta.')
  })

  it('retorna erro se deal não pertencer à organização', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const result = await tools.create_note.execute({ deal_id: 'deal-outra-org', note: 'Teste', confirmed: true })

    expect(result.error).toBeDefined()
  })
})

// ─── create_task ──────────────────────────────────────────────────────────────

describe('create_task', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview sem criar tarefa', async () => {
    const result = await tools.create_task.execute({
      title: 'Ligar para João',
      confirmed: false,
      priority: 3,
    })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Ligar para João')
    expect(createTask).not.toHaveBeenCalled()
  })

  it('confirmed=true chama createTask com organization_id correto', async () => {
    query.mockResolvedValueOnce({ rows: [{ name: 'João' }] })  // busca nome do assignee
    createTask.mockResolvedValueOnce({ id: 'task-new-123' })

    const result = await tools.create_task.execute({
      title: 'Ligar para João',
      confirmed: true,
      priority: 3,
      assignee_id: 'user-111',
      due_date: '2026-06-15',
    })

    expect(result.status).toBe('done')
    expect(result.task_id).toBe('task-new-123')
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: 'org-aaa',
        title: 'Ligar para João',
        source: 'rica_chat',
      })
    )
  })

  it('confirmed=false com assignee busca nome mas não cria', async () => {
    query.mockResolvedValueOnce({ rows: [{ name: 'Lúcia' }] })

    const result = await tools.create_task.execute({
      title: 'Reunião',
      confirmed: false,
      priority: 2,
      assignee_id: 'user-lucia',
    })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Lúcia')
    expect(createTask).not.toHaveBeenCalled()
  })
})

// ─── update_task ──────────────────────────────────────────────────────────────

describe('update_task', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview sem UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [{ title: 'Enviar relatório' }] })

    const result = await tools.update_task.execute({
      task_id: 'task-001',
      fields: { status: 'done' },
      confirmed: false,
    })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Enviar relatório')
    expect(query.mock.calls.some(c => c[0].includes('UPDATE tasks'))).toBe(false)
  })

  it('confirmed=true executa UPDATE com org isolation', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ title: 'Enviar relatório' }] })
      .mockResolvedValueOnce({ rows: [] })

    await tools.update_task.execute({
      task_id: 'task-001',
      fields: { status: 'done' },
      confirmed: true,
    })

    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE tasks'))
    expect(updateCall[1]).toContain('org-aaa')
    expect(updateCall[0]).toContain('completed_at = NOW()')
  })

  it('retorna erro se tarefa não pertencer à organização', async () => {
    query.mockResolvedValueOnce({ rows: [] })

    const result = await tools.update_task.execute({
      task_id: 'task-outra-org',
      fields: { status: 'done' },
      confirmed: true,
    })

    expect(result.error).toBeDefined()
  })
})

// ─── update_ata_action ────────────────────────────────────────────────────────

describe('update_ata_action', () => {
  let tools

  beforeEach(() => {
    vi.clearAllMocks()
    tools = buildRicaTools(FAKE_USER)
  })

  it('confirmed=false retorna preview', async () => {
    query.mockResolvedValueOnce({ rows: [{ descricao: 'Enviar proposta ao cliente', ata_id: 'ata-1' }] })

    const result = await tools.update_ata_action.execute({ action_id: 'action-1', status: 'concluida', confirmed: false })

    expect(result.status).toBe('preview')
    expect(result.description).toContain('Enviar proposta')
    expect(query.mock.calls.some(c => c[0].includes('UPDATE ata_acoes'))).toBe(false)
  })

  it('confirmed=true executa UPDATE com status correto', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ descricao: 'Enviar proposta ao cliente', ata_id: 'ata-1' }] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await tools.update_ata_action.execute({ action_id: 'action-1', status: 'concluida', confirmed: true })

    expect(result.status).toBe('done')
    const updateCall = query.mock.calls.find(c => c[0].includes('UPDATE ata_acoes'))
    expect(updateCall[1]).toContain('concluida')
    expect(updateCall[1]).toContain('action-1')
  })

  it('retorna erro se ação não pertencer à organização', async () => {
    query.mockResolvedValueOnce({ rows: [] })  // JOIN com atas WHERE organization_id filtra

    const result = await tools.update_ata_action.execute({ action_id: 'action-outra-org', status: 'concluida', confirmed: true })

    expect(result.error).toBeDefined()
    expect(query.mock.calls.some(c => c[0].includes('UPDATE'))).toBe(false)
  })
})
