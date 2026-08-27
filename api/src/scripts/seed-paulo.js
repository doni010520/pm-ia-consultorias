import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

// Credenciais vêm do ambiente — nunca hardcode nome/email/senha (o repo é público).
const NAME = process.env.SEED_ADMIN_NAME;
const EMAIL = process.env.SEED_ADMIN_EMAIL;
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const ROLE = 'admin';
const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001';

if (!NAME || !EMAIL || !PASSWORD) {
  console.error(
    '❌ Defina SEED_ADMIN_NAME, SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no ambiente (ou no .env) antes de rodar o seed.'
  );
  process.exit(1);
}

async function seed() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const password_hash = await bcrypt.hash(PASSWORD, 10);

    const result = await pool.query(
      `INSERT INTO users (organization_id, name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (organization_id, email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         role = EXCLUDED.role
       RETURNING id, name, email, role`,
      [ORG_ID, NAME, EMAIL.toLowerCase().trim(), password_hash, ROLE]
    );

    console.log('✅ Usuário criado/atualizado:', result.rows[0]);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await pool.end();
  }
}

seed();
