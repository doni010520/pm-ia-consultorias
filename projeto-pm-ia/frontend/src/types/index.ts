export interface Project {
  id: string
  organization_id: string
  client_id: string | null
  name: string
  description: string | null
  status: 'active' | 'paused' | 'completed' | 'cancelled'
  priority: string | null
  start_date: string | null
  due_date: string | null
  completed_at: string | null
  budget_hours: number | null
  budget_value: number | null
  billing_type: 'hourly' | 'fixed' | 'retainer'
  progress_percent: number
  settings: Record<string, unknown> | null
  created_at: string
  updated_at: string
  client_name?: string
  client_email?: string
  total_tasks?: number
  completed_tasks?: number
}

export interface ProjectMetrics {
  total_tasks: number
  completed_tasks: number
  overdue_tasks: number
  in_progress_tasks: number
  total_hours: number
  billable_hours: number
  budget_hours: number | null
  burn_rate: number
  overdue_ratio: number
  completion_rate: number
  days_to_deadline: number | null
  risk_score: number
}

export interface Task {
  id: string
  project_id: string
  parent_task_id: string | null
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
  priority: number
  assignee_id: string | null
  due_date: string | null
  estimated_hours: number | null
  tags: string[]
  source: string
  ai_confidence: number | null
  position: number
  created_at: string
  updated_at: string
  completed_at: string | null
  assignee_name?: string
  project_name?: string
  client_name?: string
  days_overdue?: number
}

export interface Ata {
  id: string
  transcricao_chave: string
  project_id: string | null
  titulo: string
  data_reuniao: string | null
  participantes: string[]
  resumo_executivo: string | null
  conteudo_markdown: string
  created_at: string
  project_name?: string
  total_acoes?: number
  total_decisoes?: number
  total_riscos?: number
}

export interface AtaAcao {
  id: string
  ata_id: string
  descricao: string
  responsavel_nome: string | null
  responsavel_id: string | null
  prazo: string | null
  tipo: string
  evidencia_minima: string | null
  status: string
  created_at: string
}

export interface AtaDecisao {
  id: string
  ata_id: string
  descricao: string
  justificativa: string | null
  impacto: string | null
  created_at: string
}

export interface AtaRisco {
  id: string
  ata_id: string
  descricao: string
  probabilidade: string | null
  impacto: string | null
  mitigacao: string | null
  created_at: string
}

export interface Report {
  id: string
  organization_id: string
  project_id: string
  client_id: string | null
  type: 'weekly_status' | 'monthly_closing' | 'executive_summary'
  period_start: string
  period_end: string
  title: string
  content_markdown: string
  metrics: Record<string, unknown>
  created_at: string
  project_name?: string
  client_name?: string
}

export interface AlertSummary {
  date: string
  today: { tasks: Task[]; total: number }
  overdue: { tasks: Task[]; total: number }
  upcoming_7_days: { tasks: Task[]; total: number }
  risky_projects: { projects: RiskyProject[]; total: number }
}

export interface RiskyProject {
  name: string
  due_date: string | null
  overdue_tasks: number
  total_open_tasks: number
}

export interface User {
  id: string
  name: string
  email: string
  role: string
  hourly_rate: number | null
  is_active: boolean
}

export interface TimeEntry {
  id: string
  task_id: string | null
  project_id: string
  user_id: string
  date: string
  hours: number
  description: string | null
  is_billable: boolean
  hourly_rate: number | null
  status: string
  user_name?: string
  task_title?: string
}
