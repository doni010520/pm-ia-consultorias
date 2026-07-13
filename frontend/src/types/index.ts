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
  project_id: string | null
  deal_id: string | null
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

// ============================================
// Capacity Calendar Types
// ============================================

export interface ConsultantBlock {
  id: string
  organization_id: string
  user_id: string
  user_name?: string
  start_date: string
  end_date: string
  reason: string | null
  block_type: 'vacation' | 'leave' | 'holiday' | 'training' | 'other'
  created_at: string
}

export interface DayAllocation {
  project_id: string
  project_name: string
  color: string
  daily_hours: number
}

export interface DayTask {
  task_id: string
  title: string
  estimated_hours: number
  project_id: string
  project_name: string
}

export interface DayCapacity {
  date: string
  is_weekend: boolean
  is_blocked: boolean
  block_reason: string | null
  block_type?: string
  daily_capacity: number
  allocations: DayAllocation[]
  tasks: DayTask[]
  total_allocated: number
  available: number
}

export interface WeekSummary {
  week_start: string
  capacity: number
  allocated: number
  available: number
  days: number
}

export interface AllocationSegment {
  project_id: string
  project_name: string
  color: string
  hours_per_week: number
  start_date: string | null
  end_date: string | null
}

export interface BlockSegment {
  id: string
  start_date: string
  end_date: string
  reason: string | null
  block_type: string
}

export interface TimelineConsultant {
  id: string
  name: string
  email: string
  weekly_capacity: number
  allocation_segments: AllocationSegment[]
  block_segments: BlockSegment[]
  weeks: WeekSummary[]
  total_capacity: number
  total_allocated: number
  utilization_pct: number
}

export interface TimelineData {
  consultants: TimelineConsultant[]
  start_date: string
  end_date: string
}

export interface ConsultantCalendarData {
  consultant: { id: string; name: string; email: string; weekly_capacity: number }
  days: DayCapacity[]
  start_date: string
  end_date: string
}

export interface MonthUtilization {
  month: string
  capacity: number
  allocated: number
  available: number
  utilization_pct: number
  blocked_days: number
}

export interface ConsultantUtilization {
  id: string
  name: string
  months: MonthUtilization[]
}

export interface TeamWeekFreeHours {
  week_start: string
  total_capacity: number
  total_allocated: number
  free: number
}

export interface OverallocationAlert {
  user_id: string
  user_name: string
  month: string
  utilization_pct: number
  allocated: number
  capacity: number
}

export interface CapacitySummaryData {
  consultants_utilization: ConsultantUtilization[]
  team_free_hours_weekly: TeamWeekFreeHours[]
  overallocation_alerts: OverallocationAlert[]
}

// ============================================
// CRM Types
// ============================================

export interface Pipeline {
  id: string
  organization_id: string
  name: string
  description: string | null
  position: number
  is_active: boolean
  open_deals?: string
  pipeline_value?: string
  created_at: string
  updated_at: string
}

export interface PipelineStage {
  id: string
  organization_id: string
  pipeline_id: string | null
  name: string
  position: number
  color: string
  is_won: boolean
  is_lost: boolean
  max_days: number | null
  description: string | null
}

export interface Company {
  id: string
  organization_id: string
  name: string
  cnpj: string | null
  segment: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  website: string | null
  notes: string | null
  contacts_count?: string
  deals_count?: string
  pipeline_value?: string
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  organization_id: string
  company_id: string | null
  company_name?: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  notes: string | null
  deals_count?: string
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  organization_id: string
  pipeline_stage_id: string | null
  pipeline_id: string | null
  company_id: string | null
  contact_id: string | null
  title: string
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  company_name: string | null
  linked_company_name?: string
  linked_contact_name?: string
  linked_contact_phone?: string
  pipeline_name?: string
  owner_id: string | null
  owner_name?: string
  value: number | null
  probability: number
  expected_close_date: string | null
  won_date: string | null
  lost_date: string | null
  lost_reason: string | null
  status: 'open' | 'won' | 'lost'
  source: string | null
  temperature: 'hot' | 'warm' | 'cold'
  tags: string[]
  custom_fields: Record<string, unknown>
  stage_name?: string
  stage_color?: string
  stage_position?: number
  stage_entered_at: string | null
  last_activity_at: string | null
  next_follow_up: string | null
  score: number | null
  days_in_stage: number | null
  is_rotting: boolean
  insights?: DealInsight[]
  recent_activities?: DealActivity[]
  created_at: string
  updated_at: string
}

export interface DealInsight {
  id: string
  deal_id: string
  category: string
  content: string
  confidence: number | null
  source: string
  raw_message: string | null
  created_at: string
}

export interface DealActivity {
  id: string
  deal_id: string
  user_id: string | null
  user_name?: string
  type: string
  description: string | null
  metadata: Record<string, unknown>
  scheduled_at: string | null
  completed_at: string | null
  outcome: string | null
  transcription: string | null
  direction: string | null
  duration_minutes: number | null
  created_at: string
}

export interface DealMessage {
  id: string
  deal_id: string
  organization_id: string
  role: 'client' | 'rica' | 'agent' | 'system'
  channel: string
  content: string
  media_url: string | null
  media_type: string | null
  external_message_id: string | null
  rica_session_id: string | null
  metadata: Record<string, unknown>
  occurred_at: string
  created_at: string
}

