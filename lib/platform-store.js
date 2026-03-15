import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import {
  CATEGORY_SUBCATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  PARISHES,
  PARISH_CENTERS,
  PROHIBITED_KEYWORDS,
  SEVERITY_ORDER,
  SENSITIVE_KEYWORDS
} from './constants.js';
import { loadSupabaseDb, saveSupabaseDb } from './supabase-persistence.js';
import { haversineKm, severityIndex, withinJamaica } from './utils.js';
import { hasSupabaseConfig } from './supabase/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE =
  process.env.POSTALERT_DATA_FILE || path.join(__dirname, '..', 'data', 'local-db.json');

export class PlatformError extends Error {
  constructor(status, message, code = status) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function storageMode() {
  if (process.env.POSTALERT_STORAGE_MODE === 'local') {
    return 'local';
  }
  if (process.env.POSTALERT_STORAGE_MODE === 'supabase' && hasSupabaseConfig()) {
    return 'supabase';
  }
  return hasSupabaseConfig() ? 'supabase' : 'local';
}

function assertParish(parish) {
  if (!PARISHES.includes(parish)) {
    throw new PlatformError(400, 'Invalid parish selected.', 4001);
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function localNow() {
  return new Date().toISOString();
}

function createSeedUsers() {
  const now = localNow();
  return [
    {
      id: randomUUID(),
      email: 'admin@postalert.gov.jm',
      passwordHash: bcrypt.hashSync('Admin123!', 10),
      name: 'Postalert Admin',
      parish: 'Kingston',
      role: 'admin',
      verified: true,
      organizationName: 'Postalert Operations',
      badgeNumber: 'ADM-001',
      createdAt: now,
      reputationScore: 92,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
      deviceTokens: [],
      lastKnownLocation: { lat: 17.9712, lng: -76.7928 }
    },
    {
      id: randomUUID(),
      email: 'officer@jcf.gov.jm',
      passwordHash: bcrypt.hashSync('Officer123!', 10),
      name: 'D. Williams',
      parish: 'St. Andrew',
      role: 'authority',
      verified: true,
      organizationName: 'Jamaica Constabulary Force',
      badgeNumber: 'JCF-4421',
      createdAt: now,
      reputationScore: 88,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: {
        ...DEFAULT_NOTIFICATION_PREFS,
        enabled: true
      },
      deviceTokens: [],
      lastKnownLocation: { lat: 18.0226, lng: -76.7936 }
    },
    {
      id: randomUUID(),
      email: 'marlon@example.com',
      passwordHash: bcrypt.hashSync('Citizen123!', 10),
      name: 'Marlon Brown',
      parish: 'Kingston',
      role: 'citizen',
      verified: true,
      createdAt: now,
      reputationScore: 64,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
      deviceTokens: [],
      lastKnownLocation: { lat: 17.9798, lng: -76.7939 }
    }
  ];
}

function createSeedIncidents(users) {
  const citizen = users.find((user) => user.role === 'citizen');
  const authority = users.find((user) => user.role === 'authority');
  const now = Date.now();
  const samples = [
    {
      category: 'Crime',
      subcategory: 'Robbery',
      description:
        'Armed robbery reported near Half-Way Tree transport centre. Motorists advised to avoid the curbside lane.',
      severity: 'high',
      parish: 'St. Andrew',
      latitude: 18.0125,
      longitude: -76.7933
    },
    {
      category: 'Infrastructure',
      subcategory: 'Power Outage',
      description:
        'Multiple blocks without electricity after line failure near Spanish Town Road.',
      severity: 'medium',
      parish: 'Kingston',
      latitude: 17.981,
      longitude: -76.8272
    },
    {
      category: 'Natural Disaster',
      subcategory: 'Flooding',
      description:
        'Flood water building under Mandela Highway after intense rainfall. Traffic moving slowly.',
      severity: 'critical',
      parish: 'St. Catherine',
      latitude: 17.9838,
      longitude: -76.913
    },
    {
      category: 'Community Alert',
      subcategory: 'School Lockdown',
      description:
        'School temporarily locked down while police investigate a nearby disturbance.',
      severity: 'high',
      parish: 'St. James',
      latitude: 18.4771,
      longitude: -77.8939
    }
  ];

  return samples.map((sample, index) => ({
    id: randomUUID(),
    reporterId: citizen.id,
    category: sample.category,
    subcategory: sample.subcategory,
    title: `${sample.subcategory} in ${sample.parish}`,
    description: sample.description,
    severity: sample.severity,
    status: index === 2 ? 'responding' : 'active',
    credibility: index < 2 ? 'verified' : 'pending',
    confirmationCount: index < 2 ? 5 : 2,
    disputeCount: 0,
    anonymous: index === 3,
    photos: [],
    parish: sample.parish,
    latitude: sample.latitude,
    longitude: sample.longitude,
    address: `${sample.parish}, Jamaica`,
    moderation: {
      sensitive: index === 0,
      flagged: false
    },
    authorityActions:
      index === 2
        ? [
            {
              id: randomUUID(),
              authorityId: authority.id,
              authorityName: authority.name,
              action: 'respond',
              notes: 'Rescue team deployed and traffic rerouted.',
              createdAt: new Date(now - 3 * 60 * 60 * 1000).toISOString()
            }
          ]
        : [],
    createdAt: new Date(now - (index + 2) * 6 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(now - (index + 1) * 3 * 60 * 60 * 1000).toISOString()
  }));
}

function createSeedDatabase() {
  const users = createSeedUsers();
  return {
    storageMode: storageMode(),
    users,
    incidents: createSeedIncidents(users),
    confirmations: [],
    strikes: [],
    deviceTokens: [],
    moderationAppeals: [],
    comments: [],
    passwordResetTokens: [],
    pendingPhotoScans: [],
    notifications: []
  };
}

function ensureCollections(db) {
  db.storageMode = storageMode();
  db.confirmations ||= [];
  db.strikes ||= [];
  db.deviceTokens ||= [];
  db.moderationAppeals ||= [];
  db.comments ||= [];
  db.passwordResetTokens ||= [];
  db.pendingPhotoScans ||= [];
  db.notifications ||= [];
  return db;
}

async function loadDb() {
  const supabaseDb = storageMode() === 'supabase'
    ? await loadSupabaseDb(createSeedDatabase)
    : null;
  if (supabaseDb) {
    return ensureCollections(supabaseDb);
  }

  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) {
      const db = createSeedDatabase();
      await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
      return db;
    }

    const db = JSON.parse(raw);
    if (!db.users || !db.incidents) {
      const seeded = createSeedDatabase();
      await fs.writeFile(DATA_FILE, JSON.stringify(seeded, null, 2));
      return seeded;
    }

    return ensureCollections(db);
  } catch {
    const db = createSeedDatabase();
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
    return ensureCollections(db);
  }
}

async function withDb(run) {
  const db = await loadDb();
  const result = await run(db);
  if (storageMode() === 'supabase') {
    await saveSupabaseDb(db);
  } else {
    await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
  }
  return result;
}

function activeStrikes(db, userId) {
  return db.strikes.filter((strike) => strike.userId === userId && strike.status === 'active');
}

function recalculateRestrictions(db, user) {
  const strikes = activeStrikes(db, user.id);
  if (user.restrictedUntil && new Date(user.restrictedUntil).getTime() < Date.now()) {
    user.restrictedUntil = null;
  }
  user.permanentPostingBan = strikes.length >= 5;
  if (strikes.length < 3) {
    user.restrictedUntil = null;
  }
  return strikes.length;
}

function decayStrikes(db) {
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  for (const user of db.users) {
    const strikes = activeStrikes(db, user.id).sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
    if (!strikes.length) {
      continue;
    }
    const mostRecent = strikes[strikes.length - 1];
    if (now - new Date(mostRecent.createdAt).getTime() >= ninetyDays) {
      strikes[0].status = 'decayed';
      strikes[0].decayedAt = localNow();
      recalculateRestrictions(db, user);
    }
  }
}

function formatRole(user) {
  if (user.role === 'authority' && !user.verified) {
    return 'authority_pending';
  }
  return user.role;
}

function serializeUser(db, user) {
  const strikeCount = recalculateRestrictions(db, user);
  const canPost =
    !user.permanentPostingBan &&
    !user.restrictedUntil &&
    !(user.role === 'authority' && !user.verified);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    parish: user.parish,
    role: formatRole(user),
    verified: user.verified,
    organizationName: user.organizationName || '',
    badgeNumber: user.badgeNumber || '',
    createdAt: user.createdAt,
    reputationScore: user.reputationScore || 0,
    strikeCount,
    canPost,
    readOnly: user.role === 'authority' && !user.verified,
    restrictedUntil: user.restrictedUntil,
    permanentPostingBan: Boolean(user.permanentPostingBan),
    notificationPrefs: user.notificationPrefs,
    lastKnownLocation: user.lastKnownLocation
  };
}

function getNearestParish(latitude, longitude) {
  const ranked = Object.entries(PARISH_CENTERS)
    .map(([parish, center]) => ({
      parish,
      distance: haversineKm(latitude, longitude, center.lat, center.lng)
    }))
    .sort((left, right) => left.distance - right.distance);

  return ranked[0]?.parish || 'Kingston';
}

export function assignParish(latitude, longitude) {
  return getNearestParish(Number(latitude), Number(longitude));
}

function hashResetToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function assertCanPost(db, user) {
  const strikeCount = recalculateRestrictions(db, user);
  const canPost =
    !user.permanentPostingBan &&
    !user.restrictedUntil &&
    !(user.role === 'authority' && !user.verified) &&
    strikeCount < 5;

  if (!canPost) {
    throw new PlatformError(403, 'Your account currently has read-only access.', 4032);
  }
}

export function scanContent(description) {
  const normalized = description.toLowerCase();
  const violations = PROHIBITED_KEYWORDS.filter((entry) =>
    normalized.includes(entry)
  );
  const sensitive = SENSITIVE_KEYWORDS.some((entry) => normalized.includes(entry));

  return {
    allowed: violations.length === 0,
    flagged: sensitive,
    violations
  };
}

function serializeComment(db, comment, requesterId = '') {
  const author = db.users.find((user) => user.id === comment.userId);
  return {
    id: comment.id,
    incidentId: comment.incidentId,
    message: comment.message,
    createdAt: comment.createdAt,
    author: {
      id: author?.id || '',
      name: author?.name || 'Community Member',
      parish: author?.parish || ''
    },
    canDelete: requesterId === comment.userId
  };
}

function listVisibleComments(db, incidentId, requesterId = '') {
  return db.comments
    .filter((comment) => comment.incidentId === incidentId && !comment.deletedAt)
    .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
    .map((comment) => serializeComment(db, comment, requesterId));
}

function serializeAppeal(db, appeal) {
  const strike = db.strikes.find((entry) => entry.id === appeal.strikeId);
  return {
    id: appeal.id,
    strikeId: appeal.strikeId,
    userId: appeal.userId,
    message: appeal.message,
    status: appeal.status,
    createdAt: appeal.createdAt,
    reviewedAt: appeal.reviewedAt || null,
    strikeReason: strike?.reason || 'Strike'
  };
}

function isQuietHours(prefs) {
  if (!prefs?.quietHoursStart || !prefs?.quietHoursEnd) {
    return false;
  }

  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [startHours, startMinutes] = prefs.quietHoursStart.split(':').map(Number);
  const [endHours, endMinutes] = prefs.quietHoursEnd.split(':').map(Number);
  const start = startHours * 60 + startMinutes;
  const end = endHours * 60 + endMinutes;

  if (start < end) {
    return current >= start && current <= end;
  }

  return current >= start || current <= end;
}

function serializeIncident(db, incident, requesterId = '') {
  const reporter = db.users.find((user) => user.id === incident.reporterId);
  const comments = listVisibleComments(db, incident.id, requesterId);
  const confirmations = db.confirmations
    .filter((entry) => entry.incidentId === incident.id)
    .map((entry) => {
      const user = db.users.find((candidate) => candidate.id === entry.userId);
      return {
        id: entry.id,
        action: entry.actionType,
        createdAt: entry.createdAt,
        userName: user?.name || 'Community Member'
      };
    });

  return {
    ...incident,
    comments,
    commentsCount: comments.length,
    confirmations,
    reporter: incident.anonymous
      ? { name: 'Anonymous Reporter', parish: incident.parish, anonymous: true }
      : {
          name: reporter?.name || 'Community Member',
          parish: reporter?.parish || incident.parish,
          anonymous: false
        },
    canAct: requesterId ? requesterId !== incident.reporterId : false
  };
}

const LIVE_INCIDENT_STATUSES = ['active', 'responding', 'authority_verified'];
const AUTHORITY_ACTIONS = ['verify', 'respond', 'resolve', 'dismiss'];

function issueStrike(db, userId, reason, issuedBy) {
  const strike = {
    id: randomUUID(),
    userId,
    reason,
    issuedBy,
    status: 'active',
    createdAt: localNow()
  };

  db.strikes.push(strike);
  const user = db.users.find((candidate) => candidate.id === userId);
  const total = recalculateRestrictions(db, user);
  if (total >= 5) {
    user.permanentPostingBan = true;
  } else if (total >= 3 && !user.restrictedUntil) {
    user.restrictedUntil = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();
  }
}

function createNotificationRecord(db, user, incident) {
  if (user.id === incident.reporterId) {
    return;
  }

  const reporter = db.users.find((candidate) => candidate.id === incident.reporterId);
  const isOperationalUser = user.role === 'admin' || (user.role === 'authority' && user.verified);
  const location =
    user.lastKnownLocation || PARISH_CENTERS[user.parish] || PARISH_CENTERS.Kingston;
  const distance = haversineKm(location.lat, location.lng, incident.latitude, incident.longitude);
  const prefs = user.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;
  const sameParish = user.parish === incident.parish;
  const withinRadius = distance <= (prefs.radiusKm || 5);
  const notificationsEnabled = isOperationalUser ? true : prefs.enabled;
  const categoryMatches = isOperationalUser ? true : prefs.categories?.includes(incident.category);
  const meetsSeverity = isOperationalUser
    ? true
    : severityIndex(incident.severity) >= severityIndex(prefs.minSeverity || 'high');
  const inScope = isOperationalUser ? true : sameParish || withinRadius;

  if (!notificationsEnabled || (!isOperationalUser && isQuietHours(prefs)) || !categoryMatches) {
    return;
  }
  if (!meetsSeverity) {
    return;
  }
  if (!inScope) {
    return;
  }

  db.notifications.push({
    id: randomUUID(),
    userId: user.id,
    incidentId: incident.id,
    title: `${incident.severity.toUpperCase()} ${incident.subcategory || incident.category}`,
    body: `${incident.severity.toUpperCase()} severity • ${incident.address || `${incident.parish}, Jamaica`} • Reported by ${
      incident.anonymous ? 'Anonymous Reporter' : reporter?.name || 'Community Member'
    }${sameParish ? ` • ${incident.parish}` : ''} • ${distance.toFixed(1)} km away`,
    distanceKm: Number(distance.toFixed(1)),
    createdAt: localNow(),
    read: false
  });
}

export async function getUserByEmail(email) {
  const db = await loadDb();
  decayStrikes(db);
  const normalizedEmail = normalizeEmail(email);
  return db.users.find((user) => user.email.toLowerCase() === normalizedEmail) || null;
}

export async function getUserById(id) {
  const db = await loadDb();
  decayStrikes(db);
  const user = db.users.find((entry) => entry.id === id);
  return user ? serializeUser(db, user) : null;
}

export async function validateCredentials(email, password) {
  const db = await loadDb();
  decayStrikes(db);

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new PlatformError(400, 'Enter your email address.', 4022);
  }
  if (!password) {
    throw new PlatformError(400, 'Enter your password.', 4023);
  }

