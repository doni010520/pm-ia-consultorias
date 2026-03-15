import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

// Rotas
import tasksRouter from './routes/tasks.js';
import projectsRouter from './routes/projects.js';
import reportsRouter from './routes/reports.js';
import transcriptionsRouter from './routes/transcriptions.js';
import webhookRouter from './routes/webhook.js';

// Serviços
import { initDatabase } from './services/database.js';

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

// Rotas da API
app.use('/api/tasks', tasksRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/transcriptions', transcriptionsRouter);
app.use('/webhook', webhookRouter);

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
