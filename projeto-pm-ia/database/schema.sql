-- ============================================
-- SCHEMA: Sistema de Gestão de Projetos com IA
-- Banco: PostgreSQL (Supabase)
-- ============================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- TABELAS PRINCIPAIS
-- ============================================

-- Organizações (multi-tenant)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    whatsapp_number VARCHAR(20),
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usuários/Membros da equipe
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    whatsapp VARCHAR(20),
    role VARCHAR(50) DEFAULT 'member', -- admin, manager, member
    hourly_rate DECIMAL(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    avatar_url TEXT,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, email),
    UNIQUE(organization_id, whatsapp)
);

-- Índice para busca por nome (fuzzy matching para IA)
CREATE INDEX idx_users_name_trgm ON users USING gin (name gin_trgm_ops);

-- Clientes
CREATE TABLE clients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_whatsapp VARCHAR(20),
    industry VARCHAR(100),
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projetos
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'active', -- active, paused, completed, cancelled
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    
    -- Datas
    start_date DATE,
    due_date DATE,
    completed_at TIMESTAMPTZ,
    
    -- Orçamento e financeiro
    budget_hours DECIMAL(10,2),
    budget_value DECIMAL(12,2),
    billing_type VARCHAR(50) DEFAULT 'hourly', -- hourly, fixed, retainer
    
    -- Progresso
    progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    
    -- Configurações
    settings JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para busca por nome de projeto
CREATE INDEX idx_projects_name_trgm ON projects USING gin (name gin_trgm_ops);

-- Membros do projeto (relação N:N)
CREATE TABLE project_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'member', -- lead, member
    hourly_rate_override DECIMAL(10,2), -- sobrescreve taxa do usuário se preenchido
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, user_id)
);

-- Tarefas
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE, -- subtarefas
    
    -- Conteúdo
    title VARCHAR(500) NOT NULL,
    description TEXT,
    
    -- Status e prioridade
    status VARCHAR(50) DEFAULT 'todo', -- todo, in_progress, review, done, cancelled
    priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent
    
    -- Responsável e datas
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Estimativas
    estimated_hours DECIMAL(10,2),
    
    -- Tags e metadados
    tags TEXT[] DEFAULT '{}',
    
    -- Origem (para rastreio de tarefas criadas via IA)
    source VARCHAR(50) DEFAULT 'manual', -- manual, whatsapp, email, api
    source_message_id VARCHAR(255), -- ID da mensagem original
    ai_confidence INTEGER, -- 0-100, confiança da extração
    
    -- Ordenação
    position INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para tarefas
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);

-- Registro de horas
CREATE TABLE time_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Tempo
    date DATE NOT NULL,
    hours DECIMAL(10,2) NOT NULL CHECK (hours > 0),
    
    -- Descrição
    description TEXT,
    
    -- Faturamento
    is_billable BOOLEAN DEFAULT true,
    hourly_rate DECIMAL(10,2), -- taxa no momento do registro
    
    -- Aprovação
    status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
    approved_by_id UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para time_entries
CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_date ON time_entries(date);

-- ============================================
-- TABELAS DE IA
-- ============================================

-- Log de interações com IA
CREATE TABLE ai_interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Tipo de interação
    type VARCHAR(50) NOT NULL, -- task_extraction, status_query, risk_analysis, report_generation
    
    -- Input/Output
    input_text TEXT,
    input_metadata JSONB,
    output_text TEXT,
    output_structured JSONB,
    
    -- Modelo usado
    model VARCHAR(100), -- gpt-4.1-mini, claude-sonnet, etc
    tokens_input INTEGER,
    tokens_output INTEGER,
    cost_usd DECIMAL(10,6),
    latency_ms INTEGER,
    
    -- Resultado
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    confidence INTEGER, -- 0-100
    
    -- Referências
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_interactions_type ON ai_interactions(type);
CREATE INDEX idx_ai_interactions_created ON ai_interactions(created_at);

-- Alertas de risco
CREATE TABLE risk_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    
    -- Severidade
    severity VARCHAR(20) NOT NULL, -- yellow, red
    
    -- Indicadores
    indicators JSONB NOT NULL, -- { burn_rate: 0.85, velocity: 0.6, overdue_tasks: 0.3 }
    
    -- Análise da IA
    summary TEXT,
    recommended_actions TEXT[],
    
    -- Status
    status VARCHAR(50) DEFAULT 'active', -- active, acknowledged, resolved
    acknowledged_by_id UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    
    -- Notificação
    notified_users UUID[], -- array de user_ids notificados
    notified_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_alerts_project ON risk_alerts(project_id);
