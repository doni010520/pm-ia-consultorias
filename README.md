# PM-IA - Sistema de Gestao de Projetos com IA

Sistema completo (API + Frontend) para gestao de projetos de consultoria com processamento inteligente de transcricoes de reuniao. Recebe arquivos `.txt` de transcricoes, processa com IA (OpenAI GPT-4.1-mini/GPT-4.1) e cria automaticamente projetos, atas, acoes, decisoes e riscos no PostgreSQL. Substitui o Notion como ferramenta de gestao.

**Repositorio:** https://github.com/doni010520/pm-ia-consultorias

---

## Arquitetura

```
                    ┌─────────────┐
                    │   Frontend  │  React + Vite + Tailwind
                    │  (Nginx)    │  Porta 3000
                    └──────┬──────┘
                           │ /api/* (proxy)
                    ┌──────▼──────┐
                    │   Backend   │  Express.js
                    │   (API)     │  Porta 3000
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌──▼───┐ ┌──────▼──────┐
       │  PostgreSQL  │ │OpenAI│ │     n8n     │
       │  (Supabase)  │ │ API  │ │  (WhatsApp) │
       └─────────────┘ └──────┘ └─────────────┘
```

- **Frontend** serve arquivos estaticos via Nginx e faz proxy de `/api/*` para o backend
- **Backend** e uma REST API que conecta ao banco e a OpenAI
- **n8n** gerencia comunicacao via WhatsApp (recebe arquivos, envia notificacoes) e chama os endpoints HTTP da API
- **WhatsApp NAO e gerenciado pela aplicacao** — todo o fluxo de mensagens e feito pelo n8n

---

## Stack

### Backend (API)
- **Runtime:** Node.js 20
- **Framework:** Express.js
- **Banco:** PostgreSQL via conexao direta (pg) + Supabase SDK como fallback
- **IA:** OpenAI (GPT-4.1-mini para volume, GPT-4.1 para qualidade)
- **Docker:** Node.js Alpine com healthcheck

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **UI:** Tailwind CSS + shadcn/ui (Radix UI)
- **State:** TanStack Query + Zustand
- **Routing:** React Router DOM
- **Icons:** Lucide React
- **Datas:** date-fns (pt-BR)
- **Docker:** Multi-stage (Node build + Nginx)

---

## Setup Local

### 1. Clonar e instalar

```bash
git clone https://github.com/doni010520/pm-ia-consultorias.git
cd pm-ia-consultorias

# Backend
cd api && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configurar variaveis de ambiente

**Backend** (`api/.env`):
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@host:5432/pmia
DEFAULT_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001
OPENAI_API_KEY=sk-...
```

Se usar Supabase sem DATABASE_URL:
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

> **Importante:** As rotas de alertas, projetos e relatorios usam SQL direto via `query()`, que requer `DATABASE_URL`. Sem ela, essas rotas retornam erro 500. A conexao Supabase SDK so funciona para funcoes especificas em `database.js` (createTask, getTasks, etc.).

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:3000
VITE_DEFAULT_ORG_ID=00000000-0000-0000-0000-000000000001
```

### 3. Criar banco de dados

Executar o schema no PostgreSQL:
```bash
psql $DATABASE_URL < database/schema.sql
```

Ou no Supabase: SQL Editor → colar conteudo de `database/schema.sql` → executar.

### 4. Dados iniciais

```sql
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Minha Consultoria', 'minha-consultoria');

