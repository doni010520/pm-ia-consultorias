-- ============================================
-- MIGRATION 018: Fechamento da deriva entre o codigo da API e o schema versionado
-- ============================================
-- Consolida TODAS as colunas/tabelas que `api/src/**` usa em SQL mas que nao
-- existiam nem em `database/schema.sql` nem em nenhuma migration anterior.
--
-- Escopo:
--   1.  users.password_hash                       (login, convites, seeds)
--   2.  invites.whatsapp                          (POST/GET /api/invites)
--   3.  tasks.deal_id                             (tarefas ligadas a deals do CRM)
--   4.  deals.closed_at                           (close-inactive / close-no-response)
--   5.  deal_activities.organization_id           (varios INSERTs em crm.js)
--   6.  deal_automation_log.status                (executeAutomations)
--   7.  risk_alerts: risk_score/details/title/description/source + NOT NULLs
--   8.  deal_messages: reconciliacao 009b vs 010 (schema canonico = 010)
--   9.  rica_crm_chat_sessions / rica_crm_chat_messages (chat da Rica no app)
--   10. n8n_chat_histories                        (lida por relatorio_atendimentos)
--   11. Renome das colunas de atas para os nomes canonicos:
--         atas.resumo            -> atas.resumo_executivo
--         ata_acoes.responsavel  -> ata_acoes.responsavel_nome
--       + ata_decisoes.justificativa
--
-- TUDO aqui e IDEMPOTENTE: pode ser re-executado em um banco que ja tenha
-- (parte de) estas mudancas sem erro e sem perda de dados.
-- ============================================


-- ============================================
-- 1. users.password_hash
-- ============================================
-- Usado em: routes/auth.js (login, reset de senha, POST /users),
--           routes/invites.js (aceite de convite), scripts/seed-*.js.
-- Sem esta coluna o login inteiro nao funciona num banco novo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;


-- ============================================
-- 2. invites.whatsapp
-- ============================================
-- Usado em: routes/invites.js (INSERT no convite e leitura no aceite).
ALTER TABLE invites ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(20);


-- ============================================
-- 3. tasks.deal_id
-- ============================================
-- Usado em: services/database.js (createTask/getTasks), routes/tasks.js,
--           routes/crm.js (POST /deals/:id/tasks e automacao create_task).
-- ON DELETE SET NULL: apagar um deal nao apaga a tarefa, so desvincula.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deal_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_tasks_deal' AND table_name = 'tasks'
    ) THEN
        ALTER TABLE tasks
            ADD CONSTRAINT fk_tasks_deal
            FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id) WHERE deal_id IS NOT NULL;


-- ============================================
-- 4. deals.closed_at
-- ============================================
-- Usado em: routes/crm.js -> POST /deals/close-inactive e
--                            PATCH /deals/:id/close-no-response.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deals_closed_at
    ON deals(organization_id, closed_at) WHERE closed_at IS NOT NULL;


-- ============================================
-- 5. deal_activities.organization_id
-- ============================================
-- Usado em: routes/crm.js -> follow-up, close-inactive, close-no-response.
-- Fica NULLABLE de proposito: linhas antigas nao tem valor e o INSERT das
-- outras rotas (que nao passam organization_id) precisa continuar funcionando.
ALTER TABLE deal_activities ADD COLUMN IF NOT EXISTS organization_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_deal_activities_org' AND table_name = 'deal_activities'
    ) THEN
        ALTER TABLE deal_activities
            ADD CONSTRAINT fk_deal_activities_org
            FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- Backfill a partir do deal
UPDATE deal_activities da
SET organization_id = d.organization_id
FROM deals d
WHERE d.id = da.deal_id AND da.organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_deal_activities_org
    ON deal_activities(organization_id, created_at DESC);


-- ============================================
-- 6. deal_automation_log.status
-- ============================================
-- executeAutomations() em routes/crm.js faz
--   INSERT INTO deal_automation_log (..., status) VALUES (..., 'success'|'error')
-- mas 006_crm_advanced.sql criou `success BOOLEAN` + `error_message`.
-- Caminho menos destrutivo: adicionar `status` e MANTER `success` para os dados
-- antigos, fazendo backfill de um a partir do outro.
ALTER TABLE deal_automation_log ADD COLUMN IF NOT EXISTS status VARCHAR(20);

UPDATE deal_automation_log
SET status = CASE WHEN COALESCE(success, true) THEN 'success' ELSE 'error' END
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_deal_automation_log_status
    ON deal_automation_log(automation_id, status);