  const user = db.users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
  if (!user) {
    throw new PlatformError(401, 'No account matches that email address.', 4024);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new PlatformError(401, 'Incorrect password. Try again.', 4025);
  }

  return serializeUser(db, user);
}

export async function verifyCredentials(email, password) {
  try {
    return await validateCredentials(email, password);
  } catch (error) {
    if (
      error instanceof PlatformError &&
      [4022, 4023, 4024, 4025].includes(error.code)
    ) {
      return null;
    }
    throw error;
  }
}

export async function generateResetToken(email) {
  return withDb(async (db) => {
    const normalizedEmail = normalizeEmail(email);
    const user = db.users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
    if (!user) {
      return { ok: true };
    }

    const now = localNow();
    for (const token of db.passwordResetTokens.filter(
      (entry) => entry.userId === user.id && !entry.usedAt && !entry.invalidatedAt
    )) {
      token.invalidatedAt = now;
    }

    const rawToken = randomBytes(24).toString('hex');
    db.passwordResetTokens.push({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      usedAt: null,
      invalidatedAt: null,
      createdAt: now
    });

    return {
      ok: true,
      resetToken: rawToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
  });
}

export async function resetPassword(token, password) {
  if (!password || password.length < 8) {
    throw new PlatformError(400, 'Password must be at least 8 characters.', 4004);
  }

  return withDb(async (db) => {
    const tokenHash = hashResetToken(token);
    const record = db.passwordResetTokens.find(
      (entry) =>
        entry.tokenHash === tokenHash &&
        !entry.usedAt &&
        !entry.invalidatedAt &&
        new Date(entry.expiresAt).getTime() > Date.now()
    );

    if (!record) {
      throw new PlatformError(400, 'Reset token is invalid or expired.', 4007);
    }

    const user = db.users.find((entry) => entry.id === record.userId);
    if (!user) {
      throw new PlatformError(404, 'User account not found.', 4042);
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.updatedAt = localNow();
    record.usedAt = localNow();

    for (const entry of db.passwordResetTokens.filter(
      (candidate) => candidate.userId === user.id && candidate.id !== record.id && !candidate.usedAt
    )) {
      entry.invalidatedAt = localNow();
    }

    return { ok: true };
  });
}

export async function registerCitizen(payload) {
  return withDb(async (db) => {
    const { email, password, name, parish } = payload;
    const normalizedEmail = normalizeEmail(email);
    assertParish(parish);
    if (!normalizedEmail || !password || !name) {
      throw new PlatformError(400, 'Email, password, name, and parish are required.', 4003);
    }
    if (password.length < 8) {
      throw new PlatformError(400, 'Password must be at least 8 characters.', 4004);
    }
    if (db.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      throw new PlatformError(409, 'This email is already registered.', 4090);
    }
    const user = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      name,
      parish,
      role: 'citizen',
      verified: true,
      createdAt: localNow(),
      reputationScore: 50,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
      deviceTokens: [],
      lastKnownLocation: PARISH_CENTERS[parish]
    };
    db.users.push(user);
    return serializeUser(db, user);
  });
}

export async function registerAuthority(payload) {
  return withDb(async (db) => {
    const { email, password, name, parish, organizationName, badgeNumber } = payload;
    const normalizedEmail = normalizeEmail(email);
    assertParish(parish);
    if (!normalizedEmail || !password || !name || !organizationName || !badgeNumber) {
      throw new PlatformError(400, 'Authority registration requires organization and badge details.', 4005);
    }
    if (!/\.(gov|org)\.jm$/i.test(normalizedEmail)) {
      throw new PlatformError(400, 'An official Jamaica organization email is required.', 4006);
    }
    if (password.length < 8) {
      throw new PlatformError(400, 'Password must be at least 8 characters.', 4004);
    }
    if (db.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
      throw new PlatformError(409, 'This email is already registered.', 4090);
    }
    const user = {
      id: randomUUID(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 10),
      name,
      parish,
      role: 'authority',
      verified: false,
      organizationName,
      badgeNumber,
      createdAt: localNow(),
      reputationScore: 65,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: {
        ...DEFAULT_NOTIFICATION_PREFS,
        enabled: true
      },
      deviceTokens: [],
      lastKnownLocation: PARISH_CENTERS[parish]
    };
    db.users.push(user);
    return serializeUser(db, user);
  });
}

export async function listIncidents(filters = {}, requesterId = '') {
  const db = await loadDb();
  decayStrikes(db);
  let incidents = [...db.incidents];

  if (!filters.status) {
    incidents = incidents.filter((incident) => LIVE_INCIDENT_STATUSES.includes(incident.status));
  }

  if (filters.categories?.length) {
    incidents = incidents.filter((incident) => filters.categories.includes(incident.category));
  }
  if (filters.severities?.length) {
    incidents = incidents.filter((incident) => filters.severities.includes(incident.severity));
  }
  if (filters.parish) {
    incidents = incidents.filter((incident) => incident.parish === filters.parish);
  }
  if (filters.status) {
    incidents = incidents.filter((incident) => incident.status === filters.status);
  }
  if (filters.startTime) {
    incidents = incidents.filter(
      (incident) => new Date(incident.createdAt).getTime() >= new Date(filters.startTime).getTime()
    );
  }
  if (filters.endTime) {
    incidents = incidents.filter(
      (incident) => new Date(incident.createdAt).getTime() <= new Date(filters.endTime).getTime()
    );
  }

  incidents.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  const page = Number(filters.page || 1);
  const limit = Number(filters.limit || 8);
  const startIndex = (page - 1) * limit;
  return {
    items: incidents
      .slice(startIndex, startIndex + limit)
      .map((incident) => serializeIncident(db, incident, requesterId)),
    page,
    limit,
    total: incidents.length,
    hasMore: startIndex + limit < incidents.length,
    storageMode: storageMode()
  };
}

export async function getIncidentById(id, requesterId = '') {
  const db = await loadDb();
  const incident = db.incidents.find((entry) => entry.id === id);
  if (!incident) {
    throw new PlatformError(404, 'Incident not found.', 4040);
  }
  return serializeIncident(db, incident, requesterId);
}

export async function createIncident(payload, requesterId) {
  return withDb(async (db) => {
    decayStrikes(db);
    const user = db.users.find((entry) => entry.id === requesterId);
    if (!user) {
      throw new PlatformError(401, 'Authentication required.', 4010);
    }

    assertCanPost(db, user);

    const {
      category,
      subcategory,
      description,
      latitude,
      longitude,
      severity = 'medium',
      photos = [],
      anonymous = false,
      address = ''
    } = payload;

    if (!CATEGORY_SUBCATEGORIES[category]) {
      throw new PlatformError(400, 'Select a valid incident category.', 4008);
    }
    if (!CATEGORY_SUBCATEGORIES[category].includes(subcategory)) {
      throw new PlatformError(400, 'Select a valid incident subcategory.', 4009);
    }
    if (!description || description.length < 10 || description.length > 500) {
      throw new PlatformError(400, 'Description must be between 10 and 500 characters.', 4013);
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!withinJamaica(lat, lng)) {
      throw new PlatformError(400, 'Incident location must be within Jamaica.', 4014);
    }

    const moderation = scanContent(description);
    if (!moderation.allowed) {
      throw new PlatformError(400, 'Submission blocked by content policy.', 4015);
    }

    const storedPhotos = [];
    let photoWarning = '';

    for (const photo of Array.isArray(photos) ? photos.slice(0, 3) : []) {
      const isSupported = ['image/jpeg', 'image/png'].includes(photo.type);
      const isSmallEnough = Number(photo.size || 0) <= 5 * 1024 * 1024;
      if (!isSupported || !isSmallEnough) {
        throw new PlatformError(400, 'Photos must be JPEG or PNG and 5MB or less.', 4016);
      }
      try {
        storedPhotos.push({
          id: randomUUID(),
          name: photo.name,
          type: photo.type,
          size: photo.size,
          url: photo.dataUrl,
          scanStatus: 'queued'
        });
      } catch {
        photoWarning =
          'One or more photos could not be stored. The incident was created without them.';
      }
    }

    const parish = assignParish(lat, lng);
    const incident = {
      id: randomUUID(),
      reporterId: user.id,
      category,
      subcategory,
      title: `${subcategory} in ${parish}`,
      description,
      severity: SEVERITY_ORDER.includes(String(severity).toLowerCase())
        ? String(severity).toLowerCase()
        : 'medium',
      status: 'active',
      credibility: 'pending',
      confirmationCount: 0,
      disputeCount: 0,
      anonymous: Boolean(anonymous),
      photos: storedPhotos,
      parish,
      latitude: lat,
      longitude: lng,
      address: address || `${parish}, Jamaica`,
      moderation: {
        sensitive: moderation.flagged,
        flagged: false
      },
      authorityActions: [],
      createdAt: localNow(),
      updatedAt: localNow()
    };

    db.incidents.unshift(incident);
    for (const photo of storedPhotos) {
      db.pendingPhotoScans.push({
        id: randomUUID(),
        incidentId: incident.id,
        photoId: photo.id,
        status: 'queued',
        createdAt: localNow()
      });
    }
    for (const candidate of db.users) {
      createNotificationRecord(db, candidate, incident);
    }
    return {
      incident: serializeIncident(db, incident, requesterId),
      photoWarning
    };
  });
}

async function applyConfirmationAction(id, requesterId, actionType) {
  return withDb(async (db) => {
    const incident = db.incidents.find((entry) => entry.id === id);
    if (!incident) {
      throw new PlatformError(404, 'Incident not found.', 4040);
    }
    if (incident.reporterId === requesterId) {
      throw new PlatformError(400, 'You cannot vote on your own incident.', 4017);
    }
    const existing = db.confirmations.find(
      (entry) => entry.incidentId === incident.id && entry.userId === requesterId
    );
    if (existing) {
      throw new PlatformError(409, 'You have already confirmed or disputed this incident.', 4091);
    }
    db.confirmations.push({
      id: randomUUID(),
      incidentId: incident.id,
      userId: requesterId,
      actionType,
      createdAt: localNow()
    });
    if (actionType === 'confirm') {
      incident.confirmationCount += 1;
    } else {
      incident.disputeCount += 1;
    }
    if (incident.confirmationCount >= 5) {
      incident.credibility = 'verified';
    }
    if (incident.disputeCount >= incident.confirmationCount + 3) {
      incident.credibility = 'flagged';
      incident.moderation.flagged = true;
    }
    incident.updatedAt = localNow();
    return {
      confirmationCount: incident.confirmationCount,
      disputeCount: incident.disputeCount,
      credibilityStatus: incident.credibility
    };
  });
}

export async function confirmIncident(id, requesterId) {
  return applyConfirmationAction(id, requesterId, 'confirm');
}

export async function disputeIncident(id, requesterId) {
  return applyConfirmationAction(id, requesterId, 'dispute');
}

export async function getAuthorityDashboard(requesterId, parishOverride = '', statusFilter = '') {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (!user) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }
  if (!(user.role === 'admin' || user.role === 'authority')) {
    throw new PlatformError(403, 'Authority access is required.', 4030);
  }
  const parish = parishOverride || (user.role === 'authority' ? user.parish : '');
  let incidents = parish
    ? db.incidents.filter((incident) => incident.parish === parish)
    : [...db.incidents];
  if (statusFilter) {
    incidents = incidents.filter((incident) => incident.status === statusFilter);
  } else {
    incidents = incidents.filter((incident) => LIVE_INCIDENT_STATUSES.includes(incident.status));
  }
  const stats = incidents.reduce(
    (accumulator, incident) => {
      if (
        incident.status === 'active' ||
        incident.status === 'responding' ||
        incident.status === 'authority_verified'
      ) {
        accumulator.totalActive += 1;
      }
      accumulator.byCategory[incident.category] =
        (accumulator.byCategory[incident.category] || 0) + 1;
      accumulator.bySeverity[incident.severity] =
        (accumulator.bySeverity[incident.severity] || 0) + 1;
      return accumulator;
    },
    {
      totalActive: 0,
      byCategory: {},
      bySeverity: {}
    }
  );
  return {
    parish: parish || 'All parishes',
    readOnly: user.role === 'authority' && !user.verified,
    isAdmin: user.role === 'admin',
    incidents: incidents.map((incident) => serializeIncident(db, incident, requesterId)),
    stats: {
      ...stats,
      citizenSignups: db.users.filter((entry) => entry.role === 'citizen').length
    }
  };
}