export interface LeadJourneyEvent {
  id: string
  deal_id: string
  organization_id: string
  event_type: string
  from_value: Record<string, unknown> | null
  to_value: Record<string, unknown> | null
  actor_user_id: string | null
  actor_name?: string
  actor_type: 'user' | 'rica' | 'automation' | 'system'
  idempotency_key: string | null
  metadata: Record<string, unknown>
  occurred_at: string
  created_at: string
}

export interface DealAuditEntry {
  id: string
  deal_id: string
  organization_id: string
  user_id: string | null
  actor_name?: string
  actor_type: 'user' | 'rica' | 'automation' | 'system'
  action: string
  field: string | null
  old_value: unknown
  new_value: unknown
  metadata: Record<string, unknown>
  created_at: string
}

export interface JourneyFunnelRow {
  event_type: string
  deals_reached: number
  avg_hours_from_creation: number | null
}

export interface JourneySourceRow {
  channel: string
  utm_source: string
  utm_medium: string | null
  utm_campaign: string | null
  leads: number
  won: number
  lost: number
  won_value: number
}

export interface JourneyDistribution {
  total_leads: number
  distributed: number
  undistributed: number
  by_executive: {
    executive: string
    leads: number
    won: number
    lost: number
    open: number
  }[]
  undistributed_by_pipeline: {
    pipeline: string
    leads: number
  }[]
}

export interface ManagerOverview {
  health: {
    total_open: number
    stopped_7d: number
    stopped_30d: number
    stopped_60d: number
  }
  accountability: {
    executive: string
    total_leads: number
    stale_7d: number
    stale_30d: number
    last_activity: string
  }[]
  friction: {
    stage: string
    pipeline: string
    lost: number
    total: number
    loss_rate: number
  }[]
  discipline: {
    total: number
    open_total: number
    no_owner: number
    open_no_owner: number
    no_value: number
    won_no_value: number
  }
}

export interface DealProduct {
  id: string
  deal_id: string
  description: string
  quantity: number
  unit_price: number | null
  total: number | null
  notes: string | null
}

export interface DealContact {
  id: string
  deal_id: string
  name: string
  email: string | null
  phone: string | null
  role: string | null
  is_primary: boolean
  created_at: string
}

export interface DealAutomation {
  id: string
  organization_id: string
  name: string
  is_active: boolean
  trigger_type: string
  trigger_config: Record<string, unknown>
  action_type: string
  action_config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface DealAutomationLog {
  id: string
  automation_id: string
  deal_id: string
  deal_title?: string
  trigger_type: string
  action_type: string
  status: 'success' | 'error'
  error_message: string | null
  created_at: string
}

export interface CrmStats {
  stats: {
    open_deals: string
    won_deals: string
    lost_deals: string
    pipeline_value: string
    won_value: string
    won_last_30d: string
    new_last_7d: string
    avg_days_to_close?: number
    conversion_rate?: number
    rotting_deals?: number
  }
  stages_summary: Array<{
    id: string
    name: string
    color: string
    position: number
    deal_count: string
    total_value: string
    avg_days_in_stage?: number
  }>
  recent_activities: DealActivity[]
}

// Rica AI KPIs
export interface RicaStats {
  qualified_leads: {
    today: number
    week: number
    month: number
    total: number
  }
  by_executive: Array<{
    user_id: string
    name: string
    count: number
  }>
  by_product: Array<{
    product: string
    count: number
  }>
  pending_followups: {
    count: number
    deals: Array<{
      id: string
      contact_name: string | null
      contact_phone: string | null
      title: string | null
      executive_name: string | null
      assigned_at: string
      assigned_via: string | null
    }>
  }
  action_rate: {
    total_assigned: number
    exec_acted: number
    rate: number
  }
  recent_leads: Array<{
    id: string
    contact_name: string | null
    contact_phone: string | null
    title: string | null
    status: string
    executive_name: string | null
    product: string | null
    assigned_at: string
    assigned_via: string | null
  }>
}

export interface AgendaActivity {
  id: string
  deal_id: string
  type: string
  description: string | null
  scheduled_at: string
  duration_minutes: number | null
  outcome: string | null
  google_event_id: string | null
  user_id: string | null
  user_name: string | null
  deal_title: string | null
  contact_name: string | null
  contact_phone: string | null
  company_name: string | null
  owner_id: string | null
  owner_name: string | null
  deal_status: string | null
}

export interface DealFile {
  id: string
  deal_id: string
  organization_id: string
  uploaded_by: string | null
  uploaded_by_name?: string
  file_name: string
  file_size: number | null
  mime_type: string | null
  storage_path: string
  category: 'proposal' | 'contract' | 'presentation' | 'nda' | 'report' | 'other'
  description: string | null
  created_at: string
}

export interface ProposalTemplate {
  id: string
  organization_id: string
  created_by: string | null
  created_by_name?: string
  name: string
  description: string | null
  body_markdown: string
  variables: Array<{ key: string; label: string; default?: string }>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DealProposal {
  id: string
  deal_id: string
  organization_id: string
  template_id: string | null
  template_name?: string
  created_by: string | null
  created_by_name?: string
  title: string
  variable_values: Record<string, string>
  rendered_markdown: string | null
  file_id: string | null
  file_name?: string | null
  storage_path?: string | null
  status: 'draft' | 'generating' | 'ready' | 'sent'
  sent_at: string | null
  created_at: string
  updated_at: string
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
