// Wrapper para subir o servidor MCP do n8n.
// As credenciais vêm do ambiente — nunca hardcode a chave aqui (o repo é público).
const N8N_API_URL = process.env.N8N_API_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_API_URL || !N8N_API_KEY) {
  console.error(
    'Erro: defina N8N_API_URL e N8N_API_KEY no ambiente antes de iniciar o n8n-mcp.\n' +
    'Ex (PowerShell): $env:N8N_API_URL="https://seu-n8n.exemplo.com"; $env:N8N_API_KEY="..."\n' +
    'Ex (bash):       export N8N_API_URL=https://seu-n8n.exemplo.com N8N_API_KEY=...'
  );
  process.exit(1);
}

process.env.MCP_MODE = 'stdio';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_CONSOLE_OUTPUT = 'true';

require('child_process').execFileSync('npx', ['n8n-mcp'], {
  stdio: 'inherit',
  env: process.env
});
