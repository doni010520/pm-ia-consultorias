import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Rotas
import authRouter from './routes/auth.js';
import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import reportsRouter from './routes/reports.js';
import transcriptionsRouter from './routes/transcriptions.js';
import alertsRouter from './routes/alerts.js';
import invitesRouter from './routes/invites.js';
import allocationsRouter from './routes/allocations.js';
import capacityCalendarRouter from './routes/capacity-calendar.js';

// Middleware
import { requireAuth } from './middleware/auth.js';

// Serviços
import { initDatabase } from './services/database.js';
import { initEmail } from './services/email.js';
import { initWhatsApp } from './services/whatsapp.js';
import { initScheduler, runDailyAlerts } from './services/scheduler.js';

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Rotas públicas
app.use('/api/auth', authRouter);
app.use('/api/invites', invitesRouter);

// Rotas protegidas (JWT ou organization_id para n8n)
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/projects', requireAuth, projectsRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/transcriptions', requireAuth, transcriptionsRouter);
app.use('/api/alerts', requireAuth, alertsRouter);
app.use('/api/allocations', requireAuth, allocationsRouter);
app.use('/api/capacity', requireAuth, capacityCalendarRouter);

// Endpoint para disparar alertas manualmente (admin/teste)
app.post('/api/alerts/send-daily', requireAuth, async (req, res, next) => {
  try {
    const result = await runDailyAlerts();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Error handler global
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Erro interno do servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { message: 'Rota não encontrada' } });
});

// Iniciar servidor
async function start() {
  try {
    // Testar conexão com banco
    await initDatabase();
    console.log('✅ Banco de dados conectado');

    initEmail();
    initWhatsApp();
    initScheduler();

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

start();
