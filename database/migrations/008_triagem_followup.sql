-- ============================================
-- MIGRATION 008: Funil Triagem + Colunas de Follow-up
-- ============================================
-- Adiciona:
--   1. Pipeline "Triagem" (catch-all para todos os leads que chegam)
--   2. Colunas em deals para controle de follow-up
-- ============================================

-- 1. Colunas de follow-up na tabela deals
ALTER TABLE deals
    ADD COLUMN IF NOT EXISTS followup_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_followup_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS last_client_message_at TIMESTAMP;

-- Index para query de candidatos a follow-up
CREATE INDEX IF NOT EXISTS idx_deals_followup
    ON deals (organization_id, status, followup_count, last_client_message_at);

-- 2. Criar pipeline "Triagem" para cada organization
DO $$
DECLARE
    v_org_id UUID;
    v_pipeline_id UUID;
BEGIN
    FOR v_org_id IN SELECT DISTINCT organization_id FROM pipelines
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pipelines WHERE organization_id = v_org_id AND name = 'Triagem') THEN
            -- Posicao -1 para aparecer ANTES de todos os outros funis
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (v_org_id, 'Triagem', 'Funil catch-all - todos os leads entram aqui antes de classificacao', -1)
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
            (v_org_id, v_pipeline_id, 'Recebido', 0, '#94a3b8', false, false),
            (v_org_id, v_pipeline_id, 'Em Conversa', 1, '#3b82f6', false, false),
            (v_org_id, v_pipeline_id, 'Sem Resposta', 2, '#f59e0b', false, false),
            (v_org_id, v_pipeline_id, 'Reclassificado', 3, '#8b5cf6', false, true),
            (v_org_id, v_pipeline_id, 'Perdido', 4, '#ef4444', false, true);
        END IF;
    END LOOP;
END $$;

-- 3. Para pipelines existentes que nao tem Triagem e nao tem nenhuma org ainda
-- (caso especial: instalacao nova)
-- Criar para organizations que existem mas ainda nao tem pipelines
DO $$
DECLARE
    v_org_id UUID;
    v_pipeline_id UUID;
BEGIN
    FOR v_org_id IN
        SELECT o.id
        FROM organizations o
        WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.organization_id = o.id AND p.name = 'Triagem')
    LOOP
        INSERT INTO pipelines (organization_id, name, description, position)
        VALUES (v_org_id, 'Triagem', 'Funil catch-all - todos os leads entram aqui antes de classificacao', -1)
        RETURNING id INTO v_pipeline_id;

        INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost) VALUES
        (v_org_id, v_pipeline_id, 'Recebido', 0, '#94a3b8', false, false),
        (v_org_id, v_pipeline_id, 'Em Conversa', 1, '#3b82f6', false, false),
        (v_org_id, v_pipeline_id, 'Sem Resposta', 2, '#f59e0b', false, false),
        (v_org_id, v_pipeline_id, 'Reclassificado', 3, '#8b5cf6', false, true),
        (v_org_id, v_pipeline_id, 'Perdido', 4, '#ef4444', false, true);
    END LOOP;
END $$;

-- ============================================
-- FIM DA MIGRATION 008
-- ============================================
