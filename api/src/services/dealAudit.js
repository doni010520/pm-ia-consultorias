import { query } from './database.js';

// Campos auditados no PATCH de deals
const AUDITED_FIELDS = [
  'title', 'value', 'pipeline_stage_id', 'pipeline_id', 'owner_id',
  'status', 'temperature', 'expected_close_date', 'probability',
  'contact_name', 'contact_email', 'contact_phone', 'company_name',
  'source', 'lost_reason',
];

/**
 * Compara before/after e grava entradas no deal_audit_log para cada campo alterado.
 *
 * @param {string} dealId
 * @param {string} organizationId
 * @param {string|null} userId
 * @param {string} actorType - user | rica | automation | system
 * @param {object} before - snapshot antes do UPDATE
 * @param {object} after  - campos enviados no body do request
 * @param {object} [metadata]
 */
export async function recordDiff(dealId, organizationId, userId, actorType, before, after, metadata = {}) {
  const inserts = [];

  for (const field of AUDITED_FIELDS) {
    if (after[field] === undefined) continue;

    const oldVal = before[field];
    const newVal = after[field];

    // Evitar logs desnecessarios de campos identicos
    if (String(oldVal) === String(newVal)) continue;

    inserts.push(recordChange(dealId, organizationId, userId, actorType, 'updated', field, oldVal, newVal, metadata));
  }

  if (inserts.length > 0) await Promise.all(inserts);
}

/**
 * Grava uma entrada individual no audit log.
 */
export async function recordChange(
  dealId, organizationId, userId, actorType,
  action, field, oldValue, newValue, metadata = {}
) {
  return query(
    `INSERT INTO deal_audit_log
       (deal_id, organization_id, user_id, actor_type, action, field, old_value, new_value, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      dealId, organizationId, userId || null, actorType || 'user',
      action, field || null,
      oldValue !== undefined && oldValue !== null ? JSON.stringify(oldValue) : null,
      newValue !== undefined && newValue !== null ? JSON.stringify(newValue) : null,
      JSON.stringify(metadata),
    ]
  );
}

/**
 * Atalho para logar criacao de deal.
 */
export async function recordCreated(dealId, organizationId, userId, actorType = 'user', dealData = {}) {
  return recordChange(dealId, organizationId, userId, actorType, 'created', null, null, dealData, {});
}

/**
 * Atalho para logar mudanca de estagio com nomes resolvidos.
 */
export async function recordStageChange(
  dealId, organizationId, userId, actorType,
  fromStageId, fromStageName, toStageId, toStageName
) {
  return recordChange(
    dealId, organizationId, userId, actorType, 'stage_changed',
    'pipeline_stage_id',
    { id: fromStageId, name: fromStageName },
    { id: toStageId, name: toStageName },
    {}
  );
}

/**
 * Atalho para logar atribuicao de owner.
 */
export async function recordOwnerAssigned(dealId, organizationId, userId, actorType, ownerId, ownerName) {
  return recordChange(
    dealId, organizationId, userId, actorType, 'owner_assigned',
    'owner_id', null, { id: ownerId, name: ownerName }, {}
  );
}
