import { query } from './database.js';

const VALID_EVENTS = new Set([
  'lead_created', 'triagem_entered', 'qualified', 'owner_assigned',
  'first_response', 'meeting_scheduled', 'proposal_sent', 'negotiation_started',
  'won', 'lost', 'stage_changed', 'rica_message', 'activity_logged',
  'task_created', 'task_completed', 'file_uploaded', 'email_sent', 'email_received',
]);

/**
 * Grava um evento na jornada do lead.
 * Idempotente quando idempotencyKey for fornecida.
 *
 * @param {object} opts
 * @param {string} opts.dealId
 * @param {string} opts.organizationId
 * @param {string} opts.eventType - deve estar em VALID_EVENTS
 * @param {object} [opts.fromValue]
 * @param {object} [opts.toValue]
 * @param {string} [opts.actorUserId]
 * @param {string} [opts.actorType] - user | rica | automation | system
 * @param {string} [opts.idempotencyKey]
 * @param {object} [opts.metadata]
 * @param {Date}   [opts.occurredAt]
 */
export async function recordEvent({
  dealId,
  organizationId,
  eventType,
  fromValue = null,
  toValue = null,
  actorUserId = null,
  actorType = 'user',
  idempotencyKey = null,
  metadata = {},
  occurredAt = null,
}) {
  if (!VALID_EVENTS.has(eventType)) {
    console.warn(`[leadJourney] Unknown event type: ${eventType}`);
    return null;
  }

  // Idempotency check
  if (idempotencyKey) {
    const existing = await query(
      'SELECT id FROM lead_journey_events WHERE deal_id = $1 AND idempotency_key = $2',
      [dealId, idempotencyKey]
    );
    if (existing.rows.length > 0) return existing.rows[0];
  }

  const result = await query(
    `INSERT INTO lead_journey_events
       (deal_id, organization_id, event_type, from_value, to_value,
        actor_user_id, actor_type, idempotency_key, metadata, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, NOW()))
     RETURNING *`,
    [
      dealId, organizationId, eventType,
      fromValue ? JSON.stringify(fromValue) : null,
      toValue ? JSON.stringify(toValue) : null,
      actorUserId, actorType, idempotencyKey,
      JSON.stringify(metadata),
      occurredAt || null,
    ]
  );

  const event = result.rows[0];

  // Atualiza o cache JSONB lead_journey (ultimos 50 eventos, mais recentes primeiro)
  await query(
    `UPDATE deals
     SET lead_journey = (
       SELECT jsonb_agg(ev ORDER BY (ev->>'occurred_at') DESC)
       FROM (
         SELECT jsonb_array_elements(
           COALESCE(lead_journey, '[]'::jsonb) || $2::jsonb
         ) AS ev
         LIMIT 50
       ) sub
     ),
     updated_at = NOW()
     WHERE id = $1`,
    [dealId, JSON.stringify([{
      id: event.id,
      event_type: eventType,
      from_value: fromValue,
      to_value: toValue,
      actor_user_id: actorUserId,
      actor_type: actorType,
      occurred_at: event.occurred_at,
      metadata,
    }])]
  );

  return event;
}

/**
 * Registra lead_created com campos de rastreabilidade (UTMs, canal, sessao Rica).
 */
export async function recordLeadCreated({
  dealId,
  organizationId,
  actorUserId,
  actorType = 'user',
  firstChannel = 'manual',
  utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
  ricaSessionId,
}) {
  // Grava first_contact_at e campos UTM no deal
  await query(
    `UPDATE deals SET
       first_contact_at = COALESCE(first_contact_at, NOW()),
       first_channel = COALESCE(first_channel, $2),
       utm_source = COALESCE(utm_source, $3),
       utm_medium = COALESCE(utm_medium, $4),
       utm_campaign = COALESCE(utm_campaign, $5),
       utm_content = COALESCE(utm_content, $6),
       utm_term = COALESCE(utm_term, $7),
       rica_session_id = COALESCE(rica_session_id, $8)
     WHERE id = $1`,
    [dealId, firstChannel, utmSource || null, utmMedium || null,
     utmCampaign || null, utmContent || null, utmTerm || null,
     ricaSessionId || null]
  );

  return recordEvent({
    dealId, organizationId, eventType: 'lead_created',
    actorUserId, actorType,
    toValue: { first_channel: firstChannel, utm_source: utmSource },
    idempotencyKey: `lead_created_${dealId}`,
  });
}

/**
 * Registra mudanca de estagio.
 */
export async function recordStageChange({
  dealId, organizationId, actorUserId, actorType = 'user',
  fromStageId, fromStageName, toStageId, toStageName,
  isWon = false, isLost = false,
}) {
  const eventType = isWon ? 'won' : isLost ? 'lost' : 'stage_changed';

  // Detectar eventos semanticos adicionais pelo nome do estagio destino
  let extraEvent = null;
  if (toStageName) {
    const name = toStageName.toLowerCase();
    if (name.includes('proposta')) extraEvent = 'proposal_sent';
    else if (name.includes('diagnos')) extraEvent = 'qualified';
    else if (name.includes('triagem') || name.includes('recebido')) extraEvent = 'triagem_entered';
    else if (name.includes('negocia') || name.includes('fechamento')) extraEvent = 'negotiation_started';
  }

  await recordEvent({
    dealId, organizationId, eventType,
    actorUserId, actorType,
    fromValue: { stage_id: fromStageId, stage_name: fromStageName },
    toValue: { stage_id: toStageId, stage_name: toStageName },
  });

  if (extraEvent) {
    await recordEvent({
      dealId, organizationId, eventType: extraEvent,
      actorUserId, actorType,
      toValue: { stage_id: toStageId, stage_name: toStageName },
      idempotencyKey: `${extraEvent}_${dealId}_${toStageId}`,
    });
  }
}

/**
 * Registra atribuicao de owner.
 */
export async function recordOwnerAssigned({
  dealId, organizationId, actorUserId, actorType = 'user',
  ownerId, ownerName,
}) {
  return recordEvent({
    dealId, organizationId, eventType: 'owner_assigned',
    actorUserId, actorType,
    toValue: { owner_id: ownerId, owner_name: ownerName },
    idempotencyKey: `owner_assigned_${dealId}_${ownerId}`,
  });
}

/**
 * Registra activity_logged e detecta first_response (primeira atividade outbound do owner).
 */
export async function recordActivityLogged({
  dealId, organizationId, actorUserId, actorType = 'user',
  activityType, direction, isScheduled = false,
}) {
  await recordEvent({
    dealId, organizationId, eventType: 'activity_logged',
    actorUserId, actorType,
    toValue: { activity_type: activityType, direction },
  });

  if (direction === 'outbound') {
    const existing = await query(
      `SELECT id FROM lead_journey_events
       WHERE deal_id = $1 AND event_type = 'first_response' LIMIT 1`,
      [dealId]
    );
    if (existing.rows.length === 0) {
      await recordEvent({
        dealId, organizationId, eventType: 'first_response',
        actorUserId, actorType,
        idempotencyKey: `first_response_${dealId}`,
      });
    }
  }

  if (isScheduled && activityType === 'meeting') {
    await recordEvent({
      dealId, organizationId, eventType: 'meeting_scheduled',
      actorUserId, actorType,
    });
  }
}