export async function applyAuthorityAction(requesterId, incidentId, action, notes = '') {
  return withDb(async (db) => {
    const authority = db.users.find((entry) => entry.id === requesterId);
    if (!authority) {
      throw new PlatformError(401, 'Authentication required.', 4010);
    }
    if (!(authority.role === 'admin' || (authority.role === 'authority' && authority.verified))) {
      throw new PlatformError(403, 'Authority access is required.', 4030);
    }
    const incident = db.incidents.find((entry) => entry.id === incidentId);
    if (!incident) {
      throw new PlatformError(404, 'Incident not found.', 4040);
    }
    if (!AUTHORITY_ACTIONS.includes(action)) {
      throw new PlatformError(400, 'Select a valid authority action.', 4026);
    }
    if (incident.authorityActions.length) {
      throw new PlatformError(409, 'An authority action has already been recorded for this incident.', 4093);
    }

    const entry = {
      id: randomUUID(),
      incidentId: incident.id,
      authorityId: authority.id,
      authorityName: authority.name,
      action,
      notes: String(notes).slice(0, 300),
      createdAt: localNow()
    };
    incident.authorityActions.push(entry);

    if (action === 'verify') {
      incident.status = 'authority_verified';
    }
    if (action === 'respond') {
      incident.status = 'responding';
      incident.respondingAt = localNow();
    }
    if (action === 'resolve') {
      incident.status = 'resolved';
      incident.resolvedAt = localNow();
    }
    if (action === 'dismiss') {
      incident.status = 'dismissed';
      issueStrike(db, incident.reporterId, 'Dismissed as false by authority', authority.id);
    }
    incident.updatedAt = localNow();
    return serializeIncident(db, incident, requesterId);
  });
}

