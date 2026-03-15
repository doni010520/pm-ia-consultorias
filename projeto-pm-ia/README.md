# PM-IA - Sistema de Gestao de Projetos com IA

Sistema completo (API + Frontend) para gestao de projetos de consultoria com processamento inteligente de transcricoes de reuniao. Recebe arquivos `.txt` de transcricoes, processa com IA (GPT-4.1-mini) e cria automaticamente projetos, atas, acoes, decisoes e riscos no PostgreSQL. Substitui o Notion como ferramenta de gestao.

## Stack

### Backend (API)
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Banco:** PostgreSQL (ou Supabase)
- **IA:** OpenAI (GPT-4.1-mini) + Anthropic (Claude Sonnet)

### Frontend
- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **UI:** Tailwind CSS + shadcn/ui (Radix UI)
- **State:** TanStack Query + Zustand
- **Routing:** React Router DOM
- **Icons:** Lucide React
- **Datas:** date-fns (pt-BR)

## Setup

### 1. Clonar e instalar

```bash
git clone https://github.com/doni010520/pm-ia-consultorias.git
cd pm-ia-consultorias/projeto-pm-ia

# Backend
cd api && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configurar variaveis de ambiente

```bash
cp .env.example .env
```

Editar `.env`:

```env
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/pmia
DEFAULT_ORGANIZATION_ID=00000000-0000-0000-0000-000000000001
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
NODE_ENV=production
```

### 3. Criar banco de dados

Executar o schema no PostgreSQL:

```bash
psql $DATABASE_URL < ../database/schema.sql
```

### 4. Iniciar Backend

```bash
cd api

# Producao
npm start

# Desenvolvimento (com hot reload)
npm run dev
```

### 5. Iniciar Frontend

```bash
cd frontend

# Desenvolvimento (porta 5173, proxy para API na porta 3000)
npm run dev

# Build para producao
npm run build
```

### 6. Verificar

```bash
# API
curl http://localhost:3000/health

# Frontend
# Acessar http://localhost:5173
```

---

## Endpoints

### Health Check

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/health` | Status da API |

---

### Projetos (`/api/projects`)

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

Lista todos os projetos da organizacao.

**Query params:**
- `organization_id` (opcional, usa DEFAULT_ORGANIZATION_ID)
- `client_id` - filtrar por cliente
- `status` - filtrar por status (active, paused, completed, cancelled)

**Resposta:**
```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "Transformacao Digital ABC",
      "status": "active",
      "client_name": "Empresa ABC",
      "total_tasks": 10,
      "completed_tasks": 3,
      "progress_percent": 30,
      "budget_hours": 200,
      "due_date": "2026-05-15"
    }
  ],
  "count": 1
}
```

#### POST /api/projects

Cria um novo projeto.

**Body:**
```json
{
  "name": "Nome do Projeto",
  "description": "Descricao do projeto",
  "client_id": "uuid-do-cliente",
  "organization_id": "uuid-da-org",
  "start_date": "2026-03-15",
  "due_date": "2026-06-15",
  "budget_hours": 200,
  "budget_value": 30000,
  "billing_type": "hourly"
}
```

#### PATCH /api/projects/:id

Atualiza campos de um projeto. Envie apenas os campos que deseja alterar.

**Body (todos opcionais):**
```json
{
  "name": "Novo nome",
  "description": "Nova descricao",
  "status": "paused",
  "priority": "high",
  "start_date": "2026-03-15",
  "due_date": "2026-07-15",
  "budget_hours": 250,
  "budget_value": 40000,
  "billing_type": "fixed",
  "progress_percent": 45,
  "client_id": "uuid",
  "settings": {}
}
```

#### GET /api/projects/:id/metrics

Retorna metricas calculadas do projeto.

