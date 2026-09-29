-- ============================================
-- MIGRATION 022: GPS — link de agenda do André e acompanhamento pós-handoff
-- ============================================
-- "Manual de Programação RICA + GPS" (set/2026):
--   * a Rica envia um LINK de agenda (D0 e próximo dia útil); o lead escolhe o
--     horário e o evento entra sozinho na agenda Google do André;
--   * depois do agendamento a Rica sai da conversa: confirmação, no-show,
--     remarcação e resultado ficam com o André, que informa pelo WhatsApp;
--   * dados/tags e indicadores do funil (seções 18 e 19 do manual).
-- Tudo aditivo: só colunas novas e uma tabela nova.
-- ============================================

ALTER TABLE rica_lead_funil
    ADD COLUMN IF NOT EXISTS papel VARCHAR(40),              -- dono | gestor | profissional | iniciante
    ADD COLUMN IF NOT EXISTS categoria_dor VARCHAR(30),      -- Equipe | Gestão | Vendas | Lucratividade | Processos | Desenvolvimento | Outro
    ADD COLUMN IF NOT EXISTS cidade VARCHAR(120),
    ADD COLUMN IF NOT EXISTS classe VARCHAR(1),              -- A | B | C (seção 17)
    ADD COLUMN IF NOT EXISTS email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS primeira_resposta TEXT,         -- 1ª resposta do lead (seção 18)
    ADD COLUMN IF NOT EXISTS link_agenda_enviado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmado_andre_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reuniao_realizada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS remarcado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resultado VARCHAR(20),          -- vendido | nao_vendido
    ADD COLUMN IF NOT EXISTS resultado_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS motivo_perda TEXT;

-- Link de agendamento enviado ao lead (pela Rica ou pelo André, na remarcação).
CREATE TABLE IF NOT EXISTS rica_agenda_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL UNIQUE,
    phone VARCHAR(20) NOT NULL,
    campanha VARCHAR(20) NOT NULL DEFAULT 'gps',
    executivo_email VARCHAR(255) NOT NULL,
    deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
    criado_por VARCHAR(20) NOT NULL DEFAULT 'rica',     -- rica | andre (remarcação)
    status VARCHAR(20) NOT NULL DEFAULT 'enviado',      -- enviado | agendado
    inicio TIMESTAMPTZ,
    duracao_min INT NOT NULL DEFAULT 30,
    event_id VARCHAR(255),
    lead_email VARCHAR(255),
    agendado_at TIMESTAMPTZ,
    processado_at TIMESTAMPTZ,                          -- rica-bot já avisou o André
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rica_agenda_links_phone ON rica_agenda_links(organization_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rica_agenda_links_pendente ON rica_agenda_links(status, processado_at);

-- ============================================
-- FIM DA MIGRATION 022
-- ============================================
