const API_URL = import.meta.env.VITE_API_URL || ''
const ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`
  const token = localStorage.getItem('pm-ia-token')
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options?.headers,
    },
    ...options,
  })

  if (res.status === 401) {
    localStorage.removeItem('pm-ia-token')
    window.location.href = '/login'
    throw new Error('Sessão expirada')
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(error.error?.message || `HTTP ${res.status}`)
  }

  return res.json()
}

function withOrg(params: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams()
  if (ORG_ID) p.set('organization_id', ORG_ID)
  Object.entries(params).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const str = p.toString()
  return str ? `?${str}` : ''
}

// Projects
export const projectsApi = {
  list: (filters?: { status?: string; client_id?: string }) =>
    request<{ projects: import('@/types').Project[]; count: number }>(
      `/api/projects${withOrg(filters)}`
    ),
  get: (id: string) =>
    request<{ project: import('@/types').Project }>(`/api/projects/${id}`),
  getMetrics: (id: string) =>
    request<{ metrics: import('@/types').ProjectMetrics }>(`/api/projects/${id}/metrics`),
  getTasks: (id: string, status?: string) =>
    request<{ tasks: import('@/types').Task[]; count: number }>(
      `/api/projects/${id}/tasks${status ? `?status=${status}` : ''}`
    ),
  getTimeEntries: (id: string) =>
    request<{ time_entries: import('@/types').TimeEntry[]; count: number; totals: Record<string, string> }>(
      `/api/projects/${id}/time-entries`
    ),
  getRiskAnalysis: (id: string) =>
    request<{ project: Record<string, string>; metrics: import('@/types').ProjectMetrics; analysis: unknown; error: string | null }>(
      `/api/projects/${id}/risk-analysis`
    ),
  create: (data: Record<string, unknown>) =>
    request<{ project: import('@/types').Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ organization_id: ORG_ID, ...data }),
    }),
  update: (id: string, data: Record<string, unknown>) =>
    request<{ project: import('@/types').Project }>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ deleted: boolean; project: { id: string; name: string } }>(`/api/projects/${id}`, {
      method: 'DELETE',
    }),
}

// Tasks
export const tasksApi = {
  list: (filters?: { project_id?: string; assignee_id?: string; status?: string }) =>
    request<{ tasks: import('@/types').Task[]; count: number }>(
      `/api/tasks${withOrg(filters)}`
    ),
  create: (data: Record<string, unknown>) =>
    request<{ task: import('@/types').Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ organization_id: ORG_ID, ...data }),
    }),
  update: (id: string, data: Record<string, unknown>) =>
    request<{ task: import('@/types').Task }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateStatus: (id: string, status: string) =>
    request<{ task: import('@/types').Task }>(`/api/tasks/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
}

// Alerts
export const alertsApi = {
  today: (filters?: { project_id?: string; assignee_id?: string }) =>
    request<{ date: string; tasks: import('@/types').Task[]; total: number }>(
      `/api/alerts/today${withOrg(filters)}`
    ),
  overdue: (filters?: { project_id?: string; assignee_id?: string }) =>
    request<{ tasks: import('@/types').Task[]; total: number }>(
      `/api/alerts/overdue${withOrg(filters)}`
    ),
  summary: (filters?: { project_id?: string }) =>
    request<import('@/types').AlertSummary>(
      `/api/alerts/summary${withOrg(filters)}`
    ),
}

// Reports
export const reportsApi = {
  list: (filters?: { project_id?: string; type?: string }) =>
    request<{ reports: import('@/types').Report[]; count: number }>(
      `/api/reports${withOrg(filters)}`
    ),
  get: (id: string) =>
    request<{ report: import('@/types').Report }>(`/api/reports/${id}`),
  generate: (data: { project_id: string; type: string; period_start?: string; period_end?: string }) =>
    request<{ report: import('@/types').Report; content: string }>('/api/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ organization_id: ORG_ID, ...data }),
    }),
}