export async function listPendingAuthorities(requesterId) {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (user?.role !== 'admin') {
    throw new PlatformError(403, 'Administrator access is required.', 4031);
  }
  return db.users
    .filter((entry) => entry.role === 'authority' && !entry.verified)
    .map((entry) => serializeUser(db, entry));
}

export async function approveAuthority(requesterId, authorityId) {
  return withDb(async (db) => {
    const user = db.users.find((entry) => entry.id === requesterId);
    if (user?.role !== 'admin') {
      throw new PlatformError(403, 'Administrator access is required.', 4031);
    }
    const authority = db.users.find((entry) => entry.id === authorityId);
    if (!authority) {
      throw new PlatformError(404, 'Authority account not found.', 4041);
    }
    authority.role = 'authority';
    authority.verified = true;
    return serializeUser(db, authority);
  });
}

export async function registerDevice(requesterId, token, platform = 'web') {
  return withDb(async (db) => {
    const existing = db.deviceTokens.find(
      (entry) => entry.userId === requesterId && entry.token === token
    );
    if (!existing) {
      db.deviceTokens.push({
        id: randomUUID(),
        userId: requesterId,
        token,
        platform,
        createdAt: localNow()
      });
    }
    return { ok: true };
  });
}

export async function getNotificationPreferences(requesterId) {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (!user) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }
  return user.notificationPrefs;
}