CREATE INDEX idx_risk_alerts_status ON risk_alerts(status);

-- Relatórios gerados
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    
    -- Tipo
    type VARCHAR(50) NOT NULL, -- weekly_status, monthly_closing, executive_summary
    
    -- Período
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Conteúdo
    title VARCHAR(255),
    content_markdown TEXT,
    content_html TEXT,
    metrics JSONB, -- métricas do período
    
    -- Arquivo
    file_url TEXT,
    file_size INTEGER,
    
    -- Envio
    sent_to TEXT[], -- emails/whatsapp enviados
    sent_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reports_project ON reports(project_id);
CREATE INDEX idx_reports_type ON reports(type);

-- ============================================
-- TABELAS DE TRANSCRIÇÃO E ATAS (RICA)
-- ============================================

-- Transcrições pendentes (fila de processamento)
CREATE TABLE transcricoes_pendentes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

    chave VARCHAR(255) UNIQUE NOT NULL,

    cliente_nome VARCHAR(255),
    projeto_nome VARCHAR(255),
    consultor_nome VARCHAR(255),
    data_reuniao DATE,

    nome_arquivo VARCHAR(500) NOT NULL,
    conteudo_texto TEXT NOT NULL,

    -- aguardando_confirmacao → processando → processado | erro | cancelado
    status VARCHAR(50) DEFAULT 'aguardando_confirmacao',

    source VARCHAR(50) DEFAULT 'whatsapp',
    source_phone VARCHAR(20),

    projeto_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    ata_id UUID,

    error_message TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcricoes_status ON transcricoes_pendentes(status);
CREATE INDEX idx_transcricoes_chave ON transcricoes_pendentes(chave);
CREATE TRIGGER tr_transcricoes_updated_at BEFORE UPDATE ON transcricoes_pendentes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Atas de reunião
CREATE TABLE atas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    transcricao_id UUID REFERENCES transcricoes_pendentes(id) ON DELETE SET NULL,

    titulo VARCHAR(500) NOT NULL,
    data_reuniao DATE,
    participantes TEXT,
    resumo TEXT,
    conteudo_markdown TEXT,

    status_projeto VARCHAR(50),
    fase_projeto VARCHAR(100),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_atas_project ON atas(project_id);
CREATE INDEX idx_atas_data ON atas(data_reuniao);
CREATE TRIGGER tr_atas_updated_at BEFORE UPDATE ON atas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Adicionar FK de ata na transcricao (referência cruzada)
ALTER TABLE transcricoes_pendentes ADD CONSTRAINT fk_transcricoes_ata
    FOREIGN KEY (ata_id) REFERENCES atas(id) ON DELETE SET NULL;

-- Ações extraídas da ata
CREATE TABLE ata_acoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ata_id UUID NOT NULL REFERENCES atas(id) ON DELETE CASCADE,

    descricao TEXT NOT NULL,
    responsavel VARCHAR(255),
    responsavel_id UUID REFERENCES users(id) ON DELETE SET NULL,
    prazo DATE,
    tipo VARCHAR(50),
    evidencia_minima TEXT,
    status VARCHAR(50) DEFAULT 'pendente',

    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ata_acoes_ata ON ata_acoes(ata_id);
CREATE INDEX idx_ata_acoes_status ON ata_acoes(status);

-- Decisões registradas na ata
CREATE TABLE ata_decisoes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ata_id UUID NOT NULL REFERENCES atas(id) ON DELETE CASCADE,

    descricao TEXT NOT NULL,
    responsavel VARCHAR(255),
    impacto VARCHAR(20),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ata_decisoes_ata ON ata_decisoes(ata_id);

-- Riscos identificados na reunião
CREATE TABLE ata_riscos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ata_id UUID NOT NULL REFERENCES atas(id) ON DELETE CASCADE,

    descricao TEXT NOT NULL,
    probabilidade VARCHAR(20),
    impacto VARCHAR(20),
    mitigacao TEXT,
    responsavel VARCHAR(255),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ata_riscos_ata ON ata_riscos(ata_id);

