-- ============================================
-- MIGRATION 021: Funil por campanha da Rica (Mentoria, Jornada Online, GPS)
-- ============================================
-- Base comum das campanhas comerciais da Rica (força-tarefa de conversão, set/2026):
--   rica_lead_funil     → 1 linha por lead+campanha: etapa, dor, objetivo, reunião...
--   rica_funil_eventos  → linha do tempo (cada mudança de etapa/evento com horário)
--   rica_pendencias     → suporte da Jornada (acesso/reembolso) acompanhado até resolver
--   rica_resgate        → campanha de resgate de leads antigos (3 contatos)
-- Tudo aditivo: nenhuma tabela existente é alterada.
-- ============================================

CREATE TABLE IF NOT EXISTS rica_lead_funil (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,                  -- dígitos com DDI 55
    campanha VARCHAR(20) NOT NULL,               -- mentoria | jdl | gps | outro
    deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
    etapa VARCHAR(40) NOT NULL DEFAULT 'novo',
    nome VARCHAR(255),
    padaria VARCHAR(255),
    origem VARCHAR(255),
    interesse_do_anuncio TEXT,
    dor_principal TEXT,
    impacto TEXT,
    objetivo_declarado TEXT,
    pilar_aderente VARCHAR(40),
    decisor VARCHAR(40),
    tamanho_operacao VARCHAR(80),
    temperatura VARCHAR(10),                     -- quente | morna | fria
    pergunta_de_compra TEXT,
    objecao TEXT,
    consentimento_handoff BOOLEAN,
    meeting_status VARCHAR(20),                  -- agendada | sem_horario | recusou | pediu_outra_data
    meeting_start_at TIMESTAMPTZ,
    meeting_duration_minutes INT,
    calendar_event_id VARCHAR(255),
    scheduling_offered_slots JSONB,
    link_enviado_at TIMESTAMPTZ,
    compra_confirmada_at TIMESTAMPTZ,
    nao_contatar BOOLEAN NOT NULL DEFAULT false,
    followup_step_reached INT NOT NULL DEFAULT 0,
    message_count_rica INT NOT NULL DEFAULT 0,
    first_rica_message_at TIMESTAMPTZ,
    first_lead_reply_at TIMESTAMPTZ,
    qualified_at TIMESTAMPTZ,
    handoff_at TIMESTAMPTZ,
    scheduling_invite_at TIMESTAMPTZ,
    scheduling_options_shown_at TIMESTAMPTZ,
    meeting_booked_at TIMESTAMPTZ,
    name_captured_at TIMESTAMPTZ,
    bakery_captured_at TIMESTAMPTZ,
    last_interaction_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, phone, campanha)
);

CREATE INDEX IF NOT EXISTS idx_rica_lead_funil_phone ON rica_lead_funil(organization_id, phone);
CREATE INDEX IF NOT EXISTS idx_rica_lead_funil_campanha ON rica_lead_funil(organization_id, campanha, etapa);
CREATE INDEX IF NOT EXISTS idx_rica_lead_funil_created ON rica_lead_funil(organization_id, created_at);

CREATE TABLE IF NOT EXISTS rica_funil_eventos (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    campanha VARCHAR(20) NOT NULL,
    evento VARCHAR(60) NOT NULL,
    dados JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rica_funil_eventos ON rica_funil_eventos(organization_id, campanha, evento, created_at);

CREATE TABLE IF NOT EXISTS rica_pendencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    codigo SERIAL,                               -- número curto para "resolvido 12"
    phone VARCHAR(20) NOT NULL,
    tipo VARCHAR(20) NOT NULL,                   -- acesso | reembolso
    nome VARCHAR(255),
    email_compra VARCHAR(255),
    descricao TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'aberta',-- aberta | resolvida
    lembretes INT NOT NULL DEFAULT 0,
    ultimo_lembrete_at TIMESTAMPTZ,
    resolvida_por VARCHAR(40),
    resolvida_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rica_pendencias_status ON rica_pendencias(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS rica_resgate (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    campanha VARCHAR(20) NOT NULL DEFAULT 'jdl',
    nome VARCHAR(255),
    passo INT NOT NULL DEFAULT 0,                -- último contato enviado (0 = selecionado, ainda não enviado)
    ultimo_envio_at TIMESTAMPTZ,
    respondeu_at TIMESTAMPTZ,
    encerrado BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (organization_id, phone, campanha)
);

CREATE INDEX IF NOT EXISTS idx_rica_resgate_ativo ON rica_resgate(organization_id, encerrado, ultimo_envio_at);

-- ============================================
-- FIM DA MIGRATION 021
-- ============================================
