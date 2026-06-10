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

  return `Você é a Rica, assistente de IA interna do sistema de gestão.
Você está conversando com ${user.name} (${user.role}).
Data e hora atual: ${now} (Brasília)

Você tem acesso a ferramentas para gerenciar CRM (leads/deals), tarefas, projetos, atas de reunião e capacidade da equipe.

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
