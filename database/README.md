# `database/` — schema e migrations (PostgreSQL / Supabase)

Este diretório é a **fonte de verdade versionada** do banco. Rodar `schema.sql` e
depois todas as migrations em ordem, num banco limpo, deve produzir um schema em
que a API (`api/src/**`) funciona por completo.

---

## Ordem de execução

1. **`schema.sql`** — ponto de partida. Cria extensões, tabelas base
   (organizations, users, clients, projects, tasks, time_entries), tabelas de IA
   (ai_interactions, risk_alerts, reports), transcrições/atas, views, funções e
   triggers. Também insere dados de exemplo (org `demo`).
   Só roda em banco **vazio** — não é idempotente (usa `CREATE TABLE` sem
   `IF NOT EXISTS`).
2. **`migrations/*.sql`** — em ordem **lexicográfica do nome do arquivo**:

```
001_invites.sql
002_allocations.sql
003_capacity_calendar.sql
004_crm.sql
005_password_reset.sql
006_crm_advanced.sql
007_crm_multi_pipeline.sql
008_triagem_followup.sql
009_crm_lead_journey.sql
009b_rastreabilidade.sql
010_deal_messages.sql
011_deal_activities_enrich.sql
012_pipeline_padrao_consultoria.sql
013_deal_audit_log.sql
015_deal_files.sql
016_proposal_templates.sql
017_google_calendar.sql
018_fechamento_deriva_schema.sql
019_conversas_rica_indices.sql
```

> **Não existe `014`.** O número foi pulado no histórico; nenhuma funcionalidade
> referenciada pelo código depende dele. Ver "Lacuna do 014" mais abaixo.

Na prática as migrations são coladas no **SQL Editor do Supabase** (é o que os
cabeçalhos dos arquivos dizem). Não há ferramenta de migration/`schema_migrations`
neste repositório — o controle é manual, por isso a idempotência abaixo importa.

---

## O que cada migration faz

| Arquivo | Em uma linha |
| --- | --- |
| `001_invites.sql` | Tabela `invites` (convite de membro por e-mail) + trigger de `updated_at`. |
| `002_allocations.sql` | `users.weekly_capacity` e campos de alocação em `project_members`. |
| `003_capacity_calendar.sql` | Tabela `consultant_blocks` (férias/licenças) e `projects.color`. |
| `004_crm.sql` | Núcleo do CRM: `pipeline_stages`, `deals`, `deal_insights`, `deal_activities`, `deal_products` + etapas padrão. |
| `005_password_reset.sql` | `users.reset_token` / `reset_token_expires`. |
| `006_crm_advanced.sql` | SLA nas etapas, campos de aging/follow-up em `deals`, `deal_automations`, `deal_automation_log`, `deal_contacts`. |
| `007_crm_multi_pipeline.sql` | Múltiplos funis: `pipelines`, `companies`, `contacts` + migração dos dados legados. |
| `008_triagem_followup.sql` | Funil "Triagem" (catch-all) e colunas de follow-up em `deals`. |
| `009_crm_lead_journey.sql` | Rastreabilidade da jornada: UTMs/`rica_session_id` em `deals` + tabela `lead_journey_events`. |
| `009b_rastreabilidade.sql` | `deals.source_detail` / `assigned_via` / `assigned_at` / `assigned_by` + backfill. (Renumerada — ver "Colisão do 009".) |
| `010_deal_messages.sql` | **Definição canônica** de `deal_messages` (log cru da conversa Rica↔cliente). |
| `011_deal_activities_enrich.sql` | `outcome`, `transcription`, `duration_minutes`, `direction` em `deal_activities`. |
| `012_pipeline_padrao_consultoria.sql` | Cria o funil "Padrão Consultoria" com 7 estágios. |
| `013_deal_audit_log.sql` | Tabela `deal_audit_log` (quem fez o quê em cada deal). |
| `015_deal_files.sql` | Tabela `deal_files` (metadados dos anexos no bucket `deal-files`). |
| `016_proposal_templates.sql` | `proposal_templates` e `deal_proposals` (propostas em Handlebars). |
| `017_google_calendar.sql` | `user_google_tokens` (OAuth por usuário) e `google_event_id` em `deal_activities`. |
| `018_fechamento_deriva_schema.sql` | **Fecha a deriva** entre o código e o schema versionado: colunas e tabelas que a API usava e que não existiam em lugar nenhum. |
| `019_conversas_rica_indices.sql` | Índices para `GET /api/crm/conversations` (lista de conversas da Rica agrupada por telefone): `deal_messages(organization_id, rica_session_id, occurred_at DESC)` + índices de expressão do telefone normalizado em `contacts`/`deals`. |