-- ============================================
-- VIEWS ÚTEIS
-- ============================================

-- View: Status resumido de projetos
CREATE OR REPLACE VIEW v_project_status AS
SELECT 
    p.id,
    p.organization_id,
    p.name,
    p.status,
    p.priority,
    p.due_date,
    p.budget_hours,
    p.budget_value,
    p.progress_percent,
    c.name as client_name,
    
    -- Contadores de tarefas
    COUNT(t.id) FILTER (WHERE t.status != 'cancelled') as total_tasks,
    COUNT(t.id) FILTER (WHERE t.status = 'done') as completed_tasks,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW()) as overdue_tasks,
    
    -- Horas
    COALESCE(SUM(te.hours), 0) as total_hours,
    COALESCE(SUM(te.hours) FILTER (WHERE te.is_billable), 0) as billable_hours,
    
    -- Cálculos
    CASE 
        WHEN p.budget_hours > 0 THEN ROUND((COALESCE(SUM(te.hours), 0) / p.budget_hours * 100)::numeric, 1)
        ELSE 0 
    END as burn_rate_percent
    
FROM projects p
LEFT JOIN clients c ON p.client_id = c.id
LEFT JOIN tasks t ON t.project_id = p.id
LEFT JOIN time_entries te ON te.project_id = p.id
GROUP BY p.id, c.name;

-- View: Carga de trabalho por usuário
CREATE OR REPLACE VIEW v_user_workload AS
SELECT 
    u.id,
    u.organization_id,
    u.name,
    u.role,
    
    -- Tarefas ativas
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled')) as active_tasks,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW()) as overdue_tasks,
    COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days') as due_this_week,
    
    -- Horas (últimos 30 dias)
    COALESCE(SUM(te.hours) FILTER (WHERE te.date >= CURRENT_DATE - 30), 0) as hours_last_30_days,
    COALESCE(SUM(te.hours) FILTER (WHERE te.date >= CURRENT_DATE - 30 AND te.is_billable), 0) as billable_hours_last_30_days
    
FROM users u
LEFT JOIN tasks t ON t.assignee_id = u.id
LEFT JOIN time_entries te ON te.user_id = u.id
WHERE u.is_active = true
GROUP BY u.id;

-- ============================================
-- FUNÇÕES ÚTEIS
-- ============================================

-- Função: Buscar membro mais similar por nome (para IA)
CREATE OR REPLACE FUNCTION find_user_by_name(
    p_organization_id UUID,
    p_name TEXT
)
RETURNS TABLE(user_id UUID, user_name VARCHAR, similarity REAL) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id,
        u.name,
        similarity(lower(u.name), lower(p_name)) as sim
    FROM users u
    WHERE u.organization_id = p_organization_id
      AND u.is_active = true
      AND similarity(lower(u.name), lower(p_name)) > 0.3
    ORDER BY sim DESC
    LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- Função: Calcular métricas de risco de um projeto