INSERT INTO users (organization_id, name, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin@email.com', 'admin');
```

### 5. Iniciar

```bash
# Backend (porta 3000)
cd api && npm start

# Frontend (porta 5173 com proxy para API)
cd frontend && npm run dev
```

### 6. Verificar

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"...","version":"1.0.0"}
```

---

## Endpoints da API (22 rotas)

### Health Check

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/health` | Status da API |

---

### Projetos (`/api/projects`) — 9 rotas

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/projects` | Listar projetos |
| GET | `/api/projects/:id` | Detalhes de um projeto |
| POST | `/api/projects` | Criar projeto |
| PATCH | `/api/projects/:id` | Atualizar projeto |
| GET | `/api/projects/:id/metrics` | Metricas do projeto |
| GET | `/api/projects/:id/risk-analysis` | Analise de risco com IA |
| POST | `/api/projects/check-risks` | Verificar riscos de todos os projetos |
| GET | `/api/projects/:id/tasks` | Tarefas do projeto |
| GET | `/api/projects/:id/time-entries` | Horas registradas |

#### GET /api/projects
Query: `organization_id`, `client_id`, `status` (active, paused, completed, cancelled)

```json
{ "projects": [{ "id": "uuid", "name": "...", "status": "active", "client_name": "...", "total_tasks": 10, "completed_tasks": 3 }], "count": 1 }
```

#### POST /api/projects
```json
{ "name": "Nome do Projeto", "description": "...", "client_id": "uuid", "start_date": "2026-03-15", "due_date": "2026-06-15", "budget_hours": 200, "budget_value": 30000, "billing_type": "hourly" }
```

#### PATCH /api/projects/:id
Campos opcionais: `name`, `description`, `status`, `priority`, `start_date`, `due_date`, `completed_at`, `budget_hours`, `budget_value`, `billing_type`, `progress_percent`, `client_id`, `settings`

#### GET /api/projects/:id/risk-analysis
Analisa riscos usando GPT-4.1. Retorna metricas + analise textual da IA.

#### POST /api/projects/check-risks
Verifica todos os projetos ativos. Gera alertas para projetos com burn_rate > 0.8, overdue_ratio > 0.3, ou deadline < 7 dias. Ideal para cron diario via n8n.

---

### Tarefas (`/api/tasks`) — 6 rotas

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/tasks` | Listar tarefas |
| POST | `/api/tasks` | Criar tarefa |
| POST | `/api/tasks/extract` | Extrair tarefa de texto com IA |
| POST | `/api/tasks/from-extraction` | Criar tarefa a partir de extracao |
| PATCH | `/api/tasks/:id` | Atualizar tarefa |
| PATCH | `/api/tasks/:id/status` | Atualizar status |

#### GET /api/tasks
Query: `organization_id`, `project_id`, `assignee_id`, `status` (todo, in_progress, review, done, cancelled), `limit`

#### POST /api/tasks/extract
Extrai tarefa de texto livre usando GPT-4.1-mini. Identifica titulo, responsavel, prazo e prioridade.
```json
{ "message": "Pedro precisa entregar o relatorio financeiro ate sexta", "organization_id": "uuid", "sender_name": "Joao" }
```

#### PATCH /api/tasks/:id/status
```json
{ "status": "done" }
```
Status: `todo`, `in_progress`, `review`, `done`, `cancelled`

---

### Transcricoes (`/api/transcriptions`) — 6 rotas

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/transcriptions/upload` | Upload de transcricao |
| GET | `/api/transcriptions` | Listar transcricoes |
| GET | `/api/transcriptions/:chave` | Detalhe de uma transcricao |
| POST | `/api/transcriptions/:chave/confirm` | Processar transcricao com IA |
| GET | `/api/transcriptions/atas/list` | Listar atas de reuniao |
| GET | `/api/transcriptions/atas/:id` | Detalhe da ata |

#### POST /api/transcriptions/upload
Nome do arquivo deve seguir o padrao: `[Cliente][Projeto][Consultor][Data].txt`
```json
{ "fileName": "[Empresa ABC][Transformacao Digital][Joao Silva][15032026].txt", "content": "Texto da transcricao...", "organization_id": "uuid", "auto_confirm": false }
```
- `auto_confirm: true` — processa imediatamente com IA
- `auto_confirm: false` — salva como pendente, aguarda confirmacao

#### POST /api/transcriptions/:chave/confirm
Processa a transcricao com IA (GPT-4.1-mini) e cria automaticamente:
- Projeto (ou encontra existente)
- Ata de reuniao com resumo
- Acoes com responsavel e prazo
- Decisoes com impacto
- Riscos com probabilidade, impacto e mitigacao

---

### Alertas e Notificacoes (`/api/alerts`) — 3 rotas

Endpoints para alimentar tela de notificacoes e integracao com n8n.

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/alerts/today` | Tarefas do dia |
| GET | `/api/alerts/overdue` | Tarefas atrasadas |
| GET | `/api/alerts/summary` | Resumo consolidado |

Todos aceitam: `organization_id`, `project_id`, `assignee_id`

#### GET /api/alerts/summary
Resumo ideal para n8n montar mensagem de notificacao diaria:
```json
{
  "date": "2026-03-15",
  "today": { "tasks": [...], "total": 2 },
  "overdue": { "tasks": [...], "total": 1 },
  "upcoming_7_days": { "tasks": [...], "total": 5 },
  "risky_projects": { "projects": [...], "total": 1 }
}
```

---

### Relatorios (`/api/reports`) — 3 rotas

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/reports` | Listar relatorios |
| POST | `/api/reports/generate` | Gerar relatorio com IA |
| GET | `/api/reports/:id` | Detalhe de um relatorio |

#### POST /api/reports/generate
Gera relatorio executivo usando GPT-4.1.
```json
{ "project_id": "uuid", "organization_id": "uuid", "type": "weekly_status", "period_start": "2026-03-08", "period_end": "2026-03-15" }
```
Tipos: `weekly_status`, `monthly_closing`, `executive_summary`

---

## Integracao com n8n

A aplicacao foi projetada para funcionar com n8n, que gerencia toda a comunicacao via WhatsApp.

### Fluxo de transcricao
```
1. Usuario envia .txt pelo WhatsApp
2. n8n recebe e faz INSERT direto no PostgreSQL (tabela transcricoes_pendentes)
3. n8n pede confirmacao ao usuario
4. Usuario confirma → n8n chama POST /api/transcriptions/:chave/confirm
5. API processa com IA → cria projeto + ata + acoes/decisoes/riscos
6. n8n recebe resposta → envia resumo pelo WhatsApp
```

### Notificacoes diarias
```
n8n (Cron 8h):
  1. GET /api/alerts/summary → recebe resumo
  2. Formata mensagem
  3. Envia para gestores via WhatsApp
```

### Verificacao de riscos
```
n8n (Cron 9h):
  1. POST /api/projects/check-risks → analisa todos os projetos
  2. Se houver alertas → envia via WhatsApp
```

---

## Frontend — Paginas

| Pagina | Rota | Descricao |
|--------|------|-----------|
| Dashboard | `/` | Cards resumo, projetos em risco, tarefas do dia |
| Projetos | `/projects` | Grid de projetos com filtro por status, criar projeto |
| Detalhe Projeto | `/projects/:id` | Metricas, kanban de tarefas, analise de risco com IA |
| Tarefas | `/tasks` | Kanban (A Fazer, Em Andamento, Revisao, Concluido) |
| Atas | `/atas` | Lista de atas com contadores de acoes/decisoes/riscos |
| Detalhe Ata | `/atas/:id` | Markdown renderizado + tabs (Acoes, Decisoes, Riscos) |
| Alertas | `/alerts` | Tabs: Hoje, Atrasadas, Proximos 7 dias |
| Relatorios | `/reports` | Lista + gerar relatorio (semanal/mensal/executivo) |
| Equipe | `/team` | Membros com stats de tarefas |

---

## Banco de Dados

### Tabelas principais

| Tabela | Descricao |
|--------|-----------|
| `organizations` | Multi-tenant |
| `users` | Membros da equipe |
| `clients` | Clientes |
| `projects` | Projetos com orcamento e progresso |
| `project_members` | Membros por projeto |
| `tasks` | Tarefas com status, prioridade, responsavel |
| `time_entries` | Registro de horas |
| `ai_interactions` | Log de chamadas a IA |
| `risk_alerts` | Alertas de risco |
| `reports` | Relatorios gerados |
| `transcricoes_pendentes` | Fila de transcricoes (usada pelo n8n) |
| `atas` | Atas de reuniao |
| `ata_acoes` | Acoes extraidas |
| `ata_decisoes` | Decisoes registradas |
| `ata_riscos` | Riscos identificados |

### Views
- `v_project_status` — Status resumido de projetos com contadores
- `v_user_workload` — Carga de trabalho por usuario

### Funcoes
- `find_user_by_name(org_id, name)` — Busca fuzzy de usuario por nome
- `calculate_project_risk(project_id)` — Calcula metricas de risco

---

## Estrutura do Projeto

```
pm-ia-consultorias/
├── api/
│   ├── Dockerfile              # Node.js 20 Alpine + healthcheck
│   ├── .dockerignore
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.js            # Servidor Express (porta 3000)
│       ├── routes/
│       │   ├── projects.js     # CRUD projetos + analise de risco
│       │   ├── tasks.js        # CRUD tarefas + extracao com IA
│       │   ├── reports.js      # Geracao de relatorios com IA
│       │   ├── transcriptions.js # Upload e processamento de transcricoes
│       │   └── alerts.js       # Alertas e notificacoes
│       └── services/
│           ├── ai.js           # OpenAI (GPT-4.1-mini + GPT-4.1)
│           ├── database.js     # PostgreSQL direto + Supabase SDK
│           └── transcription.js # Orquestracao de transcricoes
├── frontend/
│   ├── Dockerfile              # Multi-stage: Node build + Nginx
│   ├── nginx.conf              # Proxy /api/* para backend, SPA fallback
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── components/
│       │   ├── ui/             # shadcn: Button, Card, Dialog, Badge, etc
│       │   ├── layout/         # Sidebar, Header, PageContainer
│       │   └── shared/         # StatusBadge, PriorityBadge, MarkdownRenderer
│       ├── pages/              # Dashboard, Projects, Tasks, Atas, Alerts, Reports, Team
│       ├── hooks/              # useProjects, useTasks, useAtas, useAlerts, useReports
│       ├── services/api.ts     # Fetch wrapper para /api/*
│       ├── types/index.ts      # Interfaces TypeScript
│       └── App.tsx             # Router + Layout
├── database/
│   └── schema.sql              # Schema completo do PostgreSQL
├── prompts/
│   ├── processar_transcricao.txt
│   ├── extrair_tarefa.txt
│   ├── analisar_risco.txt
│   └── gerar_relatorio.txt
├── n8n-workflows/
│   └── 01_criar_tarefa.json
├── DEPLOY_EASYPANEL.md
└── README.md
```

---

## Deploy (Easypanel)

### Pre-requisitos
- Easypanel instalado na VPS
- Conta Supabase (ou PostgreSQL proprio)
- Chave OpenAI

### Backend (`pm-ia-api`)

1. Nova app no Easypanel → GitHub → `doni010520/pm-ia-consultorias`
2. Branch: `main`, Build Path: `/api`
3. Build type: Dockerfile

**Variaveis de ambiente:**

| Variavel | Valor |
|----------|-------|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://postgres.xxx:senha@pooler.supabase.com:6543/postgres` |
| `DEFAULT_ORGANIZATION_ID` | `00000000-0000-0000-0000-000000000001` |
| `OPENAI_API_KEY` | `sk-...` |

Opcionais (se usar Supabase SDK tambem):
| `SUPABASE_URL` | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJ...` |

Porta do dominio: **3000**

### Frontend (`pm-ia-frontend`)

1. Nova app no Easypanel → GitHub → `doni010520/pm-ia-consultorias`
2. Branch: `main`, Build Path: `/frontend`
3. Build type: Dockerfile

**Build Args:**

| Variavel | Valor |
|----------|-------|
| `VITE_API_URL` | (vazio — nginx faz proxy) |
| `VITE_DEFAULT_ORG_ID` | `00000000-0000-0000-0000-000000000001` |

Porta do dominio: **3000** (Nginx escuta na 3000)

### Rede Interna

O Nginx do frontend faz proxy de `/api/*` para `pm-ia-api:3000`. Para funcionar:
- Ambas as apps devem estar no **mesmo projeto** no Easypanel
- O nome da app backend **deve ser** `pm-ia-api` (corresponde ao `proxy_pass` no `nginx.conf`)
- Se usar outro nome, editar `frontend/nginx.conf`:
  ```
  proxy_pass http://NOME-DA-SUA-APP:3000;
  ```

### Supabase — Connection String

Para obter a `DATABASE_URL` do Supabase:
1. Settings → Database → Connection string → URI
2. Selecionar modo Transaction (porta 6543)
3. Substituir `[YOUR-PASSWORD]` pela senha do banco (sem colchetes)
4. Se esqueceu a senha: Settings → Database → Reset database password

### Verificacao

```bash
# Backend
curl https://api.seudominio.com/health

# Frontend
# Acessar https://app.seudominio.com
```

---

## Prompts de IA

Os prompts ficam em `/prompts/` e sao carregados em tempo de execucao:

| Arquivo | Uso | Modelo |
|---------|-----|--------|
| `processar_transcricao.txt` | Processar transcricao de reuniao → ata + acoes + decisoes + riscos | GPT-4.1-mini |
| `extrair_tarefa.txt` | Extrair tarefa de mensagem de texto livre | GPT-4.1-mini |
| `analisar_risco.txt` | Analisar riscos de um projeto | GPT-4.1 |
| `gerar_relatorio.txt` | Gerar relatorio executivo | GPT-4.1 |

O formato de saida do processamento de transcricao e `JSON|||MARKDOWN` — a IA retorna dados estruturados (JSON) separados do conteudo da ata (Markdown) pelo delimitador `|||`.

---

## Licenca

Projeto privado de uso interno.
