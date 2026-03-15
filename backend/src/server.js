import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');
const JWT_SECRET = process.env.JWT_SECRET || 'jeip-local-secret';
const PORT = Number(process.env.PORT || 4000);
const ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const TOKEN_EXPIRY = '12h';
const OFFLINE_RADIUS_KM = 5;

const PARISHES = [
  'Kingston',
  'St. Andrew',
  'St. Thomas',
  'Portland',
  'St. Mary',
  'St. Ann',
  'Trelawny',
  'St. James',
  'Hanover',
  'Westmoreland',
  'St. Elizabeth',
  'Manchester',
  'Clarendon',
  'St. Catherine'
];

const PARISH_CENTERS = {
  Kingston: { lat: 17.9712, lng: -76.7928 },
  'St. Andrew': { lat: 18.0226, lng: -76.7936 },
  'St. Thomas': { lat: 17.9077, lng: -76.3576 },
  Portland: { lat: 18.176, lng: -76.45 },
  'St. Mary': { lat: 18.356, lng: -76.897 },
  'St. Ann': { lat: 18.405, lng: -77.103 },
  Trelawny: { lat: 18.352, lng: -77.647 },
  'St. James': { lat: 18.4712, lng: -77.9188 },
  Hanover: { lat: 18.409, lng: -78.133 },
  Westmoreland: { lat: 18.166, lng: -78.16 },
  'St. Elizabeth': { lat: 18.051, lng: -77.848 },
  Manchester: { lat: 18.042, lng: -77.507 },
  Clarendon: { lat: 17.964, lng: -77.245 },
  'St. Catherine': { lat: 17.997, lng: -76.955 }
};

const CATEGORY_SUBCATEGORIES = {
  Crime: ['Robbery', 'Assault', 'Suspicious Activity', 'Burglary', 'Violence'],
  Accident: ['Vehicle Collision', 'Pedestrian Injury', 'Road Hazard', 'Fire', 'Marine Incident'],
  'Natural Disaster': ['Flooding', 'Landslide', 'Hurricane Damage', 'Earthquake Impact', 'Storm Surge'],
  Infrastructure: ['Power Outage', 'Water Supply', 'Road Damage', 'Collapsed Drain', 'Bridge Issue'],
  'Community Alert': ['Missing Person', 'School Lockdown', 'Public Health', 'Crowd Surge', 'Evacuation']
};

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
const PROHIBITED_KEYWORDS = ['fake bomb', 'target civilians', 'hate speech'];
const SENSITIVE_KEYWORDS = ['gun', 'knife', 'blood', 'child', 'shooting', 'domestic abuse'];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ORIGIN,
    credentials: true
  }
});

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(
  cors({
    origin: ORIGIN,
    credentials: true
  })
);
app.use(express.json({ limit: '10mb' }));

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false
});

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth', authLimiter);
app.use('/api', publicLimiter);

const seedUsers = () => {
  const now = new Date().toISOString();
  const basePrefs = {
    enabled: false,
    categories: Object.keys(CATEGORY_SUBCATEGORIES),
    minSeverity: 'high',
    radiusKm: 5,
    quietHoursStart: '22:00',
    quietHoursEnd: '06:00'
  };

  return [
    {
      id: nanoid(),
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
      notificationPrefs: basePrefs,
      deviceTokens: [],
      lastKnownLocation: { lat: 17.9712, lng: -76.7928 }
    },
    {
      id: nanoid(),
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
        ...basePrefs,
        enabled: true
      },
      deviceTokens: [],
      lastKnownLocation: { lat: 18.0226, lng: -76.7936 }
    },
    {
      id: nanoid(),
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
      notificationPrefs: basePrefs,
      deviceTokens: [],
      lastKnownLocation: { lat: 17.9798, lng: -76.7939 }
    }
  ];
};

