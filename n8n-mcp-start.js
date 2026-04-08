process.env.MCP_MODE = 'stdio';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_CONSOLE_OUTPUT = 'true';
process.env.N8N_API_URL = 'https://criadordigital-n8n-editor.zsvt2k.easypanel.host';
process.env.N8N_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI4ZTRmZTg2NS02ZDRlLTQ2ZGYtYTBlYi1lZTM1ZWEzOTk4MzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzc1NjU5NDY2LCJleHAiOjE3NzgyMDkyMDB9.60oOAnp2eypywCvpxLKMEA7kVuFOE2DTndEf53wzS1g';

require('child_process').execFileSync('npx', ['n8n-mcp'], {
  stdio: 'inherit',
  env: process.env
});
