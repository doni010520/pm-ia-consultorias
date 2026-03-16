# Deploy PM-IA no Easypanel

Guia para deploy do sistema PM-IA (API + Frontend) no Easypanel.

## Pre-requisitos

- Easypanel instalado na VPS
- Repositorio GitHub: `https://github.com/doni010520/pm-ia-consultorias.git`
- Chave de API: OpenAI

---

## 1. Banco de Dados

### Opcao A: PostgreSQL no Easypanel

1. No Easypanel, criar novo servico **PostgreSQL**
2. Anotar a connection string gerada (formato: `postgresql://user:pass@host:5432/dbname`)
3. Acessar o banco e executar o schema:

```bash
psql $DATABASE_URL < database/schema.sql
```

### Opcao B: Supabase

1. Criar projeto no Supabase (https://supabase.com)
2. Ir em **SQL Editor** e colar o conteudo de `database/schema.sql`
3. Executar
4. Copiar a connection string em **Settings > Database > Connection string > URI**

---

## 2. Criar App Backend: `pm-ia-api`

1. No Easypanel, clicar **+ New Resource** > **App**
2. Nome: `pm-ia-api`
3. Source: **GitHub** > selecionar repositorio `pm-ia-consultorias`
4. **Build Path**: `projeto-pm-ia/api`
5. Build type: **Dockerfile** (vai usar o `api/Dockerfile`)

### Variaveis de ambiente (API)

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `NODE_ENV` | `production` | Ambiente |
| `DATABASE_URL` | `postgresql://...` | Connection string do PostgreSQL |
| `DEFAULT_ORGANIZATION_ID` | `uuid` | ID da organizacao padrao |
| `OPENAI_API_KEY` | `sk-...` | Chave da API OpenAI |

### Configuracoes

- **Port**: 3000
- **Health Check**: `/health` (ja configurado no Dockerfile)
- **Dominio**: configurar subdominio (ex: `api.seudominio.com`) ou usar interno

---

## 3. Criar App Frontend: `pm-ia-frontend`

1. No Easypanel, clicar **+ New Resource** > **App**
2. Nome: `pm-ia-frontend`
3. Source: **GitHub** > selecionar repositorio `pm-ia-consultorias`
4. **Build Path**: `projeto-pm-ia/frontend`
5. Build type: **Dockerfile** (vai usar o `frontend/Dockerfile`)

### Build Args (Frontend)

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `VITE_API_URL` | (vazio) | Deixar vazio - o nginx faz proxy para `/api/` |
| `VITE_DEFAULT_ORG_ID` | `uuid` | Mesmo ID usado no backend |

### Configuracoes

- **Port**: 80
- **Dominio**: configurar dominio principal (ex: `app.seudominio.com`)

---

## 4. Rede Interna

O frontend (nginx) faz proxy de `/api/*` para `pm-ia-api:3000`. Para isso funcionar:

- Ambas as apps devem estar no **mesmo projeto** no Easypanel
- O nome da app backend **deve ser** `pm-ia-api` (corresponde ao `proxy_pass` no `nginx.conf`)
- Se usar outro nome, editar `frontend/nginx.conf` na linha:
  ```
  proxy_pass http://NOME-DA-SUA-APP:3000;
  ```

---

## 5. Verificacao

### Backend
```bash
curl https://api.seudominio.com/health
# Resposta: {"status":"ok","timestamp":"...","version":"1.0.0"}
```

### Frontend
Acessar `https://app.seudominio.com` no navegador. Deve carregar o dashboard.

### Testar integracao
1. Acessar a pagina de Projetos
2. Criar um projeto de teste
3. Se aparecer na lista, o frontend esta conectado ao backend

---

## 6. Dados Iniciais

Apos o deploy, criar a organizacao e um usuario no banco:

```sql
-- Criar organizacao
INSERT INTO organizations (id, name, slug)
VALUES ('00000000-0000-0000-0000-000000000001', 'Minha Consultoria', 'minha-consultoria');

-- Criar usuario admin
INSERT INTO users (organization_id, name, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'Admin', 'admin@email.com', 'admin');
```

---

## Troubleshooting

| Problema | Solucao |
|----------|---------|
| Frontend nao conecta na API | Verificar se ambas apps estao no mesmo projeto Easypanel |
| Erro 502 no `/api/` | Verificar se o backend esta rodando e o nome da app e `pm-ia-api` |
| Erro de banco | Verificar `DATABASE_URL` e se o schema foi executado |
| Build do frontend falha | Verificar se os Build Args `VITE_*` estao configurados |
| IA nao funciona | Verificar `OPENAI_API_KEY` |