export async function updateNotificationPreferences(requesterId, payload) {
  return withDb(async (db) => {
    const user = db.users.find((entry) => entry.id === requesterId);
    if (!user) {
      throw new PlatformError(401, 'Authentication required.', 4010);
    }
    const nextCategories = Array.isArray(payload.categories)
      ? payload.categories.filter((entry) => Object.keys(CATEGORY_SUBCATEGORIES).includes(entry))
      : user.notificationPrefs.categories;
    const nextSeverity = SEVERITY_ORDER.includes(payload.minSeverity)
      ? payload.minSeverity
      : user.notificationPrefs.minSeverity;

    user.notificationPrefs = {
      ...user.notificationPrefs,
      ...payload,
      categories: nextCategories,
      minSeverity: nextSeverity,
      radiusKm: Math.min(Math.max(Number(payload.radiusKm || user.notificationPrefs.radiusKm), 1), 25)
    };
    return user.notificationPrefs;
  });
}

export async function getProfile(requesterId) {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (!user) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }
  return {
    user: serializeUser(db, user),
    strikes: activeStrikes(db, requesterId),
    appeals: db.moderationAppeals
      .filter((entry) => entry.userId === requesterId)
      .map((entry) => serializeAppeal(db, entry)),
    notifications: db.notifications
      .filter((entry) => entry.userId === requesterId)
      .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
  };
}

