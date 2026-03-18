/**
 * Scheduler de alertas automáticos
 * Roda todo dia às 8h e envia WhatsApp para responsáveis de tarefas com prazo próximo
 */

import { query } from './database.js';
import { sendText, formatBrazilianNumber } from './whatsapp.js';

const ALERT_HOUR = parseInt(process.env.ALERT_HOUR || '8', 10); // Hora do alerta (default 8h)
const CHECK_INTERVAL = 60 * 1000; // Verificar a cada 1 minuto

let lastAlertDate = null;
let intervalId = null;

/**
 * Inicia o scheduler
 */
export function initScheduler() {
  console.log(`📅 Scheduler de alertas iniciado (disparo diário às ${ALERT_HOUR}h)`);

  // Verificar a cada minuto se é hora de rodar
  intervalId = setInterval(() => {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentHour = now.getHours();

    // Rodar uma vez por dia na hora configurada
    if (currentHour === ALERT_HOUR && lastAlertDate !== today) {
      lastAlertDate = today;
      runDailyAlerts().catch(err => {
        console.error('❌ Erro no scheduler de alertas:', err);
      });
    }
  }, CHECK_INTERVAL);
}

/**
 * Para o scheduler
 */
export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('📅 Scheduler parado');
  }
}

/**
 * Executa os alertas diários
 * Pode ser chamado manualmente via endpoint para teste
 */
export async function runDailyAlerts() {
  console.log('📅 Executando alertas diários...');

  try {
    const today = new Date().toISOString().split('T')[0];

    // Buscar tarefas com prazo próximo ou atrasadas (exceto concluídas/canceladas)
    const result = await query(
      `SELECT
        t.id,
        t.title,
        t.due_date,
        t.status,
        t.priority,
        t.project_id,
        p.name as project_name,
        u.id as assignee_id,
        u.name as assignee_name,
        u.whatsapp as assignee_whatsapp,
        u.email as assignee_email,
        (t.due_date::date - CURRENT_DATE) as days_remaining
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status NOT IN ('done', 'cancelled')
        AND t.due_date IS NOT NULL
        AND (t.due_date::date - CURRENT_DATE) <= 2
      ORDER BY t.due_date ASC`,
      []
    );

    const tasks = result.rows;

    if (tasks.length === 0) {
      console.log('📅 Nenhuma tarefa com prazo próximo ou atrasada');
      return { sent: 0, tasks: 0 };
    }

    console.log(`📅 ${tasks.length} tarefa(s) com prazo próximo ou atrasada(s)`);

    let sentCount = 0;

    for (const task of tasks) {
      // Pular tarefas sem responsável ou sem WhatsApp
      if (!task.assignee_whatsapp) {
        console.warn(`⚠️ Tarefa "${task.title}" - responsável sem WhatsApp`);
        continue;
      }

      const message = buildAlertMessage(task);
      const number = formatBrazilianNumber(task.assignee_whatsapp);

      if (!number) continue;

      const result = await sendText(number, message);

      if (result.success) {
        sentCount++;

        // Registrar alerta no banco
        await logAlert(task, message);
      }

      // Delay entre mensagens para não ser bloqueado
      await sleep(2000);
    }

    console.log(`📅 Alertas enviados: ${sentCount}/${tasks.length}`);
    return { sent: sentCount, tasks: tasks.length };
  } catch (error) {
    console.error('❌ Erro ao executar alertas:', error);
    throw error;
  }
}

/**
 * Monta a mensagem de alerta baseado nos dias restantes
 */
function buildAlertMessage(task) {
  const days = task.days_remaining;
  const projectInfo = task.project_name ? `\n📁 Projeto: ${task.project_name}` : '';

  if (days < 0) {
    const daysLate = Math.abs(days);
    return `🔴 *TAREFA ATRASADA* (${daysLate} dia${daysLate > 1 ? 's' : ''})\n\n` +
      `📋 ${task.title}${projectInfo}\n` +
      `📅 Prazo era: ${formatDate(task.due_date)}\n` +
      `👤 Responsável: ${task.assignee_name}\n\n` +
      `⚠️ Por favor, atualize o status desta tarefa.`;
  }

  if (days === 0) {
    return `🔴 *TAREFA VENCE HOJE*\n\n` +
      `📋 ${task.title}${projectInfo}\n` +
      `📅 Prazo: ${formatDate(task.due_date)}\n` +
      `👤 Responsável: ${task.assignee_name}\n\n` +
      `⏰ Último dia para concluir!`;
  }

  if (days === 1) {
    return `🟠 *TAREFA VENCE AMANHÃ*\n\n` +
      `📋 ${task.title}${projectInfo}\n` +
      `📅 Prazo: ${formatDate(task.due_date)}\n` +
      `👤 Responsável: ${task.assignee_name}\n\n` +
      `📌 Priorize esta entrega.`;
  }

  // days === 2
  return `🟡 *TAREFA VENCE EM 2 DIAS*\n\n` +
    `📋 ${task.title}${projectInfo}\n` +
    `📅 Prazo: ${formatDate(task.due_date)}\n` +
    `👤 Responsável: ${task.assignee_name}\n\n` +
    `📌 Atenção ao prazo.`;
}

/**
 * Registra o alerta enviado no banco
 */
async function logAlert(task, message) {
  try {
    await query(
      `INSERT INTO risk_alerts (organization_id, project_id, severity, title, description, source)
       VALUES (
         (SELECT organization_id FROM projects WHERE id = $1 LIMIT 1),
         $1, $2, $3, $4, 'scheduler'
       )`,
      [
        task.project_id,
        task.days_remaining < 0 ? 'red' : task.days_remaining === 0 ? 'red' : 'yellow',
        `Alerta de prazo: ${task.title}`,
        message,
      ]
    );
  } catch (err) {
    // Não falhar por erro no log
    console.warn('⚠️ Erro ao registrar alerta no banco:', err.message);
  }
}

/**
 * Formata data para DD/MM/YYYY
 */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default { initScheduler, stopScheduler, runDailyAlerts };