**Resposta:**
```json
{
  "metrics": {
    "burn_rate": 0.65,
    "overdue_ratio": 0.15,
    "days_to_deadline": 45,
    "progress_percent": 30,
    "total_tasks": 10,
    "overdue_tasks": 2,
    "spent_hours": 130,
    "budget_hours": 200,
    "risk_score": 0.32
  }
}
```

#### GET /api/projects/:id/risk-analysis

Analisa riscos do projeto usando IA (Claude).

**Resposta:**
```json
{
  "project": { "id": "uuid", "name": "Projeto", "client": "Cliente" },
  "metrics": { "burn_rate": 0.85, "overdue_ratio": 0.3 },
  "analysis": "Analise detalhada da IA...",
  "model": "claude-sonnet-4-20250514",
  "latency_ms": 2500
}
```

#### POST /api/projects/check-risks

Verifica riscos de todos os projetos ativos. Ideal para cron diario.

**Body:**
```json
{
  "organization_id": "uuid"
}
```

**Resposta:**
```json
{
  "checked": 5,
  "alerts_generated": 2,
  "alerts": [
    {
      "project": { "id": "uuid", "name": "Projeto X", "client": "Cliente Y" },
      "severity": "yellow",
      "risk_score": 65,
      "alert_id": "uuid",
      "analysis": { "summary": "...", "recommended_actions": ["..."] }
    }
  ]
}
```

---

### Tarefas (`/api/tasks`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/tasks` | Listar tarefas |
| POST | `/api/tasks` | Criar tarefa |
| POST | `/api/tasks/extract` | Extrair tarefa de texto com IA |
| POST | `/api/tasks/from-extraction` | Criar tarefa a partir de extracao |
| PATCH | `/api/tasks/:id` | Atualizar tarefa |
| PATCH | `/api/tasks/:id/status` | Atualizar status da tarefa |

#### GET /api/tasks

**Query params:**
- `organization_id`
- `project_id` - filtrar por projeto
- `assignee_id` - filtrar por responsavel
- `status` - filtrar por status (todo, in_progress, review, done, cancelled)
- `limit` - limite de resultados (padrao: 50)

#### POST /api/tasks

**Body:**
```json
{
  "organization_id": "uuid",
  "project_id": "uuid",
  "title": "Implementar login",
  "description": "Criar tela de login com OAuth",
  "assignee_id": "uuid",
  "due_date": "2026-04-01",
  "priority": "high"
}
```

#### POST /api/tasks/extract

Extrai informacoes de tarefa a partir de texto livre usando IA.

**Body:**
```json
{
  "message": "Pedro precisa entregar o relatorio financeiro ate sexta",
  "organization_id": "uuid",
  "sender_name": "Joao"
}
```

**Resposta:**
```json
{
  "extracted": {
    "title": "Entregar relatorio financeiro",
    "assignee": "Pedro Costa",
    "due_date": "2026-03-21",
    "priority": "high",
    "confidence": 85
  }
}
```

#### PATCH /api/tasks/:id

**Body (todos opcionais):**
```json
{
  "title": "Novo titulo",
  "description": "Nova descricao",
  "assignee_id": "uuid",
  "due_date": "2026-04-15",
  "priority": "urgent",
  "status": "in_progress",
  "project_id": "uuid"
}
```

#### PATCH /api/tasks/:id/status

**Body:**
```json
{
  "status": "done"
}
```

Status possiveis: `todo`, `in_progress`, `review`, `done`, `cancelled`

---

### Transcricoes (`/api/transcriptions`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| POST | `/api/transcriptions/upload` | Upload de transcricao |
| GET | `/api/transcriptions` | Listar transcricoes |
| GET | `/api/transcriptions/:chave` | Detalhe de uma transcricao |
| POST | `/api/transcriptions/:chave/confirm` | Processar transcricao com IA |
| GET | `/api/transcriptions/atas/list` | Listar atas de reuniao |
| GET | `/api/transcriptions/atas/:id` | Detalhe da ata |

#### POST /api/transcriptions/upload

