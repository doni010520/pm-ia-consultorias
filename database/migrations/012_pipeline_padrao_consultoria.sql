-- ============================================
-- MIGRATION 012: Pipeline "Padrão Consultoria"
-- ============================================
-- Cria novo pipeline com os 7 estagios solicitados.
-- NAO altera pipelines existentes (dados legados preservados).
-- Fechamento e Pos-venda sao ambos is_won=true (conforme decisao do usuario).
-- Para agregar deals ganhos, usar deals.status='won', nao is_won da stage.
-- ============================================

DO $$
DECLARE
    v_org_id UUID;
    v_pipeline_id UUID;
BEGIN
    FOR v_org_id IN SELECT id FROM organizations
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pipelines
            WHERE organization_id = v_org_id AND name = 'Padrão Consultoria'
        ) THEN
            INSERT INTO pipelines (organization_id, name, description, position)
            VALUES (
                v_org_id,
                'Padrão Consultoria',
                'Funil principal: Identificação → Apresentação → Diagnóstico → Proposta → Fechamento → Pós-venda',
                10  -- posicao alta para nao conflitar com posicoes existentes
            )
            RETURNING id INTO v_pipeline_id;

            INSERT INTO pipeline_stages (organization_id, pipeline_id, name, position, color, is_won, is_lost)
            VALUES
                (v_org_id, v_pipeline_id, 'Identificação',    0, '#94a3b8', false, false),
                (v_org_id, v_pipeline_id, 'Apresentação',     1, '#3b82f6', false, false),
                (v_org_id, v_pipeline_id, 'Diagnóstico',      2, '#8b5cf6', false, false),
                (v_org_id, v_pipeline_id, 'Proposta Enviada', 3, '#f59e0b', false, false),
                (v_org_id, v_pipeline_id, 'Fechamento',       4, '#f97316', true,  false),
                (v_org_id, v_pipeline_id, 'Pós-venda',        5, '#22c55e', true,  false),
                (v_org_id, v_pipeline_id, 'Perdido',          6, '#ef4444', false, true);
        END IF;
    END LOOP;
END $$;

-- ============================================
-- FIM DA MIGRATION 012
-- ============================================
