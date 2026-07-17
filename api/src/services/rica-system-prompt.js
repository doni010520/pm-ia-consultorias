import { query } from './database.js';

// Cache de funis por org (5min)
const pipelinesCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedPipelines(orgId) {
  const cached = pipelinesCache.get(orgId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const result = await query(
    `SELECT p.id, p.name,
            json_agg(json_build_object('id', ps.id, 'name', ps.name, 'position', ps.position, 'is_won', ps.is_won, 'is_lost', ps.is_lost)
                     ORDER BY ps.position) as stages
     FROM pipelines p
     LEFT JOIN pipeline_stages ps ON ps.pipeline_id = p.id
     WHERE p.organization_id = $1 AND p.is_active = true
     GROUP BY p.id, p.name
     ORDER BY p.position`,
    [orgId]
  );

  const data = result.rows;
  pipelinesCache.set(orgId, { data, ts: Date.now() });
  return data;
}

export function clearPipelinesCache(orgId) {
  pipelinesCache.delete(orgId);
}

// Snapshot da carteira do usuário (cache 60s para não repetir em mensagens rápidas)
const userSnapshotCache = new Map();
const SNAPSHOT_TTL = 60 * 1000;

async function getUserDealsSnapshot(user) {
  const key = `${user.organization_id}:${user.id}`;
  const cached = userSnapshotCache.get(key);
  if (cached && Date.now() - cached.ts < SNAPSHOT_TTL) return cached.data;

  try {
    const result = await query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open') AS open_count,
         COUNT(*) FILTER (WHERE status = 'open' AND temperature = 'hot') AS hot_count,
         COUNT(*) FILTER (WHERE status = 'won' AND won_date >= date_trunc('month', NOW())) AS won_this_month,
         COALESCE(SUM(value) FILTER (WHERE status = 'open'), 0) AS open_value
       FROM deals
       WHERE organization_id = $1 AND owner_id = $2`,
      [user.organization_id, user.id]
    );
    const data = result.rows[0] || null;
    userSnapshotCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/**
 * Prompt do COPILOTO no WhatsApp (endpoint /api/rica/chat/ask).
 *
 * Proposital e importante: NAO reaproveita buildSystemPrompt (o prompt do app).
 * Aquele prompt manda "SEMPRE pedir confirmacao antes de acoes que modificam
 * dados" e despeja a lista de funis/etapas com IDs — no WhatsApp isso fazia a
 * Rica ficar perguntando "quer que eu crie no funil X e defina responsavel?"
 * em loop, em vez de emitir a acao. Aqui, quem cria o lead, escolhe funil e
 * roteia o executivo e o rica-bot; o copiloto so reconhece a intencao e devolve
 * a action.
 */
export async function buildCopilotPrompt(user) {
  const now = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short',
  }).format(new Date());

  // Só os NOMES dos funis (sem IDs/etapas) — serve para relatórios, não para perguntar ao time.
  let funisNomes = '';
  try {
    const pipelines = await getCachedPipelines(user.organization_id);
    funisNomes = pipelines.map(p => p.name).join(', ');
  } catch { funisNomes = '(indisponível)'; }

  return `Você é a Rica, copiloto interno da equipe no WhatsApp.
Você está falando com ${user.name} (${user.role}) — é MEMBRO DO TIME, não é lead/cliente.
Data e hora: ${now} (Brasília)

FORMATO: responda CURTO e direto, como mensagem de WhatsApp. No máximo *negrito*. Sem tabelas, sem markdown pesado, sem listas longas.

═══ ENCAMINHAR LEAD (sua função mais importante) ═══
Quando o time pedir para ENVIAR / MANDAR / ENCAMINHAR / PASSAR um lead para alguém:
1. Chame a tool encaminhar_lead IMEDIATAMENTE assim que tiver TELEFONE + (NOME ou PRODUTO).
2. NUNCA pergunte sobre funil, etapa, responsável, ou "posso criar o lead?". Você NÃO cria lead,
   NÃO escolhe funil e NÃO define dono — quem faz isso é o sistema, depois da sua action.
3. NUNCA peça confirmação para encaminhar. Se ele pediu para encaminhar, é isso que ele quer.
4. Faça no máximo UMA pergunta, e SOMENTE se faltar o TELEFONE do lead. Sem telefone não dá para encaminhar.
5. Se em QUALQUER mensagem anterior o usuário já disse "sim", "pode", "isso", "confirma" ou
   equivalente, NÃO pergunte de novo — chame a tool na hora.
6. Se ele indicar o executivo ("manda pro André"), passe em executivo. Se não indicar, deixe
   VAZIO — o sistema roteia sozinho por produto/região. Não pergunte para quem enviar.
7. Os dados podem vir espalhados em várias mensagens: junte o que já foi dito no histórico.
Depois de chamar a tool, responda apenas uma confirmação curta (ex: "Encaminhando a Léa pra equipe certa ✅").

═══ CONSULTAS ═══
Você pode consultar dados (leads, tarefas, projetos, atas, capacidade, relatórios). Você NÃO altera nada
pelo WhatsApp — mudanças de etapa/edição de lead são feitas no app.

RELATÓRIOS — são duas coisas diferentes, não confunda:
1. ATENDIMENTOS NO WHATSAPP (quem CHEGOU / falou com a Rica) → tool relatorio_atendimentos.
   Use para "quantos leads chegaram", "quantos perguntaram sobre GPS", "quantos atendimentos hoje".
2. LEADS NO CRM / NO FUNIL → tool relatorio_leads.
   pipeline_name = funil, owner_name = executivo, source "whatsapp" = veio pela Rica.
Muita gente que pergunta de GPS ainda está em "Entrada de Leads", não no funil "GPS" — então os
números não batem. Na dúvida, prefira relatorio_atendimentos ou reporte os dois explicando a diferença.
Períodos: "essa semana" = "semana", "este mês" = "mes".
Funis existentes (só para relatórios): ${funisNomes || '(nenhum)'}

Quando ele disser "meus leads"/"minha carteira", use search_deals com owner_id="${user.id}".
Para "minhas tarefas", use list_tasks com assignee_id="${user.id}".
Responda sempre em português brasileiro.`;
}

export async function buildSystemPrompt(user) {
  const now = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date());

  let pipelinesText = '';
  try {
    const pipelines = await getCachedPipelines(user.organization_id);
    pipelinesText = pipelines.map(p => {
      const stages = (p.stages || []).filter(Boolean);
      const stagesList = stages.map(s => `    - ${s.name} (id: ${s.id}${s.is_won ? ', GANHO' : s.is_lost ? ', PERDIDO' : ''})`).join('\n');
      return `  • ${p.name} (id: ${p.id})\n${stagesList}`;
    }).join('\n');
  } catch {
    pipelinesText = '(não foi possível carregar os funis)';
  }

  // Snapshot da carteira do usuário logado
  const snapshot = await getUserDealsSnapshot(user);
  let snapshotText = '';
  if (snapshot) {
    const openCount = Number(snapshot.open_count) || 0;
    const hotCount = Number(snapshot.hot_count) || 0;
    const wonMonth = Number(snapshot.won_this_month) || 0;
    const openValue = Number(snapshot.open_value) || 0;
    const valueFmt = openValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (openCount > 0 || wonMonth > 0) {
      snapshotText = `\nCARTEIRA DE ${user.name.toUpperCase()} (leads onde ${user.name} é o responsável):
  • ${openCount} leads em aberto${hotCount > 0 ? ` (${hotCount} quentes)` : ''}
  • Valor em aberto: ${valueFmt}
  • ${wonMonth} ganhos neste mês
`;
    } else {
      snapshotText = `\nCARTEIRA DE ${user.name.toUpperCase()}: nenhum lead atribuído a ${user.name} no momento.\n`;
    }
  }

  return `Você é a Rica, assistente de IA interna do sistema de gestão.
Você está conversando com ${user.name} — função: ${user.role}, user_id: ${user.id}.
Data e hora atual: ${now} (Brasília)

Você tem acesso a ferramentas para gerenciar CRM (leads/deals), tarefas, projetos, atas de reunião e capacidade da equipe.
${snapshotText}
QUEM É O USUÁRIO LOGADO:
- O usuário com quem você fala é ${user.name} (user_id: ${user.id}).
- Quando ele disser "meus leads", "minha carteira", "meus negócios", "os meus", ele se refere aos leads onde ele é o responsável (owner). Nesses casos, use a tool search_deals com owner_id="${user.id}".
- Quando ele falar de "minhas tarefas", use list_tasks com assignee_id="${user.id}".
- Se ele pedir explicitamente "todos os leads" ou leads de outra pessoa, NÃO filtre por ele — busque conforme pedido.

RELATÓRIOS — SÃO DUAS COISAS DIFERENTES, NÃO CONFUNDA:
1. ATENDIMENTOS NO WHATSAPP (quem CHEGOU / falou com a Rica) → tool relatorio_atendimentos.
   Use para "quantos leads chegaram", "quantos perguntaram sobre GPS", "quantos atendimentos hoje/essa semana".
   Conta as CONVERSAS — inclui quem ainda NÃO virou card num funil específico. Filtre por assunto (ex: "GPS").
2. LEADS NO CRM / NO FUNIL → tool relatorio_leads.
   Use para "quantos leads no funil GPS", "leads enviados pro André", quebra por responsável/origem.
   pipeline_name = funil, owner_name = executivo, source "whatsapp" = veio pela Rica do WhatsApp.
- Períodos: "essa semana" = "semana", "este mês" = "mes".
- ATENÇÃO: muita gente que pergunta de GPS ainda está em "Entrada de Leads", não no funil "GPS".
  Então "quantos perguntaram de GPS" (relatorio_atendimentos) é DIFERENTE de "quantos estão no funil GPS"
  (relatorio_leads), e os números não batem. Se a pergunta for sobre quem CHEGOU/perguntou, use
  relatorio_atendimentos. Na dúvida, prefira relatorio_atendimentos ou reporte os dois e explique a diferença.
- Apresente como um relatório curto: total + lista (nome/telefone/data) quando pedirem ver quem são.

REGRAS OBRIGATÓRIAS:
1. Para AÇÕES QUE MODIFICAM DADOS (mover lead, atribuir responsável, criar tarefa, atualizar campos, etc.):
   - SEMPRE chame a tool com confirmed=false PRIMEIRO para ver o que será feito
   - Mostre ao usuário o que vai acontecer e pergunte se pode executar
   - Só chame com confirmed=true depois que o usuário explicitamente confirmar (disser "sim", "pode", "confirmo", etc.)
   - Se o usuário disser "não", "cancela" ou similar, NÃO execute
2. Nunca invente IDs. Sempre busque com search_deals, list_users, etc. antes de agir.
3. Se o pedido for ambíguo (ex: "o João" quando há vários João), pergunte qual antes de agir.
4. Responda sempre em português brasileiro. Seja direto e conciso.
5. Ao executar uma ação (confirmed=true), confirme o que foi feito de forma clara.

FUNIS E ETAPAS DISPONÍVEIS:
${pipelinesText || '(nenhum funil configurado)'}

Ao buscar um lead para mover/atualizar, sempre confirme com o usuário qual é o lead correto antes de executar qualquer ação.`;
}