// Invites
export const invitesApi = {
  list: (status?: string) =>
    request<{ invites: Invite[]; count: number }>(`/api/invites${withOrg({ status })}`),
  create: (data: { name: string; email: string; role: string; whatsapp?: string }) =>
    request<{ invite: Invite; email_sent: boolean; invite_link: string }>('/api/invites', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  resend: (id: string) =>
    request<{ invite: Invite; email_sent: boolean; invite_link: string }>(`/api/invites/${id}/resend`, { method: 'POST' }),
  cancel: (id: string) =>
    request<{ success: boolean }>(`/api/invites/${id}`, { method: 'DELETE' }),
  verify: (token: string) =>
    request<{ valid: boolean; invite?: { name: string; email: string; role: string }; reason?: string }>(
      `/api/invites/verify/${token}`
    ),
  accept: (token: string, password: string) =>
    request<{ user: unknown }>('/api/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
}

// Users
export const usersApi = {
  list: () =>
    request<{ users: User[]; count: number }>(`/api/auth/users${withOrg()}`),
  update: (userId: string, data: Record<string, unknown>) =>
    request<{ user: User }>(`/api/auth/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}

interface Invite {
  id: string
  email: string
  name: string
  role: string
  status: 'pending' | 'accepted' | 'cancelled'
  invited_by_name?: string
  expires_at: string
  created_at: string
  accepted_at?: string
  invite_link?: string
}

interface User {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

// Allocations
export const allocationsApi = {
  dashboard: () =>
    request<AllocationDashboard>('/api/allocations/dashboard'),
  byProject: (projectId: string) =>
    request<{ allocations: Allocation[]; total_hours_per_week: number }>(`/api/allocations/project/${projectId}`),
  create: (data: { user_id: string; project_id: string; hours_per_week: number; role?: string }) =>
    request<{ allocation: Allocation }>('/api/allocations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (projectId: string, userId: string, data: { hours_per_week?: number; role?: string }) =>
    request<{ allocation: Allocation }>(`/api/allocations/${projectId}/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  remove: (projectId: string, userId: string) =>
    request<{ success: boolean }>(`/api/allocations/${projectId}/${userId}`, { method: 'DELETE' }),
  updateCapacity: (userId: string, weekly_capacity: number) =>
    request<{ user: { id: string; name: string; weekly_capacity: number } }>(`/api/allocations/capacity/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ weekly_capacity }),
    }),
}

interface Allocation {
  id: string
  project_id: string
  user_id: string
  hours_per_week: number
  role: string
  start_date: string | null
  end_date: string | null
  user_name?: string
  project_name?: string
}

interface ConsultantAllocation {
  id: string
  name: string
  email: string
  role: string
  weekly_capacity: number
  allocated_hours: number
  available_hours: number
  utilization_percent: number
  projects: { project_id: string; project_name: string; hours_per_week: number; role: string }[]
}

interface AllocationDashboard {
  consultants: ConsultantAllocation[]
  summary: {
    total_consultants: number
    total_capacity: number
    total_allocated: number
    total_available: number
    avg_utilization: number
    overallocated_count: number
    underutilized_count: number
  }
}

// Capacity Calendar
export const capacityApi = {
  timeline: (startDate: string, endDate: string) =>
    request<import('@/types').TimelineData>(
      `/api/capacity/timeline${withOrg({ start_date: startDate, end_date: endDate })}`
    ),
  consultant: (userId: string, month: string) =>
    request<import('@/types').ConsultantCalendarData>(
      `/api/capacity/consultant/${userId}?month=${month}`
    ),
  summary: (monthsAhead?: number) =>
    request<import('@/types').CapacitySummaryData>(
      `/api/capacity/summary${withOrg({ months_ahead: String(monthsAhead || 3) })}`
    ),
  blocks: {
    list: (params?: { user_id?: string; start_date?: string; end_date?: string }) =>
      request<{ blocks: import('@/types').ConsultantBlock[] }>(
        `/api/capacity/blocks${withOrg(params)}`
      ),
    create: (data: { user_id: string; start_date: string; end_date: string; reason?: string; block_type?: string }) =>
      request<{ block: import('@/types').ConsultantBlock }>('/api/capacity/blocks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ block: import('@/types').ConsultantBlock }>(`/api/capacity/blocks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    remove: (id: string) =>
      request<{ deleted: boolean }>(`/api/capacity/blocks/${id}`, { method: 'DELETE' }),
  },
}

// CRM
export const crmApi = {
  // Pipelines (multi-funnel)
  pipelines: {
    list: () =>
      request<{ pipelines: import('@/types').Pipeline[] }>(`/api/crm/pipelines${withOrg()}`),
    create: (data: Record<string, unknown>) =>
      request<{ pipeline: import('@/types').Pipeline }>('/api/crm/pipelines', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ pipeline: import('@/types').Pipeline }>(`/api/crm/pipelines/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/crm/pipelines/${id}`, { method: 'DELETE' }),
  },

  // Pipeline Stages
  pipeline: Object.assign(
    (pipelineId?: string) => request<{ stages: import('@/types').PipelineStage[] }>(
      `/api/crm/pipeline${withOrg(pipelineId ? { pipeline_id: pipelineId } : {})}`
    ),
    {
      create: (data: Record<string, unknown>) =>
        request<{ stage: import('@/types').PipelineStage }>('/api/crm/pipeline', {
          method: 'POST',
          body: JSON.stringify({ organization_id: ORG_ID, ...data }),
        }),
      update: (id: string, data: Record<string, unknown>) =>
        request<{ stage: import('@/types').PipelineStage }>(`/api/crm/pipeline/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        request<{ deleted: boolean }>(`/api/crm/pipeline/${id}`, { method: 'DELETE' }),
      reorder: (stages: { id: string; position: number }[]) =>
        request<{ stages: import('@/types').PipelineStage[] }>('/api/crm/pipeline/reorder', {
          method: 'POST',
          body: JSON.stringify({ stages, organization_id: ORG_ID }),
        }),
    }
  ),

  // Companies
  companies: {
    list: (filters?: { search?: string; segment?: string; limit?: string }) =>
      request<{ companies: import('@/types').Company[]; count: number }>(
        `/api/crm/companies${withOrg(filters)}`
      ),
    get: (id: string) =>
      request<{ company: import('@/types').Company; contacts: import('@/types').Contact[]; deals: import('@/types').Deal[] }>(
        `/api/crm/companies/${id}`
      ),
    search: (q: string) =>
      request<{ companies: Pick<import('@/types').Company, 'id' | 'name' | 'cnpj' | 'segment' | 'city' | 'state'>[] }>(
        `/api/crm/companies/search${withOrg({ q })}`
      ),
    create: (data: Record<string, unknown>) =>
      request<{ company: import('@/types').Company }>('/api/crm/companies', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ company: import('@/types').Company }>(`/api/crm/companies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/crm/companies/${id}`, { method: 'DELETE' }),
  },

  // Contacts (standalone)
  contacts: {
    list: (filters?: { search?: string; company_id?: string; limit?: string }) =>
      request<{ contacts: import('@/types').Contact[]; count: number }>(
        `/api/crm/contacts${withOrg(filters)}`
      ),
    get: (id: string) =>
      request<{ contact: import('@/types').Contact; deals: import('@/types').Deal[] }>(
        `/api/crm/contacts/${id}`
      ),
    search: (q: string) =>
      request<{ contacts: Pick<import('@/types').Contact, 'id' | 'name' | 'phone' | 'email' | 'company_id' | 'company_name'>[] }>(
        `/api/crm/contacts/search${withOrg({ q })}`
      ),
    byPhone: (phone: string) =>
      request<{ contact: import('@/types').Contact | null; exists: boolean }>(
        `/api/crm/contacts/by-phone/${phone}${withOrg()}`
      ),
    create: (data: Record<string, unknown>) =>
      request<{ contact: import('@/types').Contact }>('/api/crm/contacts', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ contact: import('@/types').Contact }>(`/api/crm/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/crm/contacts/${id}`, { method: 'DELETE' }),
  },

  // Deals
  deals: {
    list: (filters?: { status?: string; pipeline_stage_id?: string; pipeline_id?: string; owner_id?: string; search?: string }) =>
      request<{ deals: import('@/types').Deal[]; count: number }>(
        `/api/crm/deals${withOrg(filters)}`
      ),
    get: (id: string) =>
      request<{ deal: import('@/types').Deal; insights: import('@/types').DealInsight[]; activities: import('@/types').DealActivity[]; products: import('@/types').DealProduct[] }>(
        `/api/crm/deals/${id}`
      ),
    byPhone: (phone: string) =>
      request<{ deal: import('@/types').Deal | null; exists: boolean }>(
        `/api/crm/deals/by-phone/${phone}${withOrg()}`
      ),
    create: (data: Record<string, unknown>) =>
      request<{ deal: import('@/types').Deal }>('/api/crm/deals', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ deal: import('@/types').Deal }>(`/api/crm/deals/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    moveStage: (id: string, pipeline_stage_id: string) =>
      request<{ deal: import('@/types').Deal }>(`/api/crm/deals/${id}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ pipeline_stage_id }),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/crm/deals/${id}`, { method: 'DELETE' }),
    addInsight: (id: string, data: { category: string; content: string; source?: string }) =>
      request<{ insight: import('@/types').DealInsight }>(`/api/crm/deals/${id}/insights`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    addActivity: (id: string, data: { type: string; description?: string }) =>
      request<{ activity: import('@/types').DealActivity }>(`/api/crm/deals/${id}/activities`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    contacts: {
      list: (dealId: string) =>
        request<{ contacts: import('@/types').DealContact[] }>(`/api/crm/deals/${dealId}/contacts`),
      create: (dealId: string, data: Record<string, unknown>) =>
        request<{ contact: import('@/types').DealContact }>(`/api/crm/deals/${dealId}/contacts`, {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (dealId: string, contactId: string, data: Record<string, unknown>) =>
        request<{ contact: import('@/types').DealContact }>(`/api/crm/deals/${dealId}/contacts/${contactId}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        }),
      delete: (dealId: string, contactId: string) =>
        request<{ deleted: boolean }>(`/api/crm/deals/${dealId}/contacts/${contactId}`, { method: 'DELETE' }),
    },
  },

  // Register Lead (N8N transactional)
  registerLead: (data: Record<string, unknown>) =>
    request<{ deal: import('@/types').Deal; contact: import('@/types').Contact | null; company: import('@/types').Company | null }>(
      '/api/crm/register-lead', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }
    ),

  // Automations
  automations: {
    list: () =>
      request<{ automations: import('@/types').DealAutomation[] }>(`/api/crm/automations${withOrg()}`),
    create: (data: Record<string, unknown>) =>
      request<{ automation: import('@/types').DealAutomation }>('/api/crm/automations', {
        method: 'POST',
        body: JSON.stringify({ organization_id: ORG_ID, ...data }),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ automation: import('@/types').DealAutomation }>(`/api/crm/automations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<{ deleted: boolean }>(`/api/crm/automations/${id}`, { method: 'DELETE' }),
    log: (id: string) =>
      request<{ logs: import('@/types').DealAutomationLog[] }>(`/api/crm/automations/${id}/logs`),
  },

  // Stats (supports pipeline_id filter)
  stats: (pipelineId?: string) =>
    request<import('@/types').CrmStats>(
      `/api/crm/stats${withOrg(pipelineId ? { pipeline_id: pipelineId } : {})}`
    ),

  // Rica AI stats
  rica: {
    stats: () =>
      request<import('@/types').RicaStats>(`/api/crm/rica/stats${withOrg()}`),
  },
}

// Transcriptions / Atas
export const atasApi = {
  list: (filters?: { project_id?: string }) =>
    request<{ atas: import('@/types').Ata[]; count: number }>(
      `/api/transcriptions/atas/list${withOrg(filters)}`
    ),
  get: (id: string) =>
    request<{
      ata: import('@/types').Ata
      acoes: import('@/types').AtaAcao[]
      decisoes: import('@/types').AtaDecisao[]
      riscos: import('@/types').AtaRisco[]
    }>(`/api/transcriptions/atas/${id}`),
  updateAta: (id: string, data: Record<string, unknown>) =>
    request<{ ata: import('@/types').Ata }>(`/api/transcriptions/atas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateAcao: (ataId: string, acaoId: string, data: Record<string, unknown>) =>
    request<{ acao: import('@/types').AtaAcao }>(`/api/transcriptions/atas/${ataId}/acoes/${acaoId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateDecisao: (ataId: string, decisaoId: string, data: Record<string, unknown>) =>
    request<{ decisao: import('@/types').AtaDecisao }>(`/api/transcriptions/atas/${ataId}/decisoes/${decisaoId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  updateRisco: (ataId: string, riscoId: string, data: Record<string, unknown>) =>
    request<{ risco: import('@/types').AtaRisco }>(`/api/transcriptions/atas/${ataId}/riscos/${riscoId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
}
