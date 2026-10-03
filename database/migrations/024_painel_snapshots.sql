-- 024_painel_snapshots.sql
-- Foto diária dos indicadores do Painel Comercial (sem filtros), por fonte.
-- Pipeline, forecast e commit são "foto do momento": sem histórico não há
-- como comparar com o mês anterior.
CREATE TABLE IF NOT EXISTS painel_snapshots (
  organization_id UUID NOT NULL,
  fonte TEXT NOT NULL,
  dia DATE NOT NULL,
  kpis JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (organization_id, fonte, dia)
);
