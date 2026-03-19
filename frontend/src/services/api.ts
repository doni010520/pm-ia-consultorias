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
}