export async function updateProfile(requesterId, payload) {
  return withDb(async (db) => {
    const user = db.users.find((entry) => entry.id === requesterId);
    if (!user) {
      throw new PlatformError(401, 'Authentication required.', 4010);
    }
    if (payload.name) {
      user.name = String(payload.name).trim();
    }
    if (payload.parish) {
      assertParish(payload.parish);
      user.parish = payload.parish;
    }
    if (payload.lastKnownLocation?.lat && payload.lastKnownLocation?.lng) {
      user.lastKnownLocation = {
        lat: Number(payload.lastKnownLocation.lat),
        lng: Number(payload.lastKnownLocation.lng)
      };
    }
    return serializeUser(db, user);
  });
}

export async function listProfileIncidents(requesterId) {
  const db = await loadDb();
  return db.incidents
    .filter((incident) => incident.reporterId === requesterId)
    .map((incident) => serializeIncident(db, incident, requesterId));
}

export async function listProfileActivity(requesterId) {
  const db = await loadDb();
  return {
    items: db.confirmations
      .filter((entry) => entry.userId === requesterId)
      .map((entry) => {
        const incident = db.incidents.find((candidate) => candidate.id === entry.incidentId);
        return {
          id: entry.id,
          action: entry.actionType,
          incidentId: entry.incidentId,
          incidentTitle: incident?.title || 'Incident',
          createdAt: entry.createdAt
        };
      }),
    strikes: activeStrikes(db, requesterId)
  };
}

