-- 023_painel_comercial.sql
-- Painel Comercial (out/2026): visão executiva da Maria com duas fontes durante a
-- transição — RD Station CRM (sincronizado) e o nosso CRM — mais as metas do mês.

-- Integração com o RD Station CRM (API v1, token da instância de um usuário com
-- visibilidade Geral). Uma linha por organização.
CREATE TABLE IF NOT EXISTS integracao_rd (
  organization_id UUID PRIMARY KEY,
  token TEXT NOT NULL,
  dono_token TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  deals_sincronizados INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cópia normalizada das negociações do RD. Substituída inteira a cada sync;
-- nunca se mistura com a tabela deals.
CREATE TABLE IF NOT EXISTS rd_deals (
  organization_id UUID NOT NULL,
  rd_id TEXT NOT NULL,
  nome TEXT,
  funil TEXT,
  etapa TEXT,
  status TEXT NOT NULL,              -- aberto | ganho | perdido
  valor NUMERIC DEFAULT 0,
  executivo TEXT,
  executivo_email TEXT,
  origem TEXT,
  produtos TEXT[],
  uf TEXT,
  telefones TEXT[],
  emails TEXT[],
  pausado BOOLEAN DEFAULT FALSE,
  tem_proxima_tarefa BOOLEAN DEFAULT FALSE,
  criado_em TIMESTAMPTZ,
  fechado_em TIMESTAMPTZ,
  previsao_fechamento DATE,
  atualizado_em TIMESTAMPTZ,
  ultima_atividade_em TIMESTAMPTZ,
  PRIMARY KEY (organization_id, rd_id)
);
CREATE INDEX IF NOT EXISTS idx_rd_deals_status ON rd_deals (organization_id, status);

-- Metas mensais. executivo NULL = meta total da empresa no mês.
CREATE TABLE IF NOT EXISTS metas_comerciais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  mes DATE NOT NULL,                 -- primeiro dia do mês
  executivo TEXT,
  valor NUMERIC NOT NULL DEFAULT 0,
  updated_by UUID,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_metas_comerciais
  ON metas_comerciais (organization_id, mes, COALESCE(executivo, ''));