-- ============================================
-- 7. risk_alerts: colunas usadas pelo codigo + NOT NULLs bloqueantes
-- ============================================
-- saveRiskAlert() em services/database.js insere: risk_score, details
-- logAlert()      em services/scheduler.js insere: title, description, source
-- O schema original so tinha: indicators, summary, recommended_actions.
ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS risk_score   INTEGER;
ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS details      JSONB;
-- title e TEXT (nao VARCHAR(n)) porque scheduler.js monta
-- 'Alerta de prazo: ' || tasks.title, e tasks.title ja e VARCHAR(500).
ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS title        TEXT;
ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS description  TEXT;
ALTER TABLE risk_alerts ADD COLUMN IF NOT EXISTS source       VARCHAR(50);

-- `indicators JSONB NOT NULL` bloqueava OS DOIS inserts do codigo (nenhum
-- passa `indicators`). Por isso POST /api/projects/check-risks estourava sem
-- catch ao encontrar um projeto em risco.
ALTER TABLE risk_alerts ALTER COLUMN indicators DROP NOT NULL;

-- `project_id NOT NULL` quebra o alerta do scheduler para tarefas sem projeto
-- (logAlert passa task.project_id, que pode ser NULL).
ALTER TABLE risk_alerts ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_risk_alerts_source
    ON risk_alerts(organization_id, source, created_at DESC);


-- ============================================
-- 8. deal_messages -- reconciliacao 009b vs 010
-- ============================================
-- Definicao CANONICA = 010_deal_messages.sql (o schema que routes/crm.js usa).
-- Este bloco garante que:
--   a) num banco limpo a tabela nasca no formato do 010;
--   b) num banco que pegou o formato antigo (009_rastreabilidade), as colunas
--      do 010 sejam adicionadas e as NOT NULL antigas sejam relaxadas.

CREATE TABLE IF NOT EXISTS deal_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(30),
    channel VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
    content TEXT,
    media_url TEXT,
    media_type VARCHAR(50),
    external_message_id VARCHAR(255),
    rica_session_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Colunas do schema canonico (no-op se a tabela ja nasceu pelo 010)
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS deal_id             UUID;
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS organization_id     UUID;
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS role                VARCHAR(30);
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS channel             VARCHAR(30) DEFAULT 'whatsapp';
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS content             TEXT;
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS media_url           TEXT;
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS media_type          VARCHAR(50);
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255);
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS rica_session_id     VARCHAR(100);
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS metadata            JSONB DEFAULT '{}';
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS occurred_at         TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE deal_messages ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ DEFAULT NOW();

-- NOT NULLs que o codigo viola:
--   deal_id  -> POST /api/crm/messages grava mensagem antes de existir deal
--   content  -> mensagem so de midia entra com content NULL
ALTER TABLE deal_messages ALTER COLUMN deal_id DROP NOT NULL;
ALTER TABLE deal_messages ALTER COLUMN content DROP NOT NULL;

-- CHECK de `role` do 010 so aceitava ('client','rica','agent','system'), mas o
-- codigo grava tambem 'lead', 'cliente', 'rica_ai', 'system_followup',
-- 'executive', 'system_catchup' (valor vem do campo `sender` do n8n).
ALTER TABLE deal_messages DROP CONSTRAINT IF EXISTS deal_messages_role_check;

-- Alarga `role` de VARCHAR(20) (010) para VARCHAR(30): no-op se ja for 30.
ALTER TABLE deal_messages ALTER COLUMN role TYPE VARCHAR(30);

-- Colunas herdadas do schema antigo (009): relaxa NOT NULL se existirem, para
-- que os INSERTs no formato 010 nao estourem.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'deal_messages' AND column_name = 'contact_phone') THEN
        ALTER TABLE deal_messages ALTER COLUMN contact_phone DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'deal_messages' AND column_name = 'direction') THEN
        ALTER TABLE deal_messages ALTER COLUMN direction DROP NOT NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'deal_messages' AND column_name = 'sent_at') THEN
        ALTER TABLE deal_messages ALTER COLUMN sent_at DROP NOT NULL;
    END IF;
END $$;