CREATE OR REPLACE FUNCTION calculate_project_risk(p_project_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_burn_rate DECIMAL;
    v_overdue_ratio DECIMAL;
    v_days_to_deadline INTEGER;
    v_progress INTEGER;
    v_budget_hours DECIMAL;
    v_spent_hours DECIMAL;
    v_total_tasks INTEGER;
    v_overdue_tasks INTEGER;
    v_due_date DATE;
BEGIN
    -- Buscar dados do projeto
    SELECT 
        p.budget_hours,
        p.due_date,
        p.progress_percent,
        COALESCE(SUM(te.hours), 0),
        COUNT(t.id) FILTER (WHERE t.status != 'cancelled'),
        COUNT(t.id) FILTER (WHERE t.status NOT IN ('done', 'cancelled') AND t.due_date < NOW())
    INTO v_budget_hours, v_due_date, v_progress, v_spent_hours, v_total_tasks, v_overdue_tasks
    FROM projects p
    LEFT JOIN time_entries te ON te.project_id = p.id
    LEFT JOIN tasks t ON t.project_id = p.id
    WHERE p.id = p_project_id
    GROUP BY p.id;
    
    -- Calcular indicadores
    v_burn_rate := CASE WHEN v_budget_hours > 0 THEN v_spent_hours / v_budget_hours ELSE 0 END;
    v_overdue_ratio := CASE WHEN v_total_tasks > 0 THEN v_overdue_tasks::DECIMAL / v_total_tasks ELSE 0 END;
    v_days_to_deadline := CASE WHEN v_due_date IS NOT NULL THEN v_due_date - CURRENT_DATE ELSE NULL END;
    
    -- Montar resultado
    v_result := jsonb_build_object(
        'burn_rate', ROUND(v_burn_rate::numeric, 2),
        'overdue_ratio', ROUND(v_overdue_ratio::numeric, 2),
        'days_to_deadline', v_days_to_deadline,
        'progress_percent', v_progress,
        'total_tasks', v_total_tasks,
        'overdue_tasks', v_overdue_tasks,
        'spent_hours', ROUND(v_spent_hours::numeric, 1),
        'budget_hours', v_budget_hours,
        'risk_score', ROUND((
            COALESCE(v_burn_rate * 0.4, 0) + 
            COALESCE(v_overdue_ratio * 0.4, 0) + 
            CASE WHEN v_days_to_deadline IS NOT NULL AND v_days_to_deadline < 7 THEN 0.2 ELSE 0 END
        )::numeric, 2)
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Trigger: Atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_time_entries_updated_at BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: Atualizar progresso do projeto quando tarefa é concluída
CREATE OR REPLACE FUNCTION update_project_progress()
RETURNS TRIGGER AS $$
DECLARE
    v_total INTEGER;
    v_done INTEGER;
    v_progress INTEGER;
BEGIN
    -- Só atualiza se mudou o status
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.project_id IS NOT NULL THEN
        SELECT 
            COUNT(*) FILTER (WHERE status != 'cancelled'),
            COUNT(*) FILTER (WHERE status = 'done')
        INTO v_total, v_done
        FROM tasks
        WHERE project_id = NEW.project_id;
        
        v_progress := CASE WHEN v_total > 0 THEN ROUND((v_done::DECIMAL / v_total) * 100) ELSE 0 END;
        
        UPDATE projects SET progress_percent = v_progress WHERE id = NEW.project_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_task_update_project_progress 
AFTER INSERT OR UPDATE ON tasks 
FOR EACH ROW EXECUTE FUNCTION update_project_progress();

-- ============================================
-- DADOS DE EXEMPLO
-- ============================================

-- Inserir organização de teste
INSERT INTO organizations (id, name, slug, whatsapp_number) VALUES 
('00000000-0000-0000-0000-000000000001', 'Consultoria Demo', 'demo', '+5511999999999');

-- Inserir usuários de teste
INSERT INTO users (organization_id, name, email, whatsapp, role, hourly_rate) VALUES 
('00000000-0000-0000-0000-000000000001', 'João Silva', 'joao@demo.com', '+5511988888888', 'admin', 150.00),
('00000000-0000-0000-0000-000000000001', 'Maria Santos', 'maria@demo.com', '+5511977777777', 'manager', 120.00),
('00000000-0000-0000-0000-000000000001', 'Pedro Costa', 'pedro@demo.com', '+5511966666666', 'member', 80.00);

-- Inserir cliente de teste
INSERT INTO clients (organization_id, name, contact_name, contact_email, industry) VALUES 
('00000000-0000-0000-0000-000000000001', 'Empresa ABC', 'Carlos Diretor', 'carlos@abc.com', 'Tecnologia');

-- Inserir projeto de teste
INSERT INTO projects (organization_id, client_id, name, description, budget_hours, due_date) 
SELECT 
    '00000000-0000-0000-0000-000000000001',
    c.id,
    'Transformação Digital ABC',
    'Projeto de consultoria para transformação digital da Empresa ABC',
    200,
    CURRENT_DATE + 60
FROM clients c WHERE c.name = 'Empresa ABC';

-- ============================================
-- POLÍTICAS RLS (Row Level Security) - OPCIONAL
-- ============================================

-- Habilitar RLS (descomentar para usar com Supabase Auth)
-- ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- Comentário final
COMMENT ON TABLE tasks IS 'Tarefas do sistema. Campo source indica origem (manual, whatsapp, etc). ai_confidence indica confiança da extração por IA.';
COMMENT ON TABLE ai_interactions IS 'Log de todas interações com modelos de IA para auditoria e otimização.';
COMMENT ON TABLE risk_alerts IS 'Alertas de risco gerados automaticamente pelo sistema de monitoramento.';
