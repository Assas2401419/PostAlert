import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'node:test';

import bcrypt from 'bcryptjs';

const TEST_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'postalert-property-'));
const TEST_DB_FILE = path.join(TEST_ROOT, 'local-db.json');

process.env.POSTALERT_STORAGE_MODE = 'local';
process.env.POSTALERT_DATA_FILE = TEST_DB_FILE;

const {
  CATEGORY_SUBCATEGORIES,
  DEFAULT_NOTIFICATION_PREFS,
  MAP_BOUNDS,
  PARISHES,
  PARISH_CENTERS
} = await import('../lib/constants.js');
const { fail } = await import('../lib/api-response.js');
const { withinJamaica } = await import('../lib/utils.js');
const {
  PlatformError,
  applyAuthorityAction,
  approveAuthority,
  assignParish,
  confirmIncident,
  createComment,
  createIncident,
  deleteComment,
  disputeIncident,
  generateResetToken,
  getAuthorityDashboard,
  getIncidentById,
  getNotificationPreferences,
  getProfile,
  getSessionUserByEmail,
  getTopCategories,
  getTrendCounts,
  getTrendHeatmap,
  getUserByEmail,
  getUserById,
  listAppeals,
  listComments,
  listIncidents,
  listPendingAuthorities,
  listProfileActivity,
  listProfileIncidents,
  registerAuthority,
  registerCitizen,
  registerDevice,
  resetPassword,
  reviewAppeal,
  scanContent,
  submitAppeal,
  updateNotificationPreferences,
  updateProfile,
  validateCredentials,
  verifyCredentials
} = await import('../lib/platform-store.js');
const registerRoute = await import('../app/api/auth/register/route.js');
const resetRoute = await import('../app/api/auth/reset-password/route.js');

beforeEach(async () => {
  await fs.rm(TEST_DB_FILE, { force: true });
});

function randomEmail(prefix = 'user', domain = 'example.com') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@${domain}`;
}

function assertSessionUser(user) {
  assert.ok(user, 'expected an authenticated session user');
  return user;
}

function buildQuietWindowOutsideNow() {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const start = (currentMinutes + 60) % (24 * 60);
  const end = (currentMinutes + 120) % (24 * 60);
  const toTime = (value) =>
    `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

  return {
    quietHoursStart: toTime(start),
    quietHoursEnd: toTime(end)
  };
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureDb() {
  if (!(await fileExists(TEST_DB_FILE))) {
    await listIncidents();
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(TEST_DB_FILE, 'utf8'));
}

async function writeDb(db) {
  await fs.writeFile(TEST_DB_FILE, JSON.stringify(db, null, 2));
}

async function patchDb(mutator) {
  const db = await readDb();
  await mutator(db);
  await writeDb(db);
}

