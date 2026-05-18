-- 015_deal_files.sql
-- Stores metadata for files attached to deals.
-- Actual files are in Supabase Storage bucket: deal-files

CREATE TABLE IF NOT EXISTS deal_files (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name     TEXT NOT NULL,
  file_size     BIGINT,
  mime_type     TEXT,
  storage_path  TEXT NOT NULL,
  category      VARCHAR(30) DEFAULT 'other',
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_files_deal     ON deal_files(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_files_org      ON deal_files(organization_id);

COMMENT ON COLUMN deal_files.storage_path IS 'Path inside the deal-files Supabase Storage bucket';
COMMENT ON COLUMN deal_files.category     IS 'One of: proposal, contract, presentation, nda, report, other';
