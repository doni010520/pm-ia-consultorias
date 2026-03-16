const API_URL = import.meta.env.VITE_API_URL || ''
const ORG_ID = import.meta.env.VITE_DEFAULT_ORG_ID || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  })

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
