-- ============================================================
-- 020 — Destrava a gravação de mensagens da Rica (deal_messages)
-- ============================================================
-- POR QUE ESTA MIGRATION EXISTE, SEPARADA DA 018
--
-- Diagnóstico feito contra a produção em 26/08/2026:
-- `deal_messages` está com ZERO linhas, embora o bot chame
-- `POST /api/crm/messages` desde sempre. A causa:
--
--   deal_messages_role_check
--     CHECK (role = ANY (ARRAY['client','rica','agent','system']))
--
-- ...enquanto o endpoint grava `role = sender`, cujos valores reais
-- são 'cliente', 'rica_ai', 'system_followup', 'lead', 'executive',
-- 'system_catchup'. TODA inserção viola o CHECK. Como o `saveMessage`
-- do bot é fire-and-forget (só emite warn), a falha é silenciosa há
-- meses. Some-se `deal_id NOT NULL`, enquanto o endpoint resolve
-- deal_id como NULL quando não encontra o negócio.
--
-- A 018 corrige isto, mas mexe em MUITA coisa além (renomeia colunas
-- de atas, adiciona colunas em risk_alerts, cria tabelas...). Esta 020
-- é o subconjunto MÍNIMO necessário para a tela de conversas entrar no
-- ar, para permitir um primeiro deploy de baixo risco. A 018 continua
-- válida e pode ser aplicada depois — as duas são idempotentes e não
-- conflitam.
--
-- Tudo aqui é idempotente e pode ser re-executado.
-- ============================================================


-- ------------------------------------------------------------
-- 1) Remover o CHECK de `role` que barra as gravações
-- ------------------------------------------------------------
-- Não substituímos por um CHECK novo com a lista completa de propósito:
-- os valores vêm do campo `sender` do bot, que evolui (cada novo tipo de
-- mensagem inventa um). Um CHECK aqui volta a derrubar gravação em
-- silêncio no dia em que alguém adicionar um sender. A validação certa
-- é na aplicação, não no banco.
alter table deal_messages drop constraint if exists deal_messages_role_check;

-- `role` era VARCHAR(20); 'system_followup' tem 15, mas os próximos podem
-- passar. Alarga para não repetir o mesmo tipo de bloqueio por truncamento.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='deal_messages'
       and column_name='role' and character_maximum_length < 30
  ) then
    alter table deal_messages alter column role type varchar(30);
  end if;
end $$;


-- ------------------------------------------------------------
-- 2) Relaxar os NOT NULL que o fluxo real viola
-- ------------------------------------------------------------
-- deal_id: `POST /api/crm/messages` resolve o deal pelo telefone e pode
-- não achar nenhum (lead que ainda não virou negócio). A conversa é com
-- a PESSOA; o deal é opcional.
alter table deal_messages alter column deal_id drop not null;

-- content: mensagem só de mídia (áudio, imagem) chega sem texto.
alter table deal_messages alter column content drop not null;


-- ------------------------------------------------------------
-- 3) Índice para a listagem de conversas
-- ------------------------------------------------------------
-- A tela agrupa por telefone (`rica_session_id`) e pega a última
-- mensagem de cada conversa. Sem este índice o agrupamento varre a
-- tabela inteira; com ele vira um GroupAggregate sobre index scan.
-- O `occurred_at DESC` serve tanto o "última mensagem" da lista quanto
-- o thread por telefone, que passou a consultar em ordem decrescente.
create index if not exists idx_deal_messages_org_session_occurred
  on deal_messages (organization_id, rica_session_id, occurred_at desc);

-- Suporta a busca por telefone da listagem sem seq scan em contacts.
create index if not exists idx_contacts_org_phone_digits
  on contacts (organization_id, (regexp_replace(coalesce(phone,''), '\D', '', 'g')));

-- Idem para resolver o negócio a partir do telefone da conversa.
create index if not exists idx_deals_org_contact_phone_digits
  on deals (organization_id, (regexp_replace(coalesce(contact_phone,''), '\D', '', 'g')));

analyze deal_messages;

-- ============================================================
-- FIM DA MIGRATION 020
-- ============================================================
