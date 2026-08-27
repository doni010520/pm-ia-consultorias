# docs/

Exports históricos dos workflows do n8n (`n8n-*.json`) e versões dos prompts da
Rica (`prompt-rica-*.md`). São material de referência: registram como o
roteamento de leads e as tools do CRM funcionavam, mas **não** são a
configuração em execução — importar qualquer um destes arquivos direto no n8n
não reproduz o ambiente atual.

## Dados de contato removidos

Os arquivos `n8n-designar-lead-v2.json` e `n8n-notificar-equipe-v2.json` traziam
emails e celulares reais dos executivos dentro dos nós `n8n-nodes-base.code`.
Como o repositório é público, esses valores foram substituídos pelos
placeholders `<EMAIL_EXECUTIVO>` e `<TELEFONE_EXECUTIVO>`. Os nomes próprios
foram mantidos para a lógica de direcionamento continuar legível.

Se for reaproveitar algum desses workflows, preencha os contatos a partir da
fonte de verdade — nunca comite os valores reais de volta aqui.

## Fonte de verdade

Os dados de contato dos executivos vivem hoje nas variáveis de ambiente `EXEC_*`
do repositório `rica-bot`, não neste repositório.