---

## Colisão do `009` — como foi resolvida

Existiam **dois arquivos `009`**:

- `009_crm_lead_journey.sql`
- `009_rastreabilidade.sql`

Pior: `009_rastreabilidade.sql` criava a tabela `deal_messages` com um schema
(`contact_phone`, `direction`, `sender`, `text`, `sent_at`) **incompatível** com o
schema criado por `010_deal_messages.sql` (`role`, `channel`, `content`,
`occurred_at`, `rica_session_id`). Como as duas usavam `CREATE TABLE IF NOT EXISTS`,
**quem rodasse primeiro vencia** — resultado não-determinístico.

Resolução:

1. `009_rastreabilidade.sql` foi renomeada para **`009b_rastreabilidade.sql`**, o
   que fixa a ordem: `009` → `009b` → `010`. O conteúdo único e realmente usado
   pelo código (`source_detail`, `assigned_via`, `assigned_at`, `assigned_by` em
   `deals`, mais os índices e o backfill) foi preservado.
2. A criação de `deal_messages` foi **removida** de `009b`, deixando no lugar um
   comentário explicando que a definição canônica é a de `010_deal_messages.sql`.
   A escolha do `010` é ditada pelo código: `api/src/routes/crm.js`
   (`POST /messages`, `POST /deals/:id/messages`, `GET /deals/:id/messages`,
   `GET /contacts/by-phone/:phone/messages`) usa `role`/`channel`/`content`/
   `occurred_at`/`rica_session_id`/`external_message_id`.
3. `018_fechamento_deriva_schema.sql` **reconcilia** bancos que já tenham pegado
   o formato antigo: adiciona as colunas do `010`, relaxa as `NOT NULL` herdadas
   (`contact_phone`, `direction`, `sent_at`) e garante o índice único
   `(deal_id, external_message_id)` de que os `ON CONFLICT` dependem.

---

## Lacuna do `014`

Não há `014_*.sql`. Auditando todas as tabelas e colunas referenciadas por
`api/src/**`, **nada que o código precise ficou órfão por causa dessa lacuna** — a
sequência `013 → 015` não deixa dependência quebrada. Tudo que faltava no schema
foi identificado e está no `018`. A hipótese mais provável é que o `014` tenha
sido descartado antes de ser commitado. **Só o acesso ao banco de produção
confirma** se ele chegou a ser aplicado lá.

---

## Idempotência — pode re-executar

Todas as migrations de `001` em diante são escritas para serem **seguras em
re-execução** e seguras contra um banco que já tenha (parte das) mudanças:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`;
- renomes dentro de blocos `DO $$ ... $$` que checam
  `information_schema.columns` antes de agir (renomeia só se a coluna antiga
  existir **e** a nova não; se nenhuma existir, cria a nova);
- constraints/FKs adicionadas dentro de `DO $$ ... $$` checando
  `information_schema.table_constraints` / `pg_constraint`;
- `ALTER COLUMN ... DROP NOT NULL` (no-op se a coluna já é nullable);
- backfills com `WHERE <coluna> IS NULL`, então não sobrescrevem dados.

Exceção: **`schema.sql` não é idempotente** — é o ponto de partida de um banco
vazio.

Os `.sql` deste diretório foram validados sintaticamente com o parser oficial do
PostgreSQL (`pglast`); todos parseiam sem erro. Isso valida sintaxe, **não**
semântica — não houve acesso ao banco de produção.

---

## Deriva que ficou do lado do CÓDIGO (não corrigível por migration)

Encontrado durante a auditoria; **não** foi "resolvido" criando coluna no banco,
porque criaria duas fontes de verdade:

- **`tasks.assigned_to`** — a automação `create_task` em `api/src/routes/crm.js`
  (~linha 72) faz `INSERT INTO tasks (..., assigned_to, ...)`. A coluna correta é
  **`assignee_id`** (é o que todo o resto do código usa). Enquanto não for
  corrigido no código, essa ação de automação estoura com
  `column "assigned_to" does not exist`. Correção é de uma palavra, em `api/src`.
- No mesmo INSERT, `status` é gravado como `'pending'`, valor fora do conjunto
  documentado de `tasks.status` (`todo`, `in_progress`, `review`, `done`,
  `cancelled`). Não há `CHECK`, então não quebra — mas essas tarefas não
  aparecem nos filtros das telas.