export async function submitAppeal(requesterId, payload) {
  return withDb(async (db) => {
    if (!payload.strikeId || !payload.message) {
      throw new PlatformError(400, 'Strike and message are required.', 4019);
    }
    const strike = db.strikes.find((entry) => entry.id === payload.strikeId && entry.userId === requesterId);
    if (!strike || strike.status !== 'active') {
      throw new PlatformError(404, 'Strike not found.', 4043);
    }
    if (db.moderationAppeals.some((entry) => entry.strikeId === payload.strikeId)) {
      throw new PlatformError(409, 'An appeal has already been submitted for this strike.', 4092);
    }
    db.moderationAppeals.push({
      id: randomUUID(),
      strikeId: payload.strikeId,
      userId: requesterId,
      message: String(payload.message).slice(0, 500),
      status: 'submitted',
      reviewedAt: null,
      createdAt: localNow()
    });
    return { ok: true };
  });
}

export async function listAppeals(requesterId) {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (!user) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }

  const appeals = user.role === 'admin'
    ? db.moderationAppeals
    : db.moderationAppeals.filter((entry) => entry.userId === requesterId);

  return appeals
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .map((entry) => serializeAppeal(db, entry));
}

export async function reviewAppeal(requesterId, appealId, status) {
  return withDb(async (db) => {
    const admin = db.users.find((entry) => entry.id === requesterId);
    if (admin?.role !== 'admin') {
      throw new PlatformError(403, 'Administrator access is required.', 4031);
    }

    const appeal = db.moderationAppeals.find((entry) => entry.id === appealId);
    if (!appeal) {
      throw new PlatformError(404, 'Appeal not found.', 4044);
    }
    if (!['approved', 'rejected'].includes(status)) {
      throw new PlatformError(400, 'Appeal status must be approved or rejected.', 4020);
    }

    appeal.status = status;
    appeal.reviewedAt = localNow();

    if (status === 'approved') {
      const strike = db.strikes.find((entry) => entry.id === appeal.strikeId);
      if (strike) {
        strike.status = 'removed';
        strike.removedAt = localNow();
        const user = db.users.find((entry) => entry.id === strike.userId);
        if (user) {
          recalculateRestrictions(db, user);
        }
      }
    }

    return serializeAppeal(db, appeal);
  });
}

