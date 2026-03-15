import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
const DATA_FILE = path.join(__dirname, '..', 'data', 'local-db.json');

export class PlatformError extends Error {
  constructor(status, message, code = status) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function storageMode() {
  return hasSupabaseConfig() ? 'supabase' : 'local';
}

function assertParish(parish) {
  if (!PARISHES.includes(parish)) {
    throw new PlatformError(400, 'Invalid parish selected.', 4001);
  }
}

function localNow() {
  return new Date().toISOString();
}

function createSeedUsers() {
  const now = localNow();
  return [
    {
      id: randomUUID(),
      email: 'admin@jeip.gov.jm',
      passwordHash: bcrypt.hashSync('Admin123!', 10),
      name: 'JEIP Admin',
      parish: 'Kingston',
      role: 'admin',
      verified: true,
      organizationName: 'JEIP Operations',
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
    pendingPhotoScans: [],
    notifications: []
  };
}

async function loadDb() {
  const supabaseDb = await loadSupabaseDb(createSeedDatabase);
  if (supabaseDb) {
    return supabaseDb;
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

    return db;
  } catch {
    const db = createSeedDatabase();
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
}

async function withDb(run) {
  const db = await loadDb();
  const result = await run(db);
  if (hasSupabaseConfig()) {
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
  if (strikes.length >= 5) {
    user.permanentPostingBan = true;
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

function scanContent(description) {
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
  const location =
    user.lastKnownLocation || PARISH_CENTERS[user.parish] || PARISH_CENTERS.Kingston;
  const distance = haversineKm(location.lat, location.lng, incident.latitude, incident.longitude);
  const prefs = user.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;

  if (!prefs.enabled || isQuietHours(prefs) || !prefs.categories?.includes(incident.category)) {
    return;
  }
  if (severityIndex(incident.severity) < severityIndex(prefs.minSeverity || 'high')) {
    return;
  }
  if (distance > (prefs.radiusKm || 5)) {
    return;
  }

  db.notifications.push({
    id: randomUUID(),
    userId: user.id,
    incidentId: incident.id,
    title: `${incident.category} incident nearby`,
    body: `${incident.severity.toUpperCase()} severity, ${distance.toFixed(1)} km away`,
    distanceKm: Number(distance.toFixed(1)),
    createdAt: localNow(),
    read: false
  });
}

export async function getUserByEmail(email) {
  const db = await loadDb();
  decayStrikes(db);
  return db.users.find((user) => user.email.toLowerCase() === String(email).toLowerCase()) || null;
}

export async function getUserById(id) {
  const db = await loadDb();
  decayStrikes(db);
  const user = db.users.find((entry) => entry.id === id);
  return user ? serializeUser(db, user) : null;
}

export async function verifyCredentials(email, password) {
  const db = await loadDb();
  decayStrikes(db);
  const user = db.users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return null;
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  return valid ? serializeUser(db, user) : null;
}

export async function registerCitizen(payload) {
  return withDb(async (db) => {
    const { email, password, name, parish } = payload;
    assertParish(parish);
    if (!email || !password || !name) {
      throw new PlatformError(400, 'Email, password, name, and parish are required.', 4003);
    }
    if (password.length < 8) {
      throw new PlatformError(400, 'Password must be at least 8 characters.', 4004);
    }
    if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
      throw new PlatformError(409, 'This email is already registered.', 4090);
    }
    const user = {
      id: randomUUID(),
      email: String(email).toLowerCase(),
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
    assertParish(parish);
    if (!email || !password || !name || !organizationName || !badgeNumber) {
      throw new PlatformError(400, 'Authority registration requires organization and badge details.', 4005);
    }
    if (!/\.(gov|org)\.jm$/i.test(email)) {
      throw new PlatformError(400, 'An official Jamaica organization email is required.', 4006);
    }
    if (password.length < 8) {
      throw new PlatformError(400, 'Password must be at least 8 characters.', 4004);
    }
    if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
      throw new PlatformError(409, 'This email is already registered.', 4090);
    }
    const user = {
      id: randomUUID(),
      email: String(email).toLowerCase(),
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

  if (filters.categories?.length) {
    incidents = incidents.filter((incident) => filters.categories.includes(incident.category));
  }
  if (filters.severities?.length) {
    incidents = incidents.filter((incident) => filters.severities.includes(incident.severity));
  }
  if (filters.parish) {
    incidents = incidents.filter((incident) => incident.parish === filters.parish);
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

    const strikeCount = recalculateRestrictions(db, user);
    const canPost =
      !user.permanentPostingBan &&
      !user.restrictedUntil &&
      !(user.role === 'authority' && !user.verified) &&
      strikeCount < 5;
    if (!canPost) {
      throw new PlatformError(403, 'Your account currently has read-only access.', 4032);
    }

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

    const parish = getNearestParish(lat, lng);
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
    if (incident.severity === 'high' || incident.severity === 'critical') {
      for (const candidate of db.users) {
        createNotificationRecord(db, candidate, incident);
      }
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

export async function getAuthorityDashboard(requesterId, parishOverride = '') {
  const db = await loadDb();
  const user = db.users.find((entry) => entry.id === requesterId);
  if (!user) {
    throw new PlatformError(401, 'Authentication required.', 4010);
  }
  if (!(user.role === 'admin' || (user.role === 'authority' && user.verified))) {
    throw new PlatformError(403, 'Authority access is required.', 4030);
  }
  const parish = parishOverride || user.parish;
  const incidents = db.incidents.filter((incident) => incident.parish === parish);
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
    parish,
    incidents: incidents.map((incident) => serializeIncident(db, incident, requesterId)),
    stats
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
    user.notificationPrefs = {
      ...user.notificationPrefs,
      ...payload
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
    notifications: db.notifications.filter((entry) => entry.userId === requesterId)
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
    db.moderationAppeals.push({
      id: randomUUID(),
      strikeId: payload.strikeId,
      userId: requesterId,
      message: String(payload.message).slice(0, 500),
      status: 'submitted',
      createdAt: localNow()
    });
    return { ok: true };
  });
}

function filterTrendIncidents(db, period, parish) {
  const now = Date.now();
  const windows = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  const window = windows[period] || windows['24h'];
  return db.incidents.filter((incident) => {
    const matchesPeriod = now - new Date(incident.createdAt).getTime() <= window;
    const matchesParish = parish ? incident.parish === parish : true;
    return matchesPeriod && matchesParish;
  });
}

export async function getTrendCounts(period, parish) {
  const db = await loadDb();
  const items = filterTrendIncidents(db, period, parish);
  return {
    counts: items.reduce((accumulator, incident) => {
      accumulator[incident.category] = (accumulator[incident.category] || 0) + 1;
      return accumulator;
    }, {}),
    total: items.length
  };
}

export async function getTrendHeatmap(period, parish) {
  const db = await loadDb();
  return filterTrendIncidents(db, period, parish).map((incident) => ({
    latitude: incident.latitude,
    longitude: incident.longitude,
    weight: severityIndex(incident.severity) + 1,
    parish: incident.parish
  }));
}

export async function getTopCategories(period, parish) {
  const db = await loadDb();
  const counts = filterTrendIncidents(db, period, parish).reduce((accumulator, incident) => {
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
  const user = db.users.find((entry) => entry.email.toLowerCase() === String(email).toLowerCase());
  return user ? serializeUser(db, user) : null;
}
