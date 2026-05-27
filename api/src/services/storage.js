/**
 * storage.js — Supabase Storage wrapper for deal file uploads.
 *
 * Bucket: deal-files  (private, signed URLs)
 * Path convention: {org_id}/{deal_id}/{uuid}-{filename}
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'deal-files';

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
  return createClient(url, key);
}

/**
 * Ensure the bucket exists (idempotent).
 * Call once at startup if needed.
 */
export async function ensureBucket() {
  const supabase = getClient();
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !error.message?.includes('already exists')) throw error;
  }
}

/**
 * Upload a file buffer to Supabase Storage.
 * @param {string} orgId
 * @param {string} dealId
 * @param {string} originalName  – original filename (sanitised internally)
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {{ storagePath: string }}
 */
export async function uploadFile({ orgId, dealId, originalName, buffer, mimeType }) {
  const { v4: uuidv4 } = await import('crypto').then(() => ({ v4: () => crypto.randomUUID() }));
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${orgId}/${dealId}/${Date.now()}-${safeName}`;

  const supabase = getClient();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (error) throw error;
  return { storagePath };
}

/**
 * Generate a signed URL valid for `expiresIn` seconds (default 1 hour).
 */
export async function getSignedUrl(storagePath, expiresIn = 3600) {
  const supabase = getClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

/**
 * Delete a file from storage.
 */
export async function removeFile(storagePath) {
  const supabase = getClient();
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}