export async function listComments(incidentId, requesterId = '') {
  const db = await loadDb();
  const incident = db.incidents.find((entry) => entry.id === incidentId);
  if (!incident) {
    throw new PlatformError(404, 'Incident not found.', 4040);
  }
  return listVisibleComments(db, incidentId, requesterId);
}

export async function createComment(incidentId, requesterId, message) {
  return withDb(async (db) => {
    const incident = db.incidents.find((entry) => entry.id === incidentId);
    if (!incident) {
      throw new PlatformError(404, 'Incident not found.', 4040);
    }

    const user = db.users.find((entry) => entry.id === requesterId);
    if (!user) {
      throw new PlatformError(401, 'Authentication required.', 4010);
    }

    assertCanPost(db, user);
    const content = String(message || '').trim();
    if (content.length < 2 || content.length > 400) {
      throw new PlatformError(400, 'Comment must be between 2 and 400 characters.', 4021);
    }

    const moderation = scanContent(content);
    if (!moderation.allowed) {
      throw new PlatformError(400, 'Submission blocked by content policy.', 4015);
    }

    const comment = {
      id: randomUUID(),
      incidentId,
      userId: requesterId,
      message: content,
      createdAt: localNow(),
      deletedAt: null
    };
    db.comments.push(comment);
    return serializeComment(db, comment, requesterId);
  });
}

export async function deleteComment(incidentId, commentId, requesterId) {
  return withDb(async (db) => {
    const comment = db.comments.find(
      (entry) => entry.id === commentId && entry.incidentId === incidentId && !entry.deletedAt
    );
    if (!comment) {
      throw new PlatformError(404, 'Comment not found.', 4045);
    }
    if (comment.userId !== requesterId) {
      throw new PlatformError(403, 'You can only delete your own comments.', 4033);
    }
    comment.deletedAt = localNow();
    return { ok: true };
  });
}

function filterTrendIncidents(db, period, parish, dateFrom = '', dateTo = '') {
  const now = Date.now();
  const windows = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  const window = windows[period] || windows['24h'];
  return db.incidents.filter((incident) => {
    const createdAt = new Date(incident.createdAt).getTime();
    const matchesPeriod = dateFrom || dateTo ? true : now - createdAt <= window;
    const matchesDateFrom = dateFrom ? createdAt >= new Date(dateFrom).getTime() : true;
    const matchesDateTo = dateTo ? createdAt <= new Date(dateTo).getTime() : true;
    const matchesParish = parish ? incident.parish === parish : true;
    return matchesPeriod && matchesDateFrom && matchesDateTo && matchesParish;
  });
}

export async function getTrendCounts(period, parish, dateFrom = '', dateTo = '') {
  const db = await loadDb();
  const items = filterTrendIncidents(db, period, parish, dateFrom, dateTo);
  return {
    counts: items.reduce((accumulator, incident) => {
      accumulator[incident.category] = (accumulator[incident.category] || 0) + 1;
      return accumulator;
    }, {}),
    total: items.length
  };
}

export async function getTrendHeatmap(period, parish, dateFrom = '', dateTo = '') {
  const db = await loadDb();
  return Object.entries(
    filterTrendIncidents(db, period, parish, dateFrom, dateTo).reduce((accumulator, incident) => {
      accumulator[incident.parish] = (accumulator[incident.parish] || 0) + severityIndex(incident.severity) + 1;
      return accumulator;
    }, {})
  ).map(([entryParish, weight]) => ({
    latitude: PARISH_CENTERS[entryParish]?.lat || PARISH_CENTERS.Kingston.lat,
    longitude: PARISH_CENTERS[entryParish]?.lng || PARISH_CENTERS.Kingston.lng,
    weight,
    parish: entryParish
  }));
}

export async function getTopCategories(period, parish, dateFrom = '', dateTo = '') {
  const db = await loadDb();
  const counts = filterTrendIncidents(db, period, parish, dateFrom, dateTo).reduce((accumulator, incident) => {
    accumulator[incident.category] = (accumulator[incident.category] || 0) + 1;
    return accumulator;
  }, {});
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));
}

export async function getSessionUserByEmail(email) {
  const db = await loadDb();
  const normalizedEmail = normalizeEmail(email);
  const user = db.users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
  return user ? serializeUser(db, user) : null;
}