Envia uma transcricao para processamento. O nome do arquivo deve seguir o padrao `[Cliente][Projeto][Consultor][Data].txt`.

**Body:**
```json
{
  "fileName": "[Empresa ABC][Transformacao Digital][Joao Silva][15032026].txt",
  "content": "Texto completo da transcricao da reuniao...",
  "organization_id": "uuid",
  "auto_confirm": false
}
```

- `auto_confirm: true` - processa imediatamente com IA
- `auto_confirm: false` (padrao) - salva como pendente, aguarda confirmacao

**Resposta:**
```json
{
  "transcription": {
    "id": "uuid",
    "chave": "empresa_abc_transformacao_digital_joao_silva_2026-03-15",
    "status": "aguardando_confirmacao",
    "cliente_nome": "Empresa ABC",
    "projeto_nome": "Transformacao Digital",
    "consultor_nome": "Joao Silva",
    "data_reuniao": "2026-03-15"
  },
  "message": "Transcricao salva. Use POST /api/transcriptions/:chave/confirm para processar."
}
```

#### POST /api/transcriptions/:chave/confirm

Processa a transcricao com IA e cria automaticamente:
- Projeto (ou encontra existente)
- Ata de reuniao
- Acoes com responsavel e prazo
- Decisoes
- Riscos

**Body:**
```json
{
  "organization_id": "uuid"
}
```

**Resposta:**
```json
{
  "success": true,
  "project": { "id": "uuid", "name": "Transformacao Digital" },
  "ata": {
    "id": "uuid",
    "titulo": "Ata - Reuniao de Kickoff",
    "data_reuniao": "2026-03-15",
    "participantes": "Joao, Maria, Pedro",
    "resumo": "Reuniao de alinhamento inicial..."
  },
  "acoes": [
    {
      "descricao": "Levantar requisitos do modulo financeiro",
      "responsavel": "Pedro Costa",
      "prazo": "2026-03-22",
      "tipo": "Analise",
      "evidencia_minima": "Documento de requisitos"
    }
  ],
  "decisoes": [
    {
      "descricao": "Usar metodologia agil com sprints de 2 semanas",
      "responsavel": "Joao Silva",
      "impacto": "Alto"
    }
  ],
  "riscos": [
    {
      "descricao": "Equipe do cliente sem disponibilidade",
      "probabilidade": "Media",
      "impacto": "Alto",
      "mitigacao": "Agendar horarios fixos semanais"
    }
  ]
}
```

#### GET /api/transcriptions

**Query params:**
- `organization_id`
- `status` - filtrar por status (aguardando_confirmacao, processando, processado, erro)
- `limit` - limite (padrao: 50)

#### GET /api/transcriptions/atas/list

**Query params:**
- `organization_id`
- `project_id` - filtrar por projeto
- `limit` - limite (padrao: 50)

#### GET /api/transcriptions/atas/:id

Retorna ata completa com acoes, decisoes e riscos.

**Resposta:**
```json
{
  "id": "uuid",
  "titulo": "Ata - Reuniao de Kickoff",
  "data_reuniao": "2026-03-15",
  "participantes": "Joao, Maria, Pedro",
  "resumo": "...",
  "conteudo_markdown": "# Ata completa em markdown...",
  "project_name": "Transformacao Digital",
  "acoes": [...],
  "decisoes": [...],
  "riscos": [...]
}
```

---

### Alertas e Notificacoes (`/api/alerts`)