-- Unicidade exigida pelos `ON CONFLICT (deal_id, external_message_id)`.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_deal_message_external'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'uq_deal_message_external_idx'
    ) THEN
        CREATE UNIQUE INDEX uq_deal_message_external_idx
            ON deal_messages (deal_id, external_message_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deal_messages_deal_occurred
    ON deal_messages(deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_messages_session
    ON deal_messages(rica_session_id) WHERE rica_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_messages_org_session
    ON deal_messages(organization_id, rica_session_id, occurred_at);


-- ============================================
-- 9. Chat da Rica dentro do app (rica_crm_chat_*)
-- ============================================
-- Schema derivado das queries de api/src/routes/rica-chat.js:
--   ensureSession()  -> SELECT id / INSERT (organization_id, user_id) / UPDATE last_message_at / UPDATE title
--   loadHistory()    -> SELECT role, content, tool_calls, tool_results ... ORDER BY created_at
--   saveMessages()   -> INSERT (session_id, role, content, tool_calls, tool_results)
--   DELETE /session/:id -> DELETE ... WHERE session_id = $1

CREATE TABLE IF NOT EXISTS rica_crm_chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT,                                  -- setado com os 1os 80 chars; volta a NULL ao limpar
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rica_chat_sessions_user
    ON rica_crm_chat_sessions(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_rica_chat_sessions_org
    ON rica_crm_chat_sessions(organization_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS rica_crm_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES rica_crm_chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,                   -- 'user' | 'assistant' | 'tool'
    content TEXT,
    tool_calls JSONB,
    tool_results JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rica_chat_messages_session
    ON rica_crm_chat_messages(session_id, created_at DESC);

COMMENT ON TABLE rica_crm_chat_sessions IS 'Sessoes do chat da Rica dentro do app (api/src/routes/rica-chat.js).';
COMMENT ON TABLE rica_crm_chat_messages IS 'Mensagens do chat da Rica no app, incluindo tool calls/results do AI SDK.';


-- ============================================
-- 10. n8n_chat_histories
-- ============================================
-- Tabela criada e mantida pelo n8n (no Postgres Chat Memory). NAO e nossa, mas
-- `relatorio_atendimentos` em services/rica-tools.js faz JOIN nela; sem a
-- tabela a ferramenta estoura num banco limpo. Criada aqui com o MESMO formato
-- que o n8n usa, e apenas se ainda nao existir.
CREATE TABLE IF NOT EXISTS n8n_chat_histories (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    message JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session
    ON n8n_chat_histories(session_id, id);

COMMENT ON TABLE n8n_chat_histories IS
    'Memoria de conversa do n8n (Postgres Chat Memory). Owner: n8n. Criada aqui apenas para que um banco limpo suporte relatorio_atendimentos.';


-- ============================================
-- 11. Atas: nomes canonicos das colunas
-- ============================================
-- Decisao: os nomes LONGOS sao os canonicos, porque sao os que rica-tools,
-- a rota PATCH /api/transcriptions/atas/:id, os tipos e as telas do frontend leem.
--   atas.resumo           -> atas.resumo_executivo
--   ata_acoes.responsavel -> ata_acoes.responsavel_nome
-- ATENCAO: ata_decisoes.responsavel e ata_riscos.responsavel NAO sao renomeadas
-- -- o codigo de escrita e de leitura dessas duas usa `responsavel` mesmo.

-- 11.1 atas.resumo -> atas.resumo_executivo
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'atas' AND column_name = 'resumo')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'atas' AND column_name = 'resumo_executivo') THEN
        ALTER TABLE atas RENAME COLUMN resumo TO resumo_executivo;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'atas' AND column_name = 'resumo_executivo') THEN
        ALTER TABLE atas ADD COLUMN resumo_executivo TEXT;
    END IF;
END $$;

-- 11.2 ata_acoes.responsavel -> ata_acoes.responsavel_nome
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'ata_acoes' AND column_name = 'responsavel')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'ata_acoes' AND column_name = 'responsavel_nome') THEN
        ALTER TABLE ata_acoes RENAME COLUMN responsavel TO responsavel_nome;
    ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_name = 'ata_acoes' AND column_name = 'responsavel_nome') THEN
        ALTER TABLE ata_acoes ADD COLUMN responsavel_nome VARCHAR(255);
    END IF;
END $$;

-- 11.3 ata_decisoes.justificativa
-- PATCH /api/transcriptions/atas/:id/decisoes/:decisaoId escreve essa coluna e
-- o frontend (AtaDetail.tsx / tipo AtaDecisao) le. Nunca existiu no schema.
ALTER TABLE ata_decisoes ADD COLUMN IF NOT EXISTS justificativa TEXT;


-- ============================================
-- FIM DA MIGRATION 018
-- ============================================