const seedIncidents = (users) => {
  const citizen = users.find((user) => user.role === 'citizen');
  const authority = users.find((user) => user.role === 'authority');
  const now = Date.now();
  const samples = [
    {
      category: 'Crime',
      subcategory: 'Robbery',
      description: 'Armed robbery reported near Half-Way Tree transport centre. Motorists advised to avoid the curbside lane.',
      severity: 'high',
      parish: 'St. Andrew',
      latitude: 18.0125,
      longitude: -76.7933
    },
    {
      category: 'Infrastructure',
      subcategory: 'Power Outage',
      description: 'Multiple blocks without electricity after line failure near Spanish Town Road.',
      severity: 'medium',
      parish: 'Kingston',
      latitude: 17.981,
      longitude: -76.8272
    },
    {
      category: 'Natural Disaster',
      subcategory: 'Flooding',
      description: 'Flood water building under Mandela Highway after intense rainfall. Traffic moving slowly.',
      severity: 'critical',
      parish: 'St. Catherine',
      latitude: 17.9838,
      longitude: -76.913
    },
    {
      category: 'Community Alert',
      subcategory: 'School Lockdown',
      description: 'School temporarily locked down while police investigate a nearby disturbance.',
      severity: 'high',
      parish: 'St. James',
      latitude: 18.4771,
      longitude: -77.8939
    },
    {
      category: 'Accident',
      subcategory: 'Vehicle Collision',
      description: 'Two-vehicle collision causing lane blockage along North Coast Highway.',
      severity: 'medium',
      parish: 'St. Ann',
      latitude: 18.4081,
      longitude: -77.0994
    },
    {
      category: 'Infrastructure',
      subcategory: 'Road Damage',
      description: 'Large road break reported outside Mandeville market entrance.',
      severity: 'low',
      parish: 'Manchester',
      latitude: 18.0414,
      longitude: -77.5071
    }
  ];

  return samples.map((sample, index) => ({
    id: nanoid(),
    reporterId: citizen.id,
    category: sample.category,
    subcategory: sample.subcategory,
    title: `${sample.subcategory} in ${sample.parish}`,
    description: sample.description,
    severity: sample.severity,
    status: index === 2 ? 'responding' : 'active',
    credibility: index < 2 ? 'verified' : 'pending',
    confirmationCount: index < 2 ? 5 : 2,
    disputeCount: index === 5 ? 1 : 0,
    anonymous: index === 3,
    photos: [],
    parish: sample.parish,
    latitude: sample.latitude,
    longitude: sample.longitude,
    address: `${sample.parish}, Jamaica`,
    moderation: {
      sensitive: index === 0,
      flagged: index === 5
    },
    authorityActions:
      index === 2
        ? [
            {
              id: nanoid(),
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
};

const seedDatabase = () => {
  const users = seedUsers();
  const incidents = seedIncidents(users);

  return {
    users,
    incidents,
    confirmations: [],
    strikes: [],
    deviceTokens: [],
    moderationAppeals: [],
    pendingPhotoScans: [],
    notifications: []
  };
};

const ensureDatabase = async () => {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    if (!raw.trim()) {
      const db = seedDatabase();
      await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
      return db;
    }

    const parsed = JSON.parse(raw);
    if (!parsed.users || !parsed.incidents) {
      const db = seedDatabase();
      await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
      return db;
    }

    return parsed;
  } catch {
    const db = seedDatabase();
    await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
    return db;
  }
};

const db = await ensureDatabase();

const persistDatabase = async () => {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2));
};

const createError = (status, error, code = status) => {
  const instance = new Error(error);
  instance.status = status;
  instance.code = code;
  return instance;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatRole = (user) => {
  if (user.role === 'authority' && !user.verified) {
    return 'authority_pending';
  }

  return user.role;
};

const activeStrikesForUser = (userId) =>
  db.strikes.filter((strike) => strike.userId === userId && strike.status === 'active');

const recalculateRestrictions = (user) => {
  const activeStrikes = activeStrikesForUser(user.id).length;
  const now = Date.now();

  if (activeStrikes >= 5) {
    user.permanentPostingBan = true;
  }

  if (user.restrictedUntil && new Date(user.restrictedUntil).getTime() < now) {
    user.restrictedUntil = null;
  }

  return activeStrikes;
};

const decayStrikes = () => {
  const now = Date.now();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;

  for (const user of db.users) {
    const strikes = activeStrikesForUser(user.id).sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );

    if (!strikes.length) {
      continue;
    }

    const mostRecentStrike = strikes[strikes.length - 1];
    if (now - new Date(mostRecentStrike.createdAt).getTime() >= ninetyDays) {
      strikes[0].status = 'decayed';
      strikes[0].decayedAt = new Date(now).toISOString();
      recalculateRestrictions(user);
    }
  }
};

decayStrikes();
await persistDatabase();

const serializeUser = (user) => {
  const strikeCount = recalculateRestrictions(user);
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
};

const generateToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: formatRole(user),
      strikes: activeStrikesForUser(user.id).length,
      canPost: serializeUser(user).canPost
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

const ensureValidParish = (parish) => {
  if (!PARISHES.includes(parish)) {
    throw createError(400, 'Invalid parish selected.', 4001);
  }
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const isWithinJamaica = (latitude, longitude) =>
  latitude >= 17.65 && latitude <= 18.55 && longitude >= -78.45 && longitude <= -76.1;

const getNearestParish = (latitude, longitude) => {
  const ranked = Object.entries(PARISH_CENTERS)
    .map(([parish, center]) => ({
      parish,
      distance: haversineKm(latitude, longitude, center.lat, center.lng)
    }))
    .sort((left, right) => left.distance - right.distance);

  return ranked[0]?.parish || 'Kingston';
};

const scanContent = (description) => {
  const normalized = description.toLowerCase();
  const violations = PROHIBITED_KEYWORDS.filter((entry) => normalized.includes(entry));
  const sensitive = SENSITIVE_KEYWORDS.some((entry) => normalized.includes(entry));

  return {
    allowed: violations.length === 0,
    flagged: sensitive,
    violations
  };
};

const ensureSeverity = (severity = 'medium') => {
  const normalized = String(severity).toLowerCase();
  if (!SEVERITY_ORDER.includes(normalized)) {
    throw createError(400, 'Invalid severity selected.', 4002);
  }

  return normalized;
};

const listIncidentConfirmations = (incidentId) =>
  db.confirmations
    .filter((entry) => entry.incidentId === incidentId)
    .map((entry) => {
      const user = db.users.find((candidate) => candidate.id === entry.userId);
      return {
        id: entry.id,
        action: entry.actionType,
        createdAt: entry.createdAt,
        userName: user?.name || 'Community Member'
      };
    });

const serializeIncident = (incident, requester) => {
  const reporter = db.users.find((user) => user.id === incident.reporterId);
  const confirmationItems = listIncidentConfirmations(incident.id);

  return {
    ...incident,
    confirmations: confirmationItems,
    reporter: incident.anonymous
      ? { name: 'Anonymous Reporter', parish: incident.parish, anonymous: true }
      : {
          name: reporter?.name || 'Community Member',
          parish: reporter?.parish || incident.parish,
          anonymous: false
        },
    canAct: requester ? requester.id !== incident.reporterId : false
  };
};

const issueStrike = (userId, reason, issuedBy) => {
  const strike = {
    id: nanoid(),
    userId,
    reason,
    issuedBy,
    status: 'active',
    createdAt: new Date().toISOString()
  };

  db.strikes.push(strike);
  const user = db.users.find((candidate) => candidate.id === userId);
  const total = recalculateRestrictions(user);

  if (total >= 5) {
    user.permanentPostingBan = true;
  } else if (total >= 3 && !user.restrictedUntil) {
    user.restrictedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  return strike;
};

const isQuietHours = (prefs) => {
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
};

const emitToLocationSubscribers = async (eventName, incident) => {
  const sockets = await io.fetchSockets();

  for (const socket of sockets) {
    const subscription = socket.data.location;
    if (!subscription?.latitude || !subscription?.longitude) {
      continue;
    }

    const radiusKm = Number(subscription.radiusKm || OFFLINE_RADIUS_KM);
    const distance = haversineKm(
      Number(subscription.latitude),
      Number(subscription.longitude),
      incident.latitude,
      incident.longitude
    );

    if (distance <= radiusKm) {
      socket.emit(eventName, serializeIncident(incident));
    }
  }
};

const emitIncidentCreated = async (incident) => {
  io.emit('incident:created', serializeIncident(incident));
  await emitToLocationSubscribers('incident:created', incident);
  if (incident.severity === 'high' || incident.severity === 'critical') {
    io.to(`authority:${incident.parish}`).emit('authority:alert', {
      incident: serializeIncident(incident),
      type: 'high_severity'
    });
  }
};

const emitIncidentUpdated = async (incident) => {
  const payload = serializeIncident(incident);
  io.emit('incident:updated', payload);
  await emitToLocationSubscribers('incident:updated', incident);
  io.to(`incident:${incident.id}`).emit('incident:updated', payload);
};

const createNotificationRecord = (user, incident) => {
  const location = user.lastKnownLocation || PARISH_CENTERS[user.parish] || PARISH_CENTERS.Kingston;
  const distance = haversineKm(location.lat, location.lng, incident.latitude, incident.longitude);
  const prefs = user.notificationPrefs;
  const threshold = SEVERITY_ORDER.indexOf(prefs?.minSeverity || 'high');
  const incidentSeverity = SEVERITY_ORDER.indexOf(incident.severity);

  if (!prefs?.enabled) {
    return null;
  }

  if (isQuietHours(prefs)) {
    return null;
  }

  if (!prefs.categories?.includes(incident.category)) {
    return null;
  }

  if (incidentSeverity < threshold) {
    return null;
  }

  if (distance > (prefs.radiusKm || OFFLINE_RADIUS_KM)) {
    return null;
  }

  const notification = {
    id: nanoid(),
    userId: user.id,
    incidentId: incident.id,
    title: `${incident.category} incident nearby`,
    body: `${incident.severity.toUpperCase()} severity, ${distance.toFixed(1)} km away`,
    distanceKm: Number(distance.toFixed(1)),
    createdAt: new Date().toISOString(),
    read: false
  };

  db.notifications.push(notification);
  io.to(`user:${user.id}`).emit('notification:created', notification);
  return notification;
};

const triggerNotifications = (incident) => {
  if (!['high', 'critical'].includes(incident.severity)) {
    return;
  }

  for (const user of db.users) {
    createNotificationRecord(user, incident);
  }
};

const authenticate = (req, _res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw createError(401, 'Authentication required.', 4010);
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((candidate) => candidate.id === payload.sub);

    if (!user) {
      throw createError(401, 'Authentication required.', 4010);
    }

    recalculateRestrictions(user);
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      next(createError(401, 'Session expired. Please sign in again.', 4011));
      return;
    }

    next(error.status ? error : createError(401, 'Authentication required.', 4010));
  }
};

const optionalAuthenticate = (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }

  authenticate(req, null, next);
};

const requireAuthority = (req, _res, next) => {
  const user = req.user;
  if (!user) {
    next(createError(401, 'Authentication required.', 4010));
    return;
  }

  if (user.role === 'admin' || (user.role === 'authority' && user.verified)) {
    next();
    return;
  }

  next(createError(403, 'Authority access is required.', 4030));
};

const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== 'admin') {
    next(createError(403, 'Administrator access is required.', 4031));
    return;
  }

  next();
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const { email, password, name, parish } = req.body;
    ensureValidParish(parish);

    if (!email || !password || !name) {
      throw createError(400, 'Email, password, name, and parish are required.', 4003);
    }

    if (password.length < 8) {
      throw createError(400, 'Password must be at least 8 characters.', 4004);
    }

    if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
      throw createError(409, 'This email is already registered.', 4090);
    }

    const user = {
      id: nanoid(),
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      name,
      parish,
      role: 'citizen',
      verified: true,
      createdAt: new Date().toISOString(),
      reputationScore: 50,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: {
        enabled: false,
        categories: Object.keys(CATEGORY_SUBCATEGORIES),
        minSeverity: 'high',
        radiusKm: 5,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00'
      },
      deviceTokens: [],
      lastKnownLocation: PARISH_CENTERS[parish]
    };

    db.users.push(user);
    await persistDatabase();
    res.status(201).json({ token: generateToken(user), user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register/authority', async (req, res, next) => {
  try {
    const { email, password, name, parish, organizationName, badgeNumber } = req.body;
    ensureValidParish(parish);

    if (!email || !password || !name || !organizationName || !badgeNumber) {
      throw createError(400, 'Authority registration requires organization and badge details.', 4005);
    }

    if (!/\.(gov|org)\.jm$/i.test(email)) {
      throw createError(400, 'An official Jamaica organization email is required.', 4006);
    }

    if (password.length < 8) {
      throw createError(400, 'Password must be at least 8 characters.', 4004);
    }

    if (db.users.some((user) => user.email.toLowerCase() === String(email).toLowerCase())) {
      throw createError(409, 'This email is already registered.', 4090);
    }

    const user = {
      id: nanoid(),
      email: String(email).toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      name,
      parish,
      role: 'authority',
      verified: false,
      organizationName,
      badgeNumber,
      createdAt: new Date().toISOString(),
      reputationScore: 65,
      restrictedUntil: null,
      permanentPostingBan: false,
      notificationPrefs: {
        enabled: true,
        categories: Object.keys(CATEGORY_SUBCATEGORIES),
        minSeverity: 'high',
        radiusKm: 12,
        quietHoursStart: '23:00',
        quietHoursEnd: '05:00'
      },
      deviceTokens: [],
      lastKnownLocation: PARISH_CENTERS[parish]
    };

    db.users.push(user);
    await persistDatabase();
    res.status(201).json({
      token: generateToken(user),
      user: serializeUser(user),
      message: 'Authority account created and marked for manual verification.'
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find((candidate) => candidate.email.toLowerCase() === String(email).toLowerCase());

    if (!user) {
      throw createError(401, 'Invalid email or password.', 4012);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw createError(401, 'Invalid email or password.', 4012);
    }

    await persistDatabase();
    res.json({ token: generateToken(user), user: serializeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/refresh', authenticate, async (req, res, next) => {
  try {
    res.json({ token: generateToken(req.user), user: serializeUser(req.user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', authenticate, async (req, res, next) => {
  try {
    res.json({ user: serializeUser(req.user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/incidents/nearby', optionalAuthenticate, (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = clamp(Number(req.query.radiusKm || OFFLINE_RADIUS_KM), 1, 50);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      throw createError(400, 'Latitude and longitude are required.', 4007);
    }

    const items = db.incidents
      .filter((incident) => haversineKm(lat, lng, incident.latitude, incident.longitude) <= radiusKm)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .map((incident) => serializeIncident(incident, req.user));

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.get('/api/incidents', optionalAuthenticate, (req, res, next) => {
  try {
    const categories = req.query.categories ? String(req.query.categories).split(',') : [];
    const severities = req.query.severities ? String(req.query.severities).split(',') : [];
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = clamp(Number(req.query.limit || 10), 1, 40);
    const startTime = req.query.startTime ? new Date(String(req.query.startTime)).getTime() : null;
    const endTime = req.query.endTime ? new Date(String(req.query.endTime)).getTime() : null;
    const parish = req.query.parish ? String(req.query.parish) : null;

    let filtered = [...db.incidents];

    if (categories.length) {
      filtered = filtered.filter((incident) => categories.includes(incident.category));
    }

    if (severities.length) {
      filtered = filtered.filter((incident) => severities.includes(incident.severity));
    }

    if (startTime) {
      filtered = filtered.filter((incident) => new Date(incident.createdAt).getTime() >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter((incident) => new Date(incident.createdAt).getTime() <= endTime);
    }

    if (parish) {
      filtered = filtered.filter((incident) => incident.parish === parish);
    }

    filtered.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    const startIndex = (page - 1) * limit;
    const items = filtered
      .slice(startIndex, startIndex + limit)
      .map((incident) => serializeIncident(incident, req.user));

    res.json({
      items,
      page,
      limit,
      total: filtered.length,
      hasMore: startIndex + limit < filtered.length
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/incidents/:id', optionalAuthenticate, (req, res, next) => {
  try {
    const incident = db.incidents.find((entry) => entry.id === req.params.id);
    if (!incident) {
      throw createError(404, 'Incident not found.', 4040);
    }

    res.json({ incident: serializeIncident(incident, req.user) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/incidents', authenticate, async (req, res, next) => {
  try {
    const user = req.user;
    const strikeCount = recalculateRestrictions(user);
    const canPost =
      !user.permanentPostingBan &&
      !(user.role === 'authority' && !user.verified) &&
      !user.restrictedUntil &&
      strikeCount < 5;

    if (!canPost) {
      throw createError(403, 'Your account currently has read-only access.', 4032);
    }

    const {
      category,
      subcategory,
      description,
      latitude,
      longitude,
      severity,
      photos = [],
      anonymous = false,
      address = ''
    } = req.body;

    if (!CATEGORY_SUBCATEGORIES[category]) {
      throw createError(400, 'Select a valid incident category.', 4008);
    }

    if (!CATEGORY_SUBCATEGORIES[category].includes(subcategory)) {
      throw createError(400, 'Select a valid incident subcategory.', 4009);
    }

    if (!description || description.length < 10 || description.length > 500) {
      throw createError(400, 'Description must be between 10 and 500 characters.', 4013);
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!isWithinJamaica(lat, lng)) {
      throw createError(400, 'Incident location must be within Jamaica.', 4014);
    }

    const moderation = scanContent(description);
    if (!moderation.allowed) {
      throw createError(400, 'Submission blocked by content policy.', 4015);
    }

    const validSeverity = ensureSeverity(severity);
    const uploadablePhotos = Array.isArray(photos) ? photos.slice(0, 3) : [];
    const storedPhotos = [];
    let photoWarning = '';

    for (const photo of uploadablePhotos) {
      const isSupported = ['image/jpeg', 'image/png'].includes(photo.type);
      const isSmallEnough = Number(photo.size || 0) <= 5 * 1024 * 1024;

      if (!isSupported || !isSmallEnough) {
        throw createError(400, 'Photos must be JPEG or PNG and 5MB or less.', 4016);
      }

      try {
        if (!photo.dataUrl) {
          throw new Error('Missing image data');
        }

        storedPhotos.push({
          id: nanoid(),
          name: photo.name,
          type: photo.type,
          size: photo.size,
          url: photo.dataUrl,
          scanStatus: 'queued'
        });
      } catch {
        photoWarning = 'One or more photos could not be stored. The incident was created without them.';
      }
    }

    const parish = getNearestParish(lat, lng);
    const incident = {
      id: nanoid(),
      reporterId: user.id,
      category,
      subcategory,
      title: `${subcategory} in ${parish}`,
      description,
      severity: validSeverity,
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    db.incidents.unshift(incident);

    for (const photo of storedPhotos) {
      db.pendingPhotoScans.push({
        id: nanoid(),
        incidentId: incident.id,
        photoId: photo.id,
        status: 'queued',
        createdAt: new Date().toISOString()
      });
    }

    await persistDatabase();
    await emitIncidentCreated(incident);
    triggerNotifications(incident);
    res.status(201).json({
      incident: serializeIncident(incident, user),
      photoWarning
    });
  } catch (error) {
    next(error);
  }
});

const applyConfirmation = async (req, res, next, actionType) => {
  try {
    const user = req.user;
    const incident = db.incidents.find((entry) => entry.id === req.params.id);

    if (!incident) {
      throw createError(404, 'Incident not found.', 4040);
    }

    if (incident.reporterId === user.id) {
      throw createError(400, 'You cannot vote on your own incident.', 4017);
    }

    const existing = db.confirmations.find(
      (entry) => entry.incidentId === incident.id && entry.userId === user.id
    );

    if (existing) {
      throw createError(409, 'You have already confirmed or disputed this incident.', 4091);
    }

    const confirmation = {
      id: nanoid(),
      incidentId: incident.id,
      userId: user.id,
      actionType,
      createdAt: new Date().toISOString()
    };

    db.confirmations.push(confirmation);

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

    incident.updatedAt = new Date().toISOString();
    await persistDatabase();
    io.emit('incident:confirmed', {
      id: incident.id,
      confirmationCount: incident.confirmationCount,
      disputeCount: incident.disputeCount
    });
    await emitIncidentUpdated(incident);
    res.json({
      confirmationCount: incident.confirmationCount,
      disputeCount: incident.disputeCount,
      credibilityStatus: incident.credibility
    });
  } catch (error) {
    next(error);
  }
};

app.post('/api/incidents/:id/confirm', authenticate, (req, res, next) =>
  applyConfirmation(req, res, next, 'confirm')
);

app.post('/api/incidents/:id/dispute', authenticate, (req, res, next) =>
  applyConfirmation(req, res, next, 'dispute')
);

app.get('/api/authority/dashboard', authenticate, requireAuthority, (req, res, next) => {
  try {
    const parish = req.query.parish ? String(req.query.parish) : req.user.parish;
    const incidents = db.incidents.filter((incident) => incident.parish === parish);
    const stats = incidents.reduce(
      (accumulator, incident) => {
        if (incident.status === 'active' || incident.status === 'responding' || incident.status === 'authority_verified') {
          accumulator.totalActive += 1;
        }

        accumulator.byCategory[incident.category] = (accumulator.byCategory[incident.category] || 0) + 1;
        accumulator.bySeverity[incident.severity] = (accumulator.bySeverity[incident.severity] || 0) + 1;
        return accumulator;
      },
      {
        totalActive: 0,
        byCategory: {},
        bySeverity: {}
      }
    );

    res.json({
      parish,
      incidents: incidents.map((incident) => serializeIncident(incident, req.user)),
      stats
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/authority/incidents', authenticate, requireAuthority, (req, res, next) => {
  try {
    const parish = req.query.parish ? String(req.query.parish) : req.user.parish;
    const incidents = db.incidents
      .filter((incident) => incident.parish === parish)
      .map((incident) => serializeIncident(incident, req.user));

    res.json({ items: incidents });
  } catch (error) {
    next(error);
  }
});

const applyAuthorityAction = async (req, res, next, action) => {
  try {
    const incident = db.incidents.find((entry) => entry.id === req.params.id);
    if (!incident) {
      throw createError(404, 'Incident not found.', 4040);
    }

    const authority = req.user;
    const notes = String(req.body.notes || '').slice(0, 300);
    const entry = {
      id: nanoid(),
      incidentId: incident.id,
      authorityId: authority.id,
      authorityName: authority.name,
      action,
      notes,
      createdAt: new Date().toISOString()
    };

    incident.authorityActions.push(entry);

    if (action === 'verify') {
      incident.status = 'authority_verified';
    }

    if (action === 'respond') {
      incident.status = 'responding';
      incident.respondingAt = new Date().toISOString();
    }

    if (action === 'resolve') {
      incident.status = 'resolved';
      incident.resolvedAt = new Date().toISOString();
    }

    if (action === 'dismiss') {
      incident.status = 'dismissed';
      issueStrike(incident.reporterId, 'Dismissed as false by authority', authority.id);
    }

    incident.updatedAt = new Date().toISOString();
    await persistDatabase();
    await emitIncidentUpdated(incident);
    res.json({ incident: serializeIncident(incident, req.user) });
  } catch (error) {
    next(error);
  }
};

app.post('/api/authority/incidents/:id/verify', authenticate, requireAuthority, (req, res, next) =>
  applyAuthorityAction(req, res, next, 'verify')
);
app.post('/api/authority/incidents/:id/respond', authenticate, requireAuthority, (req, res, next) =>
  applyAuthorityAction(req, res, next, 'respond')
);
app.post('/api/authority/incidents/:id/resolve', authenticate, requireAuthority, (req, res, next) =>
  applyAuthorityAction(req, res, next, 'resolve')
);
app.post('/api/authority/incidents/:id/dismiss', authenticate, requireAuthority, (req, res, next) =>
  applyAuthorityAction(req, res, next, 'dismiss')
);

app.post('/api/admin/authorities/:id/approve', authenticate, requireAdmin, async (req, res, next) => {
  try {
    const authority = db.users.find((user) => user.id === req.params.id);
    if (!authority) {
      throw createError(404, 'Authority account not found.', 4041);
    }

    authority.role = 'authority';
    authority.verified = true;
    await persistDatabase();
    res.json({ user: serializeUser(authority) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/authorities/pending', authenticate, requireAdmin, (req, res) => {
  const items = db.users
    .filter((user) => user.role === 'authority' && !user.verified)
    .map((user) => serializeUser(user));

  res.json({ items });
});

app.post('/api/notifications/register', authenticate, async (req, res, next) => {
  try {
    const { token, platform = 'web' } = req.body;
    if (!token) {
      throw createError(400, 'Device token is required.', 4018);
    }

    const existing = db.deviceTokens.find((entry) => entry.token === token && entry.userId === req.user.id);
    if (!existing) {
      db.deviceTokens.push({
        id: nanoid(),
        userId: req.user.id,
        token,
        platform,
        createdAt: new Date().toISOString()
      });
    }

    await persistDatabase();
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/notifications/preferences', authenticate, (req, res) => {
  res.json({ preferences: req.user.notificationPrefs });
});

app.put('/api/notifications/preferences', authenticate, async (req, res, next) => {
  try {
    req.user.notificationPrefs = {
      ...req.user.notificationPrefs,
      ...req.body
    };

    await persistDatabase();
    res.json({ preferences: req.user.notificationPrefs });
  } catch (error) {
    next(error);
  }
});

app.get('/api/profile', authenticate, (req, res) => {
  const strikes = activeStrikesForUser(req.user.id);
  res.json({
    user: serializeUser(req.user),
    strikes,
    notifications: db.notifications.filter((entry) => entry.userId === req.user.id)
  });
});

app.put('/api/profile', authenticate, async (req, res, next) => {
  try {
    const { name, parish, lastKnownLocation } = req.body;
    if (name) {
      req.user.name = String(name).trim();
    }

    if (parish) {
      ensureValidParish(parish);
      req.user.parish = parish;
    }

    if (lastKnownLocation?.lat && lastKnownLocation?.lng) {
      req.user.lastKnownLocation = {
        lat: Number(lastKnownLocation.lat),
        lng: Number(lastKnownLocation.lng)
      };
    }

    await persistDatabase();
    res.json({ user: serializeUser(req.user) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/profile/incidents', authenticate, (req, res) => {
  const items = db.incidents
    .filter((incident) => incident.reporterId === req.user.id)
    .map((incident) => serializeIncident(incident, req.user));

  res.json({ items });
});

app.get('/api/profile/activity', authenticate, (req, res) => {
  const activities = db.confirmations
    .filter((entry) => entry.userId === req.user.id)
    .map((entry) => {
      const incident = db.incidents.find((candidate) => candidate.id === entry.incidentId);
      return {
        id: entry.id,
        action: entry.actionType,
        incidentId: entry.incidentId,
        incidentTitle: incident?.title || 'Incident',
        createdAt: entry.createdAt
      };
    });

  res.json({
    items: activities,
    strikes: activeStrikesForUser(req.user.id)
  });
});

app.post('/api/moderation/appeals', authenticate, async (req, res, next) => {
  try {
    const { strikeId, message } = req.body;
    if (!strikeId || !message) {
      throw createError(400, 'Strike and message are required.', 4019);
    }

    db.moderationAppeals.push({
      id: nanoid(),
      strikeId,
      userId: req.user.id,
      message: String(message).slice(0, 500),
      status: 'submitted',
      createdAt: new Date().toISOString()
    });

    await persistDatabase();
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

const filterIncidentsByPeriod = (period, parish) => {
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
};

app.get('/api/trends/counts', (req, res) => {
  const items = filterIncidentsByPeriod(String(req.query.period || '24h'), req.query.parish);
  const counts = items.reduce((accumulator, incident) => {
    accumulator[incident.category] = (accumulator[incident.category] || 0) + 1;
    return accumulator;
  }, {});

  res.json({ counts, total: items.length });
});

app.get('/api/trends/heatmap', (req, res) => {
  const items = filterIncidentsByPeriod(String(req.query.period || '24h'), req.query.parish).map((incident) => ({
    latitude: incident.latitude,
    longitude: incident.longitude,
    weight: SEVERITY_ORDER.indexOf(incident.severity) + 1,
    parish: incident.parish
  }));

  res.json({ items });
});

app.get('/api/trends/top-categories', (req, res) => {
  const items = filterIncidentsByPeriod(String(req.query.period || '24h'), req.query.parish);
  const counts = items.reduce((accumulator, incident) => {
    accumulator[incident.category] = (accumulator[incident.category] || 0) + 1;
    return accumulator;
  }, {});
  const categories = Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));

  res.json({ items: categories });
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  res.status(status).json({
    error: error.message || 'Unexpected server error.',
    code: error.code || status
  });
});

io.on('connection', (socket) => {
  const token = socket.handshake.auth?.token;

  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = db.users.find((candidate) => candidate.id === payload.sub);
      if (user) {
        socket.data.userId = user.id;
        socket.join(`user:${user.id}`);
        if (user.role === 'authority' && user.verified) {
          socket.join(`authority:${user.parish}`);
        }
      }
    } catch {
      // Keep anonymous connection alive for public feed access.
    }
  }

  socket.on('subscribe:location', (payload) => {
    socket.data.location = payload;
  });

  socket.on('subscribe:incident', ({ incidentId }) => {
    socket.join(`incident:${incidentId}`);
  });

  socket.on('unsubscribe:incident', ({ incidentId }) => {
    socket.leave(`incident:${incidentId}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`JEIP backend running on http://localhost:${PORT}`);
});
