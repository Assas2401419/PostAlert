import { DEFAULT_NOTIFICATION_PREFS } from './constants.js';
import { createSupabaseServerClient } from './supabase/server.js';

function mergeNotificationPrefs(value) {
  return {
    ...DEFAULT_NOTIFICATION_PREFS,
    ...(value || {})
  };
}

function toPointLiteral(location) {
  if (
    !location ||
    !Number.isFinite(Number(location.lat)) ||
    !Number.isFinite(Number(location.lng))
  ) {
    return null;
  }

  return `SRID=4326;POINT(${Number(location.lng)} ${Number(location.lat)})`;
}

function fromPointLiteral(point, fallbackLat, fallbackLng) {
  if (Number.isFinite(Number(fallbackLat)) && Number.isFinite(Number(fallbackLng))) {
    return {
      lat: Number(fallbackLat),
      lng: Number(fallbackLng)
    };
  }

  if (typeof point !== 'string') {
    return null;
  }

  const match = point.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/i);
  if (!match) {
    return null;
  }

  return {
    lat: Number(match[2]),
    lng: Number(match[1])
  };
}

function requireResult(label, result) {
  if (result.error) {
    throw new Error(`[supabase] ${label}: ${result.error.message}`);
  }
  return result.data || [];
}

function mapUserFromRow(row) {
  const lastKnownLocation = fromPointLiteral(
    row.last_known_location,
    row.last_known_lat,
    row.last_known_lng
  );

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    parish: row.parish,
    role: row.role,
    verified: row.verified,
    organizationName: row.organization_name || '',
    badgeNumber: row.badge_number || '',
    reputationScore: row.reputation_score ?? 50,
    restrictedUntil: row.restricted_until,
    permanentPostingBan: Boolean(row.permanent_posting_ban),
    notificationPrefs: mergeNotificationPrefs(row.notification_prefs),
    lastKnownLocation,
    deviceTokens: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapIncidentFromRow(row) {
  const point = fromPointLiteral(row.location, row.latitude, row.longitude) || {
    lat: 17.9712,
    lng: -76.7936
  };

  return {
    id: row.id,
    reporterId: row.reporter_id,
    category: row.category,
    subcategory: row.subcategory,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    credibility: row.credibility,
    confirmationCount: row.confirmation_count ?? 0,
    disputeCount: row.dispute_count ?? 0,
    anonymous: Boolean(row.anonymous),
    photos: Array.isArray(row.photos) ? row.photos : [],
    parish: row.parish,
    latitude: point.lat,
    longitude: point.lng,
    address: row.address || `${row.parish}, Jamaica`,
    moderation: row.moderation || {},
    authorityActions: Array.isArray(row.authority_actions) ? row.authority_actions : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapUserToRow(user) {
  return {
    id: user.id,
    email: user.email,
    password_hash: user.passwordHash,
    name: user.name,
    parish: user.parish,
    role: user.role,
    verified: Boolean(user.verified),
    organization_name: user.organizationName || null,
    badge_number: user.badgeNumber || null,
    reputation_score: user.reputationScore ?? 50,
    restricted_until: user.restrictedUntil || null,
    permanent_posting_ban: Boolean(user.permanentPostingBan),
    notification_prefs: mergeNotificationPrefs(user.notificationPrefs),
    last_known_lat: user.lastKnownLocation?.lat ?? null,
    last_known_lng: user.lastKnownLocation?.lng ?? null,
    last_known_location: toPointLiteral(user.lastKnownLocation),
    created_at: user.createdAt,
    updated_at: user.updatedAt || user.createdAt
  };
}

function mapIncidentToRow(incident) {
  return {
    id: incident.id,
    reporter_id: incident.reporterId,
    category: incident.category,
    subcategory: incident.subcategory,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    credibility: incident.credibility,
    confirmation_count: incident.confirmationCount,
    dispute_count: incident.disputeCount,
    anonymous: Boolean(incident.anonymous),
    parish: incident.parish,
    latitude: incident.latitude,
    longitude: incident.longitude,
    location: toPointLiteral({
      lat: incident.latitude,
      lng: incident.longitude
    }),
    address: incident.address || `${incident.parish}, Jamaica`,
    moderation: incident.moderation || {},
    authority_actions: incident.authorityActions || [],
    photos: incident.photos || [],
    created_at: incident.createdAt,
    updated_at: incident.updatedAt
  };
}

async function upsertTable(client, table, rows) {
  if (!rows.length) {
    return;
  }

  const result = await client.from(table).upsert(rows, {
    onConflict: 'id'
  });

  if (result.error) {
    throw new Error(`[supabase] upsert ${table}: ${result.error.message}`);
  }
}

export async function loadSupabaseDb(createSeedDatabase) {
  const client = createSupabaseServerClient();
  if (!client) {
    return null;
  }

  const [
    usersResult,
    incidentsResult,
    confirmationsResult,
    strikesResult,
    deviceTokensResult,
    appealsResult,
    commentsResult,
    resetTokensResult,
    photoScansResult,
    notificationsResult
  ] = await Promise.all([
    client.from('postalert_users').select('*').order('created_at', { ascending: true }),
    client.from('incidents').select('*').order('created_at', { ascending: false }),
    client.from('confirmations').select('*').order('created_at', { ascending: true }),
    client.from('strikes').select('*').order('created_at', { ascending: true }),
    client.from('device_tokens').select('*').order('created_at', { ascending: true }),
    client.from('moderation_appeals').select('*').order('created_at', { ascending: true }),
    client.from('comments').select('*').order('created_at', { ascending: true }),
    client.from('password_reset_tokens').select('*').order('created_at', { ascending: true }),
    client.from('pending_photo_scans').select('*').order('created_at', { ascending: true }),
    client.from('notifications').select('*').order('created_at', { ascending: false })
  ]);

  const userRows = requireResult('select postalert_users', usersResult);
  if (!userRows.length) {
    const seeded = createSeedDatabase();
    await saveSupabaseDb(seeded);
    return {
      ...seeded,
      storageMode: 'supabase'
    };
  }

  const users = userRows.map(mapUserFromRow);
  const deviceTokens = requireResult('select device_tokens', deviceTokensResult).map((row) => ({
    id: row.id,
    userId: row.user_id,
    token: row.token,
    platform: row.platform,
    createdAt: row.created_at
  }));

  for (const user of users) {
    user.deviceTokens = deviceTokens.filter((entry) => entry.userId === user.id);
  }

  return {
    storageMode: 'supabase',
    users,
    incidents: requireResult('select incidents', incidentsResult).map(mapIncidentFromRow),
    confirmations: requireResult('select confirmations', confirmationsResult).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      actionType: row.action_type,
      createdAt: row.created_at
    })),
    strikes: requireResult('select strikes', strikesResult).map((row) => ({
      id: row.id,
      userId: row.user_id,
      reason: row.reason,
      issuedBy: row.issued_by,
      status: row.status,
      createdAt: row.created_at,
      decayedAt: row.decayed_at
    })),
    deviceTokens,
    moderationAppeals: requireResult('select moderation_appeals', appealsResult).map((row) => ({
      id: row.id,
      strikeId: row.strike_id,
      userId: row.user_id,
      message: row.message,
      status: row.status,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at
    })),
    comments: requireResult('select comments', commentsResult).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      userId: row.user_id,
      message: row.message,
      createdAt: row.created_at,
      deletedAt: row.deleted_at
    })),
    passwordResetTokens: requireResult('select password_reset_tokens', resetTokensResult).map((row) => ({
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      invalidatedAt: row.invalidated_at,
      createdAt: row.created_at
    })),
    pendingPhotoScans: requireResult('select pending_photo_scans', photoScansResult).map((row) => ({
      id: row.id,
      incidentId: row.incident_id,
      photoId: row.photo_id,
      status: row.status,
      createdAt: row.created_at
    })),
    notifications: requireResult('select notifications', notificationsResult).map((row) => ({
      id: row.id,
      userId: row.user_id,
      incidentId: row.incident_id,
      title: row.title,
      body: row.body,
      distanceKm: row.distance_km,
      createdAt: row.created_at,
      read: Boolean(row.is_read)
    }))
  };
}

