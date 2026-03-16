# Instruções para Claude Code - Sistema de Gestão de Projetos com IA

## Contexto do Projeto

Este é um sistema de gestão de projetos para consultorias empresariais com 4 funcionalidades de IA integradas via WhatsApp:

1. **Criar Tarefas via WhatsApp** - Extrai responsável, prazo e descrição de mensagens
2. **Assistente de Status** - Responde consultas sobre projetos via chat
3. **Previsão de Riscos** - Alertas automáticos sobre projetos em risco
4. **Relatórios Automáticos** - Gera relatórios executivos para clientes

## Stack Tecnológica

- **Backend**: Node.js/Express
- **Banco de Dados**: PostgreSQL (Supabase)
- **WhatsApp**: Qualquer API (Evolution, Uazapi, Z-API, CodeChat, etc.)
- **IA**: OpenAI GPT-4.1-mini (volume) + GPT-4.1 (qualidade)
- **Frontend**: React + Tailwind CSS (a ser implementado)

## Arquitetura

Toda a lógica de orquestração é feita diretamente pela API Express, sem dependência de ferramentas externas como n8n. Os endpoints HTTP podem ser chamados por qualquer cliente (frontend, cron, webhook externo).

## Estrutura de Arquivos

```
projeto-pm-ia/
├── CLAUDE_CODE_INSTRUCTIONS.md  # Este arquivo
├── database/
│   └── schema.sql               # Schema completo do PostgreSQL
├── n8n-workflows/               # Referência histórica (não mais utilizado)
│   └── 01_criar_tarefa.json
├── prompts/
│   ├── extrair_tarefa.txt       # Prompt para extração de tarefas
│   ├── classificar_intencao.txt # Prompt para classificação de intenção
│   ├── analisar_risco.txt       # Prompt para análise de risco
│   └── gerar_relatorio.txt      # Prompt para relatórios
├── api/
│   ├── package.json             # Dependências Node.js
│   ├── .env.example             # Template de variáveis de ambiente
│   └── src/
│       ├── index.js             # Entry point da API
│       ├── routes/
│       │   ├── tasks.js         # CRUD de tarefas + extração IA
│       │   ├── projects.js      # Projetos + análise de riscos
│       │   ├── reports.js       # Relatórios + envio WhatsApp
│       │   └── webhook.js       # Webhook WhatsApp (processamento completo)
│       └── services/
│           ├── ai.js            # Serviço de IA (OpenAI)
│           ├── whatsapp.js      # Serviço WhatsApp (multi-provider)
│           └── database.js      # Conexão PostgreSQL + operações
└── frontend/
    └── (a ser implementado)
```

## Endpoints da API

### Tarefas (`/api/tasks`)
- `GET /` - Listar tarefas (filtros: org_id, project_id, assignee_id, status)
- `POST /` - Criar tarefa manualmente
- `POST /extract` - Extrair tarefa de texto com IA
- `POST /from-extraction` - Criar tarefa a partir de extração IA
- `PATCH /:id` - Atualizar tarefa (título, descrição, prazo, prioridade, responsável)
- `PATCH /:id/status` - Atualizar status (todo, in_progress, review, done, cancelled)

### Projetos (`/api/projects`)
- `GET /` - Listar projetos com contagem de tarefas
- `GET /:id` - Detalhes do projeto
- `GET /:id/metrics` - Métricas para análise de risco
- `GET /:id/risk-analysis` - Análise de risco com IA
- `GET /:id/tasks` - Tarefas do projeto
- `GET /:id/time-entries` - Registros de tempo
- `POST /` - Criar projeto
- `POST /check-risks` - Verificar riscos de todos os projetos ativos (para cron)

### Relatórios (`/api/reports`)
- `GET /` - Listar relatórios gerados
- `POST /generate` - Gerar relatório (weekly_status, monthly_closing, executive_summary)
- `GET /:id` - Detalhes do relatório
- `POST /:id/send` - Enviar relatório via WhatsApp

### Webhook (`/webhook`)
- `POST /whatsapp` - Recebe mensagens de qualquer API de WhatsApp e processa automaticamente

## Tarefas para Claude Code

### Fase 1: Setup do Banco de Dados
1. Executar `database/schema.sql` no Supabase
2. Verificar se todas as tabelas foram criadas
3. Inserir dados de teste (1 organização, 1 projeto, 3 membros)

### Fase 2: Configurar API Backend
1. Navegar para `api/`
2. Executar `npm install`
3. Configurar variáveis de ambiente (ver `.env.example`)
4. Testar endpoints básicos

### Fase 3: Integração WhatsApp
1. Escolher API de WhatsApp (Evolution, Uazapi, Z-API, CodeChat, etc.)
2. Configurar `WHATSAPP_PROVIDER`, `WHATSAPP_API_URL`, `WHATSAPP_API_TOKEN` no `.env`
3. Apontar o webhook do provedor para `POST /webhook/whatsapp`
4. Testar envio de mensagem de teste
5. Verificar se tarefa é criada no banco

### Fase 4: Monitoramento de Riscos
1. Configurar cron externo para chamar `POST /api/projects/check-risks` diariamente
2. Testar com `notify_whatsapp: true` para alertas aos gestores

### Fase 5: Frontend React
1. Implementar dashboard com visão de projetos e tarefas
2. Integrar com endpoints da API

## Variáveis de Ambiente Necessárias

```env
# Banco de Dados
DATABASE_URL=postgresql://user:pass@host:5432/db
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx

# IA (somente OpenAI)
OPENAI_API_KEY=sk-xxx

# WhatsApp (qualquer provider)
WHATSAPP_PROVIDER=evolution  # evolution | uazapi | zapi | codechat | generic
WHATSAPP_API_URL=https://sua-api-whatsapp.com
WHATSAPP_API_TOKEN=xxx
WHATSAPP_API_INSTANCE=xxx
```

## Ordem de Implementação Recomendada

1. ✅ Schema do banco (já fornecido)
2. ✅ API com CRUD completo de tarefas
3. ✅ Webhook WhatsApp com processamento direto
4. ✅ Assistente de Status via WhatsApp
5. ✅ Alertas de Risco via endpoint HTTP
6. ✅ Relatórios com envio via WhatsApp
7. ⏳ Frontend React

## Notas Importantes

- Todos os cálculos matemáticos devem ser feitos em JavaScript, NUNCA no LLM
- Usar GPT-4.1-mini para operações de alto volume (criar tarefas, classificar)
- Usar GPT-4.1 para qualidade (relatórios, análises de risco)
- Sempre validar extração do LLM antes de inserir no banco
- Manter logs de todas as interações para debugging
- Conversas pendentes de confirmação são persistidas no banco (tabela whatsapp_conversations), com timeout de 5 minutos