Endpoints para alimentar tela de notificacoes da app e integracao com n8n (envio via WhatsApp).

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/alerts/today` | Tarefas do dia |
| GET | `/api/alerts/overdue` | Tarefas atrasadas |
| GET | `/api/alerts/summary` | Resumo consolidado |

#### GET /api/alerts/today

**Query params:**
- `organization_id`
- `project_id` - filtrar por projeto
- `assignee_id` - filtrar por responsavel

**Resposta:**
```json
{
  "date": "2026-03-15",
  "tasks": [
    {
      "id": "uuid",
      "title": "Entregar relatorio",
      "priority": "high",
      "assignee_name": "Pedro Costa",
      "project_name": "Transformacao Digital",
      "client_name": "Empresa ABC"
    }
  ],
  "total": 1
}
```

#### GET /api/alerts/overdue

**Query params:**
- `organization_id`
- `project_id`
- `assignee_id`

**Resposta:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "title": "Revisar contrato",
      "priority": "urgent",
      "days_overdue": 3,
      "assignee_name": "Maria Santos",
      "project_name": "Transformacao Digital"
    }
  ],
  "total": 1
}
```

#### GET /api/alerts/summary

Resumo consolidado ideal para n8n montar mensagem de notificacao diaria.

**Query params:**
- `organization_id`
- `project_id` (opcional - filtra tarefas por projeto)

**Resposta:**
```json
{
  "date": "2026-03-15",
  "today": {
    "tasks": [{ "title": "...", "priority": "high", "assignee_name": "...", "project_name": "..." }],
    "total": 2
  },
  "overdue": {
    "tasks": [{ "title": "...", "priority": "urgent", "assignee_name": "...", "days_overdue": 3 }],
    "total": 1
  },
  "upcoming_7_days": {
    "tasks": [{ "title": "...", "due_date": "2026-03-20", "assignee_name": "..." }],
    "total": 5
  },
  "risky_projects": {
    "projects": [{ "name": "Projeto X", "overdue_tasks": 4, "total_open_tasks": 12 }],
    "total": 1
  }
}
```

---

### Relatorios (`/api/reports`)

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET | `/api/reports` | Listar relatorios gerados |
| POST | `/api/reports/generate` | Gerar relatorio com IA |
| GET | `/api/reports/:id` | Detalhe de um relatorio |

#### POST /api/reports/generate

Gera relatorio executivo usando Claude.

**Body:**
```json
{
  "project_id": "uuid",
  "organization_id": "uuid",
  "type": "weekly_status",
  "period_start": "2026-03-08",
  "period_end": "2026-03-15"
}
```

Tipos: `weekly_status`, `monthly_closing`, `executive_summary`

---

## Integracao com n8n

A aplicacao foi projetada para funcionar em conjunto com n8n, que gerencia o WhatsApp.

### Fluxo de transcricao

```
n8n (WhatsApp):
  1. Usuario envia .txt pelo WhatsApp
  2. n8n recebe e salva em transcricoes_pendentes (INSERT direto no PostgreSQL)
  3. n8n pede confirmacao ao usuario
  4. Usuario confirma → n8n chama POST /api/transcriptions/:chave/confirm
  5. App processa com IA → cria projeto + ata + acoes/decisoes/riscos
  6. n8n recebe resposta → envia resumo pelo WhatsApp
```

### Notificacoes diarias

```
n8n (Cron diario 8h):
  1. GET /api/alerts/summary → recebe resumo
  2. Formata mensagem para WhatsApp
  3. Envia para gestores
```

### Verificacao de riscos

```
n8n (Cron diario 9h):
  1. POST /api/projects/check-risks → analisa todos os projetos
  2. Se houver alertas, envia via WhatsApp
```

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
| `transcricoes_pendentes` | Fila de transcricoes |
| `atas` | Atas de reuniao |
| `ata_acoes` | Acoes extraidas |
| `ata_decisoes` | Decisoes registradas |
| `ata_riscos` | Riscos identificados |

### Views

- `v_project_status` - Status resumido de projetos com contadores
- `v_user_workload` - Carga de trabalho por usuario

### Funcoes

- `find_user_by_name(org_id, name)` - Busca fuzzy de usuario por nome
- `calculate_project_risk(project_id)` - Calcula metricas de risco

---

## Frontend - Paginas