export async function saveSupabaseDb(db) {
  const client = createSupabaseServerClient();
  if (!client) {
    return;
  }

  await upsertTable(client, 'postalert_users', db.users.map(mapUserToRow));
  await upsertTable(client, 'incidents', db.incidents.map(mapIncidentToRow));
  await upsertTable(
    client,
    'confirmations',
    db.confirmations.map((entry) => ({
      id: entry.id,
      incident_id: entry.incidentId,
      user_id: entry.userId,
      action_type: entry.actionType,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'strikes',
    db.strikes.map((entry) => ({
      id: entry.id,
      user_id: entry.userId,
      reason: entry.reason,
      issued_by: entry.issuedBy || null,
      status: entry.status,
      created_at: entry.createdAt,
      decayed_at: entry.decayedAt || null
    }))
  );
  await upsertTable(
    client,
    'device_tokens',
    db.deviceTokens.map((entry) => ({
      id: entry.id,
      user_id: entry.userId,
      token: entry.token,
      platform: entry.platform,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'moderation_appeals',
    db.moderationAppeals.map((entry) => ({
      id: entry.id,
      strike_id: entry.strikeId,
      user_id: entry.userId,
      message: entry.message,
      status: entry.status,
      reviewed_at: entry.reviewedAt || null,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'comments',
    db.comments.map((entry) => ({
      id: entry.id,
      incident_id: entry.incidentId,
      user_id: entry.userId,
      message: entry.message,
      deleted_at: entry.deletedAt || null,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'password_reset_tokens',
    db.passwordResetTokens.map((entry) => ({
      id: entry.id,
      user_id: entry.userId,
      token_hash: entry.tokenHash,
      expires_at: entry.expiresAt,
      used_at: entry.usedAt || null,
      invalidated_at: entry.invalidatedAt || null,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'pending_photo_scans',
    db.pendingPhotoScans.map((entry) => ({
      id: entry.id,
      incident_id: entry.incidentId,
      photo_id: entry.photoId,
      status: entry.status,
      created_at: entry.createdAt
    }))
  );
  await upsertTable(
    client,
    'notifications',
    db.notifications.map((entry) => ({
      id: entry.id,
      user_id: entry.userId,
      incident_id: entry.incidentId,
      title: entry.title,
      body: entry.body,
      distance_km: entry.distanceKm,
      is_read: Boolean(entry.read),
      created_at: entry.createdAt
    }))
  );
}
