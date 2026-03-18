import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const NAME = 'Paulo Moshe';
const EMAIL = 'paulo.moshe@pmia.com';
const PASSWORD = 'pm-ia-2024';
const ROLE = 'member';
const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001';

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
      [ORG_ID, NAME, EMAIL, password_hash, ROLE]
    );

    console.log('✅ Usuário criado/atualizado:', result.rows[0]);
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await pool.end();
  }
}

seed();
