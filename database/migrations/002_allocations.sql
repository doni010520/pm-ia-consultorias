-- Migration: Controle de Capacidade / Alocação de Consultores
-- Execute no Supabase SQL Editor

-- Adicionar capacidade semanal no usuário (default 40h)
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_capacity DECIMAL(5,1) DEFAULT 40;

-- Adicionar horas por semana na alocação projeto-membro
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS hours_per_week DECIMAL(5,1) DEFAULT 0;

-- Adicionar datas de início/fim da alocação
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
