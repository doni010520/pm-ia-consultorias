-- 016_proposal_templates.sql
-- Handlebars-based proposal templates and generated deal proposals.

CREATE TABLE IF NOT EXISTS proposal_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  body_markdown   TEXT NOT NULL DEFAULT '',
  variables       JSONB NOT NULL DEFAULT '[]',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deal_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id     UUID REFERENCES proposal_templates(id) ON DELETE SET NULL,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  variable_values JSONB NOT NULL DEFAULT '{}',
  rendered_markdown TEXT,
  file_id         UUID REFERENCES deal_files(id) ON DELETE SET NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_templates_org  ON proposal_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_deal_proposals_deal      ON deal_proposals(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_proposals_org       ON deal_proposals(organization_id);

COMMENT ON COLUMN deal_proposals.status IS 'draft | generating | ready | sent';
COMMENT ON COLUMN proposal_templates.variables IS 'Array of {key, label, default?} objects';