async function expectPlatformError(run, expectedCode) {
  await assert.rejects(run, (error) => {
    assert.ok(error instanceof PlatformError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function makeCitizenPayload(index, overrides = {}) {
  return {
    email: randomEmail(`citizen-${index}`),
    password: `Citizen${index}!123`,
    name: `Citizen ${index}`,
    parish: PARISHES[index % PARISHES.length],
    ...overrides
  };
}

function makeAuthorityPayload(index, overrides = {}) {
  return {
    email: randomEmail(`authority-${index}`, 'agency.gov.jm'),
    password: `Authority${index}!123`,
    name: `Authority ${index}`,
    parish: PARISHES[index % PARISHES.length],
    organizationName: `Agency ${index}`,
    badgeNumber: `BADGE-${index}`,
    ...overrides
  };
}

async function seedAdmin() {
  return assertSessionUser(await verifyCredentials('admin@postalert.gov.jm', 'Admin123!'));
}

async function seedOfficer() {
  return assertSessionUser(await verifyCredentials('officer@jcf.gov.jm', 'Officer123!'));
}

async function seedCitizen() {
  return assertSessionUser(await verifyCredentials('marlon@example.com', 'Citizen123!'));
}

async function createCitizen(index, overrides = {}) {
  const payload = makeCitizenPayload(index, overrides);
  const user = await registerCitizen(payload);
  return { payload, user };
}

async function createAuthority(index, overrides = {}) {
  const payload = makeAuthorityPayload(index, overrides);
  const user = await registerAuthority(payload);
  return { payload, user };
}

function incidentPayloadFor(parish, overrides = {}) {
  const center = PARISH_CENTERS[parish];
  const category = overrides.category || 'Crime';
  const subcategory =
    overrides.subcategory || CATEGORY_SUBCATEGORIES[category][0];

  return {
    category,
    subcategory,
    description:
      overrides.description ||
      `${subcategory} reported near ${parish} with enough detail for validation.`,
    latitude: overrides.latitude ?? center.lat,
    longitude: overrides.longitude ?? center.lng,
    severity: overrides.severity || 'medium',
    anonymous: Boolean(overrides.anonymous),
    photos: overrides.photos || [],
    address: overrides.address || `${parish}, Jamaica`
  };
}

async function createIncidentForUser(userId, parish = 'Kingston', overrides = {}) {
  const response = await createIncident(incidentPayloadFor(parish, overrides), userId);
  return response.incident;
}

async function createRestrictedUser(index) {
  const { user } = await createCitizen(index, { parish: 'Kingston' });
  const officer = await seedOfficer();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const incident = await createIncidentForUser(user.id, 'Kingston', {
      description: `Dismissible report ${attempt} with enough content for moderation review.`
    });
    await applyAuthorityAction(officer.id, incident.id, 'dismiss', 'False report');
  }
  return assertSessionUser(await getSessionUserByEmail(user.email));
}

async function addRawStrikes(userId, count, createdAt = new Date().toISOString()) {
  await patchDb((db) => {
    const user = db.users.find((entry) => entry.id === userId);
    for (let index = 0; index < count; index += 1) {
      db.strikes.push({
        id: randomUUID(),
        userId,
        reason: `Synthetic strike ${index + 1}`,
        issuedBy: 'test',
        status: 'active',
        createdAt,
        decayedAt: null
      });
    }
    if (user && count >= 3) {
      user.restrictedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
  });
}

test('1.3 registration properties', async () => {
  for (let index = 0; index < 3; index += 1) {
    const payload = makeCitizenPayload(index);
    const user = await registerCitizen(payload);
    const db = await readDb();
    const rawUser = db.users.find((entry) => entry.email === payload.email);

    assert.equal(user.role, 'citizen');
    assert.equal(user.reputationScore, 50);
    assert.equal(user.canPost, true);
    assert.ok(rawUser);
    assert.notEqual(rawUser.passwordHash, payload.password);
    assert.equal(await bcrypt.compare(payload.password, rawUser.passwordHash), true);
  }

  const authority = await registerAuthority(makeAuthorityPayload(1));
  assert.equal(authority.role, 'authority_pending');
  assert.equal(authority.reputationScore, 65);
  assert.equal(authority.readOnly, true);

  const duplicate = makeCitizenPayload(90);
  await registerCitizen(duplicate);
  await expectPlatformError(() => registerCitizen(duplicate), 4090);
  await expectPlatformError(
    () => registerCitizen(makeCitizenPayload(91, { password: 'short' })),
    4004
  );
  await expectPlatformError(
    () =>
      registerAuthority(
        makeAuthorityPayload(92, {
          email: randomEmail('bad-authority', 'gmail.com')
        })
      ),
    4006
  );
});

test('1.5 authentication properties', async () => {
  for (let index = 0; index < 3; index += 1) {
    const { payload } = await createCitizen(index);
    const authenticated = await verifyCredentials(payload.email, payload.password);
    assert.equal(authenticated?.email, payload.email);
  }

  assert.equal(await verifyCredentials('unknown@example.com', 'Wrong123!'), null);
  const { payload } = await createCitizen(80);
  assert.equal(await verifyCredentials(payload.email, 'Wrong123!'), null);
  assert.equal(
    (await verifyCredentials(` ${payload.email.toUpperCase()} `, payload.password))?.email,
    payload.email
  );
  await expectPlatformError(() => validateCredentials('unknown@example.com', 'Wrong123!'), 4024);
  await expectPlatformError(() => validateCredentials(payload.email, 'Wrong123!'), 4025);
});

test('1.8 password reset properties', async () => {
  const { payload } = await createCitizen(1);
  const first = await generateResetToken(payload.email);
  const second = await generateResetToken(payload.email);

  await expectPlatformError(() => resetPassword(first.resetToken, 'NewReset123!'), 4007);
  await resetPassword(second.resetToken, 'NewReset123!');
  assert.equal(await verifyCredentials(payload.email, payload.password), null);
  assert.equal((await verifyCredentials(payload.email, 'NewReset123!'))?.email, payload.email);

  const expiredUser = await createCitizen(2);
  const expired = await generateResetToken(expiredUser.payload.email);
  const expiredRawUser = await getUserByEmail(expiredUser.payload.email);
  await patchDb((db) => {
    const token = db.passwordResetTokens.find(
      (entry) => entry.userId === expiredRawUser.id && !entry.usedAt && !entry.invalidatedAt
    );
    token.expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  });
  await expectPlatformError(() => resetPassword(expired.resetToken, 'Another123!'), 4007);
});

test('3.2 content moderation properties', async () => {
  const citizen = await seedCitizen();
  for (const keyword of ['fake bomb', 'target civilians', 'hate speech']) {
    const result = scanContent(`Witness says there is a ${keyword} event in town.`);
    assert.equal(result.allowed, false);
    await expectPlatformError(
      () =>
        createIncident(
          incidentPayloadFor('Kingston', {
            description: `This report contains ${keyword} and should be blocked.`
          }),
          citizen.id
        ),
      4015
    );
  }

  for (const keyword of ['gun', 'blood', 'child']) {
    const result = scanContent(`The situation references ${keyword} but remains reviewable.`);
    assert.equal(result.allowed, true);
    assert.equal(result.flagged, true);
    const incident = await createIncidentForUser(citizen.id, 'Kingston', {
      description: `Witnesses reported ${keyword} at the scene and officers are needed urgently.`
    });
    assert.equal(incident.moderation.sensitive, true);
  }
});

test('3.4 location validation properties', async () => {
  for (let index = 0; index < 10; index += 1) {
    const latitude = MAP_BOUNDS.latMin + Math.random() * (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin);
    const longitude = MAP_BOUNDS.lngMin + Math.random() * (MAP_BOUNDS.lngMax - MAP_BOUNDS.lngMin);
    assert.equal(withinJamaica(latitude, longitude), true);
  }

  for (const point of [
    { lat: MAP_BOUNDS.latMin - 0.2, lng: -77 },
    { lat: MAP_BOUNDS.latMax + 0.2, lng: -77 },
    { lat: 18.0, lng: MAP_BOUNDS.lngMin - 0.2 },
    { lat: 18.0, lng: MAP_BOUNDS.lngMax + 0.2 }
  ]) {
    assert.equal(withinJamaica(point.lat, point.lng), false);
  }

  for (const parish of PARISHES.slice(0, 6)) {
    const center = PARISH_CENTERS[parish];
    const assigned = assignParish(center.lat + 0.01, center.lng - 0.01);
    assert.equal(assigned, parish);
  }
});

test('3.6 incident creation properties', async () => {
  const citizen = await seedCitizen();

  for (const [category, subcategories] of Object.entries(CATEGORY_SUBCATEGORIES)) {
    const incident = await createIncidentForUser(citizen.id, 'Kingston', {
      category,
      subcategory: subcategories[0]
    });
    assert.equal(incident.category, category);
    assert.equal(incident.subcategory, subcategories[0]);
    assert.match(incident.title, / in /);
  }

  await expectPlatformError(
    () =>
      createIncident(
        incidentPayloadFor('Kingston', { description: 'Too short' }),
        citizen.id
      ),
    4013
  );
  await expectPlatformError(
    () =>
      createIncident(
        incidentPayloadFor('Kingston', { description: 'A'.repeat(501) }),
        citizen.id
      ),
    4013
  );

  for (const severity of ['low', 'medium', 'high', 'critical']) {
    const incident = await createIncidentForUser(citizen.id, 'Kingston', { severity });
    assert.equal(incident.severity, severity);
  }

  const anonymous = await createIncidentForUser(citizen.id, 'Kingston', {
    anonymous: true
  });
  assert.equal(anonymous.reporter.name, 'Anonymous Reporter');
  assert.equal(anonymous.reporter.anonymous, true);
});

test('3.8 photo validation properties', async () => {
  const citizen = await seedCitizen();
  const incident = await createIncidentForUser(citizen.id, 'Kingston', {
    photos: [
      {
        name: 'scene.png',
        type: 'image/png',
        size: 1024,
        dataUrl: 'data:image/png;base64,AAAA'
      }
    ]
  });

  assert.equal(incident.photos.length, 1);
  assert.ok(incident.photos[0].id);
  assert.equal(incident.photos[0].name, 'scene.png');
  assert.equal(incident.photos[0].type, 'image/png');
  assert.equal(incident.photos[0].size, 1024);
  assert.equal(incident.photos[0].scanStatus, 'queued');

  await expectPlatformError(
    () =>
      createIncident(
        incidentPayloadFor('Kingston', {
          photos: [
            {
              name: 'scene.gif',
              type: 'image/gif',
              size: 1024,
              dataUrl: 'data:image/gif;base64,BBBB'
            }
          ]
        }),
        citizen.id
      ),
    4016
  );

  await expectPlatformError(
    () =>
      createIncident(
        incidentPayloadFor('Kingston', {
          photos: [
            {
              name: 'large.png',
              type: 'image/png',
              size: 6 * 1024 * 1024,
              dataUrl: 'data:image/png;base64,CCCC'
            }
          ]
        }),
        citizen.id
      ),
    4016
  );
});

test('5.2 incident listing properties', async () => {
  const citizen = await seedCitizen();
  const created = [];
  for (let index = 0; index < 10; index += 1) {
    created.push(
      await createIncidentForUser(
        citizen.id,
        index % 2 === 0 ? 'Kingston' : 'St. Andrew',
        {
          category: index % 2 === 0 ? 'Crime' : 'Infrastructure',
          subcategory:
            index % 2 === 0
              ? CATEGORY_SUBCATEGORIES.Crime[0]
              : CATEGORY_SUBCATEGORIES.Infrastructure[0],
          severity: index % 3 === 0 ? 'high' : 'medium'
        }
      )
    );
  }

  await patchDb((db) => {
    created.forEach((incident, index) => {
      const entry = db.incidents.find((candidate) => candidate.id === incident.id);
      entry.createdAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
      entry.updatedAt = entry.createdAt;
    });
  });

  const filtered = await listIncidents({
    categories: ['Crime'],
    severities: ['high'],
    parish: 'Kingston'
  });
  assert.ok(filtered.items.length > 0);
  assert.equal(
    filtered.items.every(
      (incident) =>
        incident.category === 'Crime' &&
        incident.severity === 'high' &&
        incident.parish === 'Kingston'
    ),
    true
  );

  const pageOne = await listIncidents({ page: 1, limit: 8 });
  const pageTwo = await listIncidents({ page: 2, limit: 8 });
  assert.equal(pageOne.items.length, 8);
  assert.equal(pageOne.hasMore, true);
  assert.ok(new Date(pageOne.items[0].createdAt) > new Date(pageOne.items[1].createdAt));
  assert.equal(pageTwo.items.length >= 2, true);
});

test('5.4 incident serialization properties', async () => {
  const citizen = await seedCitizen();
  const incident = await createIncidentForUser(citizen.id, 'Kingston', {
    photos: [
      {
        name: 'proof.jpg',
        type: 'image/jpeg',
        size: 2048,
        dataUrl: 'data:image/jpeg;base64,DDDD'
      }
    ]
  });
  const detail = await getIncidentById(incident.id, citizen.id);
  const listItem = (await listIncidents({ page: 1, limit: 8 }, citizen.id)).items.find(
    (entry) => entry.id === incident.id
  );

  for (const key of [
    'id',
    'category',
    'subcategory',
    'title',
    'description',
    'severity',
    'status',
    'credibility',
    'confirmationCount',
    'disputeCount',
    'parish',
    'latitude',
    'longitude',
    'photos',
    'authorityActions',
    'reporter',
    'createdAt',
    'updatedAt'
  ]) {
    assert.ok(key in detail);
  }

  assert.equal(detail.id, listItem.id);
  assert.equal(detail.title, listItem.title);
  assert.equal(detail.description, listItem.description);
  assert.equal(detail.photos[0].name, 'proof.jpg');
});

test('8.4 voting system properties', async () => {
  const reporter = await createCitizen(10);
  const incident = await createIncidentForUser(reporter.user.id, 'Kingston');
  const voter = await createCitizen(11);

  const confirmResult = await confirmIncident(incident.id, voter.user.id);
  assert.equal(confirmResult.confirmationCount, 1);
  await expectPlatformError(() => confirmIncident(incident.id, reporter.user.id), 4017);
  await expectPlatformError(() => confirmIncident(incident.id, voter.user.id), 4091);

  const verifiedIncident = await createIncidentForUser(reporter.user.id, 'Kingston');
  for (let index = 0; index < 5; index += 1) {
    const nextVoter = await createCitizen(20 + index);
    await confirmIncident(verifiedIncident.id, nextVoter.user.id);
  }
  assert.equal((await getIncidentById(verifiedIncident.id)).credibility, 'verified');

  const flaggedIncident = await createIncidentForUser(reporter.user.id, 'Kingston');
  for (let index = 0; index < 3; index += 1) {
    const nextVoter = await createCitizen(30 + index);
    await disputeIncident(flaggedIncident.id, nextVoter.user.id);
  }
  assert.equal((await getIncidentById(flaggedIncident.id)).credibility, 'flagged');
});

test('10.2 authority dashboard properties', async () => {
  const officer = await seedOfficer();
  const admin = await seedAdmin();
  const citizen = await seedCitizen();

  await createIncidentForUser(citizen.id, 'St. Andrew', {
    category: 'Crime',
    severity: 'high'
  });
  await createIncidentForUser(citizen.id, 'Kingston', {
    category: 'Infrastructure',
    severity: 'medium'
  });

  const dashboard = await getAuthorityDashboard(officer.id);
  assert.equal(dashboard.incidents.every((incident) => incident.parish === 'St. Andrew'), true);
  assert.ok(dashboard.stats.byCategory.Crime >= 1);
  assert.ok(dashboard.stats.bySeverity.high >= 1);
  assert.ok(dashboard.stats.citizenSignups >= 1);

  const adminDashboard = await getAuthorityDashboard(admin.id, 'Kingston');
  assert.equal(adminDashboard.parish, 'Kingston');
  assert.equal(adminDashboard.stats.citizenSignups, dashboard.stats.citizenSignups);

  const pendingAuthority = await createAuthority(70);
  const rawAuthority = await getUserByEmail(pendingAuthority.payload.email);
  const pendingDashboard = await getAuthorityDashboard(rawAuthority.id);
  assert.equal(pendingDashboard.readOnly, true);
});

test('10.4 authority action properties', async () => {
  const officer = await seedOfficer();
  const citizen = await seedCitizen();

  const verifyIncident = await createIncidentForUser(citizen.id, 'St. Andrew');
  const respondingIncident = await createIncidentForUser(citizen.id, 'St. Andrew');
  const resolvedIncident = await createIncidentForUser(citizen.id, 'St. Andrew');
  const dismissedIncident = await createIncidentForUser(citizen.id, 'St. Andrew');

  assert.equal(
    (await applyAuthorityAction(officer.id, verifyIncident.id, 'verify', 'Validated')).status,
    'authority_verified'
  );
  assert.equal(
    (await applyAuthorityAction(officer.id, respondingIncident.id, 'respond', 'Team moving')).status,
    'responding'
  );
  assert.equal(
    (await applyAuthorityAction(officer.id, resolvedIncident.id, 'resolve', 'All clear')).status,
    'resolved'
  );
  assert.equal(
    (await applyAuthorityAction(officer.id, dismissedIncident.id, 'dismiss', 'False report')).status,
    'dismissed'
  );

  const profile = await getProfile(citizen.id);
  assert.equal(profile.strikes.length, 1);
});

test('11.3 admin approval properties', async () => {
  const admin = await seedAdmin();
  const citizen = await seedCitizen();
  const one = await createAuthority(80);
  const two = await createAuthority(81);

  const pending = await listPendingAuthorities(admin.id);
  assert.equal(
    pending.some((entry) => entry.email === one.payload.email), true
  );
  assert.equal(
    pending.some((entry) => entry.email === two.payload.email), true
  );

  const rawAuthority = await getUserByEmail(one.payload.email);
  await approveAuthority(admin.id, rawAuthority.id);
  const approved = await verifyCredentials(one.payload.email, one.payload.password);
  assert.equal(approved.verified, true);
  assert.equal(approved.readOnly, false);

  await expectPlatformError(() => approveAuthority(citizen.id, rawAuthority.id), 4031);
});

test('13.2 notification eligibility properties', async () => {
  const reporter = await seedCitizen();
  const eligible = await createCitizen(90, { parish: 'Kingston' });
  const farAway = await createCitizen(91, { parish: 'St. James' });
  const disabled = await createCitizen(92, { parish: 'Kingston' });
  const quietWindow = buildQuietWindowOutsideNow();

  await updateNotificationPreferences(eligible.user.id, {
    enabled: true,
    categories: ['Crime'],
    minSeverity: 'high',
    radiusKm: 10,
    ...quietWindow
  });
  await updateNotificationPreferences(farAway.user.id, {
    enabled: true,
    categories: ['Crime'],
    minSeverity: 'high',
    radiusKm: 2,
    ...quietWindow
  });
  await updateNotificationPreferences(disabled.user.id, {
    enabled: false,
    categories: ['Crime'],
    minSeverity: 'high',
    radiusKm: 10,
    ...quietWindow
  });

  await createIncidentForUser(reporter.id, 'Kingston', {
    category: 'Crime',
    severity: 'high'
  });

  const eligibleProfile = await getProfile(eligible.user.id);
  const farProfile = await getProfile(farAway.user.id);
  const disabledProfile = await getProfile(disabled.user.id);

  assert.equal(eligibleProfile.notifications.length, 1);
  assert.match(eligibleProfile.notifications[0].body, /HIGH severity/i);
  assert.match(eligibleProfile.notifications[0].body, /km away/i);
  assert.equal(farProfile.notifications.length, 0);
  assert.equal(disabledProfile.notifications.length, 0);
});

test('13.6 notification preference properties', async () => {
  const reporter = await seedCitizen();
  const listener = await createCitizen(100, { parish: 'Kingston' });
  const quietWindow = buildQuietWindowOutsideNow();

  await updateNotificationPreferences(listener.user.id, {
    enabled: true,
    categories: ['Crime'],
    minSeverity: 'medium',
    radiusKm: 10,
    ...quietWindow
  });

  const preferences = await getNotificationPreferences(listener.user.id);
  assert.equal(preferences.enabled, true);
  assert.deepEqual(preferences.categories, ['Crime']);
  assert.equal(preferences.minSeverity, 'medium');

  await createIncidentForUser(reporter.id, 'Kingston', {
    category: 'Crime',
    severity: 'high'
  });
  assert.equal((await getProfile(listener.user.id)).notifications.length, 1);

  await updateNotificationPreferences(listener.user.id, {
    enabled: true,
    categories: ['Infrastructure'],
    minSeverity: 'high',
    radiusKm: 10,
    ...quietWindow
  });
  await createIncidentForUser(reporter.id, 'Kingston', {
    category: 'Crime',
    severity: 'high'
  });
  assert.equal((await getProfile(listener.user.id)).notifications.length, 1);
});

test('15.2 comment properties', async () => {
  const reporter = await seedCitizen();
  const incident = await createIncidentForUser(reporter.id, 'Kingston');
  const one = await createCitizen(110);
  const two = await createCitizen(111);

  const first = await createComment(incident.id, one.user.id, 'Initial witness update with helpful context.');
  const second = await createComment(incident.id, two.user.id, 'Follow-up information from another observer.');
  const comments = await listComments(incident.id, one.user.id);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].id, first.id);
  assert.equal(comments[1].id, second.id);
  assert.equal(comments[0].author.name, one.user.name);

  await expectPlatformError(
    () => createComment(incident.id, one.user.id, 'This is a fake bomb message.'),
    4015
  );
  await expectPlatformError(
    () => deleteComment(incident.id, first.id, two.user.id),
    4033
  );

  await deleteComment(incident.id, first.id, one.user.id);
  assert.equal((await listComments(incident.id, one.user.id)).length, 1);

  const restricted = await createRestrictedUser(112);
  await expectPlatformError(
    () => createComment(incident.id, restricted.id, 'Restricted users cannot post this.'),
    4032
  );
});

test('16.2 trend properties', async () => {
  const reporter = await seedCitizen();
  await patchDb((db) => {
    db.incidents = [];
    db.confirmations = [];
    db.comments = [];
    db.notifications = [];
    db.pendingPhotoScans = [];
  });
  const incidents = [
    await createIncidentForUser(reporter.id, 'Kingston', {
      category: 'Crime',
      severity: 'high'
    }),
    await createIncidentForUser(reporter.id, 'Kingston', {
      category: 'Crime',
      severity: 'medium'
    }),
    await createIncidentForUser(reporter.id, 'St. Andrew', {
      category: 'Infrastructure',
      severity: 'medium'
    }),
    await createIncidentForUser(reporter.id, 'Kingston', {
      category: 'Accident',
      subcategory: CATEGORY_SUBCATEGORIES.Accident[0],
      severity: 'low'
    })
  ];

  await patchDb((db) => {
    incidents.forEach((incident, index) => {
      const entry = db.incidents.find((candidate) => candidate.id === incident.id);
      entry.createdAt = new Date(Date.UTC(2026, 2, index + 1)).toISOString();
      entry.updatedAt = entry.createdAt;
    });
  });

  const counts = await getTrendCounts('30d', '', '2026-03-01', '2026-03-31');
  const top = await getTopCategories('30d', '', '2026-03-01', '2026-03-31');
  const heatmap = await getTrendHeatmap('30d', '', '2026-03-01', '2026-03-31');

  assert.equal(counts.total, 4);
  assert.equal(counts.counts.Crime, 2);
  assert.equal(top[0].category, 'Crime');
  assert.equal(top[0].count, 2);
  assert.equal(heatmap.some((entry) => entry.parish === 'Kingston'), true);
  assert.equal(heatmap.some((entry) => entry.parish === 'St. Andrew'), true);
});

test('18.2 profile properties', async () => {
  const user = await createCitizen(120, { parish: 'Kingston' });
  const reporter = await seedCitizen();
  const officer = await seedOfficer();
  const quietWindow = buildQuietWindowOutsideNow();

  await updateProfile(user.user.id, {
    name: 'Updated Profile User',
    parish: 'St. Andrew',
    lastKnownLocation: PARISH_CENTERS['St. Andrew']
  });
  await updateNotificationPreferences(user.user.id, {
    ...DEFAULT_NOTIFICATION_PREFS,
    enabled: true,
    categories: ['Crime'],
    minSeverity: 'low',
    radiusKm: 10,
    ...quietWindow
  });

  const ownIncident = await createIncidentForUser(user.user.id, 'St. Andrew');
  const publicIncident = await createIncidentForUser(reporter.id, 'St. Andrew', {
    severity: 'high'
  });
  await confirmIncident(publicIncident.id, user.user.id);
  await applyAuthorityAction(officer.id, ownIncident.id, 'dismiss', 'False report');
  await createIncidentForUser(reporter.id, 'St. Andrew', {
    category: 'Crime',
    severity: 'high'
  });

  const profile = await getProfile(user.user.id);
  const incidents = await listProfileIncidents(user.user.id);
  const activity = await listProfileActivity(user.user.id);

  assert.equal(profile.user.name, 'Updated Profile User');
  assert.equal(profile.user.parish, 'St. Andrew');
  assert.equal(profile.user.lastKnownLocation.lat, PARISH_CENTERS['St. Andrew'].lat);
  assert.equal(incidents.length, 1);
  assert.equal(activity.items.length, 1);
  assert.equal(profile.strikes.length, 1);
  assert.equal(profile.notifications.length >= 1, true);
});

test('20.2 strike system properties', async () => {
  const restricted = await createRestrictedUser(130);
  assert.equal(restricted.strikeCount, 3);
  assert.equal(Boolean(restricted.restrictedUntil), true);
  await expectPlatformError(
    () =>
      createIncident(
        incidentPayloadFor('Kingston', {
          description: 'Restricted users should not be able to post incidents now.'
        }),
        restricted.id
      ),
    4032
  );

  const banned = await createCitizen(131);
  await addRawStrikes(banned.user.id, 5);
  const bannedUser = await getSessionUserByEmail(banned.payload.email);
  assert.equal(bannedUser.permanentPostingBan, true);

  const decayed = await createCitizen(132);
  const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
  await addRawStrikes(decayed.user.id, 3, oldDate);
  const afterDecay = await getUserById(decayed.user.id);
  assert.equal(afterDecay.strikeCount, 2);
  assert.equal(afterDecay.restrictedUntil, null);
});

test('20.4 appeal properties', async () => {
  const user = await createCitizen(140);
  const officer = await seedOfficer();
  const admin = await seedAdmin();
  const incident = await createIncidentForUser(user.user.id, 'Kingston');

  await applyAuthorityAction(officer.id, incident.id, 'dismiss', 'False report');
  const profile = await getProfile(user.user.id);
  const strikeId = profile.strikes[0].id;

  await submitAppeal(user.user.id, {
    strikeId,
    message: 'This dismissal should be reviewed.'
  });
  await expectPlatformError(
    () =>
      submitAppeal(user.user.id, {
        strikeId,
        message: 'Second appeal should fail.'
      }),
    4092
  );

  const appeals = await listAppeals(user.user.id);
  assert.equal(appeals.length, 1);
  assert.equal(appeals[0].status, 'submitted');

  await reviewAppeal(admin.id, appeals[0].id, 'approved');
  assert.equal((await listAppeals(user.user.id))[0].status, 'approved');
  assert.equal((await getProfile(user.user.id)).strikes.length, 0);
});

test('23.2 API response properties', async () => {
  for (let index = 0; index < 3; index += 1) {
    const response = await registerRoute.POST(
      new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'citizen',
          email: randomEmail(`route-${index}`),
          password: 'short',
          name: 'Route User',
          parish: 'Kingston'
        })
      })
    );
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(typeof body.error, 'string');
    assert.equal(body.code, 4004);
  }

  const invalidReset = await resetRoute.PUT(
    new Request('http://localhost/api/auth/reset-password', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'invalid-token',
        password: 'Reset1234!'
      })
    })
  );
  const invalidResetBody = await invalidReset.json();
  assert.equal(invalidReset.status, 400);
  assert.equal(typeof invalidResetBody.error, 'string');
  assert.equal(invalidResetBody.code, 4007);

  const unexpected = fail(new Error('boom'));
  assert.equal(unexpected.status, 500);
  assert.deepEqual(await unexpected.json(), {
    error: 'Unexpected server error.',
    code: 500
  });
});

test('additional optional property coverage for devices and comment listing', async () => {
  const user = await createCitizen(150);
  await registerDevice(user.user.id, 'token-1', 'web');
  await registerDevice(user.user.id, 'token-1', 'web');
  const db = await readDb();
  assert.equal(
    db.deviceTokens.filter((entry) => entry.userId === user.user.id).length,
    1
  );

  const incident = await createIncidentForUser(user.user.id, 'Kingston');
  assert.deepEqual(await listComments(incident.id, user.user.id), []);
});
