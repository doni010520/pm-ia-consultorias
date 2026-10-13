-- 025_rica_envios_grupo.sql
-- Mensagens agendadas que a Rica dispara em grupos de WhatsApp (régua da
-- Masterclass de 14/10/2026, cards enviados pela Malu). O worker do rica-bot
-- (src/grupos/envios-agendados.ts) olha a cada minuto e manda o que venceu.
CREATE TABLE IF NOT EXISTS rica_envios_grupo (
  id SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  grupo_jid TEXT NOT NULL,            -- ex.: 1203634...@g.us
  enviar_em TIMESTAMPTZ NOT NULL,
  texto TEXT NOT NULL DEFAULT '',
  midia_url TEXT,                     -- imagem pública (bucket media do Supabase)
  status TEXT NOT NULL DEFAULT 'pendente', -- pendente | enviado | erro | atrasado | cancelado
  erro TEXT,
  enviado_at TIMESTAMPTZ,
  descricao TEXT,                     -- rótulo para humanos ("D-1 20h: é amanhã")
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rica_envios_grupo_pendentes ON rica_envios_grupo (enviar_em) WHERE status = 'pendente';
