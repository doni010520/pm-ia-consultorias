-- ============================================
-- MIGRATION 019: Indices para a listagem de conversas da Rica
-- ============================================
-- Da suporte a `GET /api/crm/conversations` (api/src/routes/crm.js), que lista
-- as conversas Rica<->lead agrupadas por TELEFONE.
--
-- Contexto: `deal_messages.rica_session_id` guarda o telefone normalizado (so
-- digitos) e e a chave real da conversa -- mensagens podem ter `deal_id` NULL e
-- um mesmo telefone pode ter varios deals. Por isso o agrupamento e por
-- `rica_session_id`, nao por `deal_id`.
--
-- Forma da consulta (resumida):
--
--   WITH conv AS (
--     SELECT rica_session_id AS phone,
--            MAX(occurred_at), COUNT(*),
--            (ARRAY_AGG(LEFT(content,120)     ORDER BY occurred_at DESC, id DESC))[1],
--            (ARRAY_AGG(metadata->>'direction' ORDER BY occurred_at DESC, id DESC))[1],
--            (ARRAY_AGG(deal_id ORDER BY occurred_at DESC, id DESC) FILTER (...))[1]
--     FROM deal_messages
--     WHERE organization_id = $1 AND rica_session_id IS NOT NULL AND rica_session_id <> ''
--     GROUP BY rica_session_id
--   ), resolved AS (
--     conv LEFT JOIN LATERAL (contato por telefone normalizado)
--          LEFT JOIN LATERAL (deal mais recente do telefone)
--   )
--   SELECT ... FROM resolved ORDER BY last_message_at DESC LIMIT <=200 OFFSET ...
--
-- Decisao DISTINCT ON vs LATERAL para a "ultima mensagem por conversa":
--   O padrao que costuma derrubar o banco e um LATERAL "ultima mensagem" POR
--   LINHA sobre `deal_messages`: sem indice ele varre a tabela inteira para
--   cada conversa. Aqui NAO existe esse LATERAL: a ultima mensagem sai do
--   MESMO GROUP BY, via ARRAY_AGG ordenado.
--   `DISTINCT ON (rica_session_id) ... ORDER BY rica_session_id, occurred_at DESC`
--   resolveria a ultima mensagem em uma passada de indice, mas NAO produz
--   `message_count` -- exigiria uma segunda varredura agregada e um join entre
--   as duas. O GROUP BY com ARRAY_AGG ordenado entrega ultima mensagem +
--   contagem em UMA unica passada sobre a mesma faixa de indice. Por isso o
--   GROUP BY venceu.
--   Os dois LATERAL que sobraram (contato e deal) rodam uma vez por CONVERSA
--   (nao por mensagem) e sao resolvidos por index scan -- ver indices 2 a 4.
--
-- Teto: a rota sempre aplica LIMIT (default 100, maximo 200) + OFFSET.
--
-- IDEMPOTENTE: todos os indices usam CREATE INDEX IF NOT EXISTS.
-- ============================================


-- ============================================
-- 1. deal_messages (organization_id, rica_session_id, occurred_at DESC)
-- ============================================
-- Serve, com uma unica estrutura:
--   a) o `WHERE organization_id = $1` + `GROUP BY rica_session_id` da CTE
--      `conv` (o prefixo (organization_id, rica_session_id) permite
--      GroupAggregate sobre index scan, sem sort da tabela inteira);
--   b) o desempate `ORDER BY occurred_at DESC` dentro de cada grupo, usado
--      pelos tres ARRAY_AGG ordenados;
--   c) o "ultimo por telefone" e o thread cronologico de
--      `GET /api/crm/contacts/by-phone/:phone/messages`, que filtra
--      (organization_id, rica_session_id) e ordena por occurred_at.
-- A migration 018 ja criou um indice equivalente com occurred_at ASC
-- (idx_deal_messages_org_session). Este e o DESC pedido pela listagem; manter
-- os dois e barato e evita depender de leitura reversa do planner.
CREATE INDEX IF NOT EXISTS idx_deal_messages_org_session_occurred_desc
    ON deal_messages (organization_id, rica_session_id, occurred_at DESC);


-- ============================================
-- 2. contacts (organization_id, telefone normalizado)
-- ============================================
-- O LATERAL que resolve contact_id/contact_name compara o telefone SO por
-- digitos, porque `rica_session_id` guarda so digitos e `contacts.phone` vem
-- formatado ('(11) 91234-5678'):
--     REGEXP_REPLACE(COALESCE(x.phone, ''), '\D', '', 'g') = c.phone
-- O indice existente `idx_contacts_phone (organization_id, phone)` NAO serve
-- (a expressao invalida o uso do indice) -- sem este indice de expressao cada
-- conversa faria um seq scan em `contacts`.
-- A expressao abaixo e IDENTICA a da query, senao o planner nao a reconhece.
CREATE INDEX IF NOT EXISTS idx_contacts_org_phone_digits
    ON contacts (organization_id, (REGEXP_REPLACE(COALESCE(phone, ''), '\D', '', 'g')));


-- ============================================
-- 3. deals (organization_id, telefone normalizado)
-- ============================================
-- Mesmo motivo, para o ramo de telefone do LATERAL que escolhe o deal mais
-- recente da conversa:
--     REGEXP_REPLACE(COALESCE(d.contact_phone, ''), '\D', '', 'g') = c.phone
-- O `idx_deals_contact_phone (contact_phone)` do 004 nao cobre a expressao nem
-- o escopo por organizacao.
CREATE INDEX IF NOT EXISTS idx_deals_org_contact_phone_digits
    ON deals (organization_id, (REGEXP_REPLACE(COALESCE(contact_phone, ''), '\D', '', 'g')));


-- ============================================
-- 4. deals (organization_id, contact_id)
-- ============================================
-- Ramo `d.contact_id = ct.id` do mesmo LATERAL. Ja existe `idx_deals_contact
-- (contact_id)` (007), mas sem `organization_id` o BitmapOr das tres condicoes
-- precisa refiltrar a org linha a linha. Com o par, cada ramo do OR vira um
-- bitmap index scan direto.
CREATE INDEX IF NOT EXISTS idx_deals_org_contact
    ON deals (organization_id, contact_id) WHERE contact_id IS NOT NULL;


-- ============================================
-- 5. deals (organization_id, owner_id)
-- ============================================
-- Escopo por dono: usuario `member` so ve conversas cujo deal e dele
-- (`r.deal_id IS NULL OR r.owner_id = $n`). Tambem ajuda o
-- `ORDER BY d.created_at DESC LIMIT 1` do LATERAL a nao percorrer deals de
-- outras organizacoes. `idx_deals_owner (owner_id)` do 004 nao tem a org.
CREATE INDEX IF NOT EXISTS idx_deals_org_owner
    ON deals (organization_id, owner_id) WHERE owner_id IS NOT NULL;


-- ============================================
-- FIM DA MIGRATION 019
-- ============================================