| Pagina | Rota | Descricao |
|--------|------|-----------|
| Dashboard | `/` | Cards resumo (tarefas hoje, atrasadas, proximos 7 dias, projetos ativos), projetos em risco, tarefas do dia |
| Projetos | `/projects` | Grid de projetos com filtro por status, botao criar projeto, progresso visual |
| Detalhe Projeto | `/projects/:id` | Metricas (burn rate, horas, tarefas), kanban de tarefas, botao "Analisar Risco com IA" |
| Tarefas | `/tasks` | Kanban com drag-and-drop (A Fazer, Em Andamento, Revisao, Concluido), filtro por projeto |
| Atas | `/atas` | Lista de atas de reuniao com contadores de acoes/decisoes/riscos, filtro por projeto |
| Detalhe Ata | `/atas/:id` | Markdown renderizado + tabs (Acoes, Decisoes, Riscos) com detalhes completos |
| Alertas | `/alerts` | Tabs: Hoje, Atrasadas (com dias de atraso), Proximos 7 dias |
| Relatorios | `/reports` | Lista de relatorios gerados, botao "Gerar Relatorio" (semanal/mensal/executivo), visualizador markdown |
| Equipe | `/team` | Membros com stats de tarefas ativas, atrasadas e concluidas |

### Configuracao do Frontend

Criar `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000
VITE_DEFAULT_ORG_ID=00000000-0000-0000-0000-000000000001
```

Em desenvolvimento, o Vite faz proxy automatico de `/api/*` para `localhost:3000`.

---

## Estrutura do Projeto

```
projeto-pm-ia/
├── api/
│   ├── src/
│   │   ├── index.js              # Servidor Express
│   │   ├── routes/
│   │   │   ├── projects.js       # CRUD de projetos + analise de risco
│   │   │   ├── tasks.js          # CRUD de tarefas + extracao com IA
│   │   │   ├── reports.js        # Geracao de relatorios com IA
│   │   │   ├── transcriptions.js # Upload e processamento de transcricoes
│   │   │   └── alerts.js         # Alertas e notificacoes
│   │   └── services/
│   │       ├── ai.js             # OpenAI + Anthropic
│   │       ├── database.js       # PostgreSQL + Supabase
│   │       └── transcription.js  # Orquestracao de transcricoes
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/               # shadcn: Button, Card, Dialog, Badge, Tabs, etc
│   │   │   ├── layout/           # Sidebar, Header, PageContainer
│   │   │   └── shared/           # StatusBadge, PriorityBadge, MarkdownRenderer
│   │   ├── pages/                # Dashboard, Projects, Tasks, Atas, Alerts, Reports, Team
│   │   ├── hooks/                # useProjects, useTasks, useAtas, useAlerts, useReports
│   │   ├── services/api.ts       # Fetch wrapper para /api/*
│   │   ├── types/index.ts        # Interfaces TypeScript
│   │   ├── lib/utils.ts          # cn(), formatDate(), formatCurrency()
│   │   └── App.tsx               # Router + Layout
│   ├── package.json
│   └── .env.example
├── database/
│   └── schema.sql                # Schema completo do PostgreSQL
└── prompts/
    ├── processar_transcricao.txt  # Prompt PMO para transcricoes
    ├── extrair_tarefa.txt         # Extracao de tarefa de texto
    ├── analisar_risco.txt         # Analise de risco de projeto
    └── gerar_relatorio.txt        # Geracao de relatorio executivo
```

---

## Deploy (Easypanel)

### Backend (API)
1. Criar app no Easypanel apontando para o repo GitHub
2. Configurar build path: `projeto-pm-ia/api`
3. Adicionar servico PostgreSQL
4. Configurar variaveis de ambiente
5. Executar `schema.sql` no banco
6. Deploy

### Frontend
1. Criar app separada no Easypanel
2. Build path: `projeto-pm-ia/frontend`
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Configurar `VITE_API_URL` apontando para URL do backend
6. Deploy
