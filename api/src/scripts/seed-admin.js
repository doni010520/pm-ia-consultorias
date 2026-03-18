import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';

dotenv.config();

const ADMIN_NAME = 'Renato Barros';
const ADMIN_EMAIL = 'renato@pmia.com';
const ADMIN_PASSWORD = 'pm-ia-2024';
const ADMIN_ROLE = 'admin';
const ORG_ID = process.env.DEFAULT_ORGANIZATION_ID || '00000000-0000-0000-0000-000000000001';

async function seed() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    const result = await pool.query(
      `INSERT INTO users (organization_id, name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (organization_id, email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name,
         role = EXCLUDED.role
       RETURNING id, name, email, role`,
      [ORG_ID, ADMIN_NAME, ADMIN_EMAIL, password_hash, ADMIN_ROLE]
    );

    console.log('✅ Admin criado/atualizado:', result.rows[0]);
  } catch (error) {
    console.error('❌ Erro ao criar admin:', error.message);
  } finally {
    await pool.end();
  }
}

seed();
