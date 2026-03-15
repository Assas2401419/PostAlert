CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS postalert_users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  parish TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  organization_name TEXT,
  badge_number TEXT,
  reputation_score INTEGER NOT NULL DEFAULT 50,
  restricted_until TIMESTAMPTZ,
  permanent_posting_ban BOOLEAN NOT NULL DEFAULT FALSE,
  notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_known_lat DOUBLE PRECISION,
  last_known_lng DOUBLE PRECISION,
  last_known_location GEOGRAPHY(POINT, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS postalert_users_email_idx ON postalert_users (email);
CREATE INDEX IF NOT EXISTS postalert_users_role_idx ON postalert_users (role);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  reporter_id UUID NOT NULL REFERENCES postalert_users(id),
  category TEXT NOT NULL,
  subcategory TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  credibility TEXT NOT NULL DEFAULT 'pending',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  parish TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location GEOGRAPHY(POINT, 4326),
  address TEXT,
  moderation JSONB NOT NULL DEFAULT '{}'::jsonb,
  authority_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS incidents_location_gix ON incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_category_idx ON incidents (category);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS confirmations (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  action_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (incident_id, user_id)
);

CREATE TABLE IF NOT EXISTS strikes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  reason TEXT NOT NULL,
  issued_by UUID,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decayed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE TABLE IF NOT EXISTS moderation_appeals (
  id UUID PRIMARY KEY,
  strike_id UUID NOT NULL REFERENCES strikes(id),
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewed_at TIMESTAMPTZ,
  UNIQUE (strike_id, user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  message TEXT NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_incident_created_idx ON comments (incident_id, created_at ASC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON password_reset_tokens (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS pending_photo_scans (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents(id),
  photo_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES postalert_users(id),
  incident_id UUID REFERENCES incidents(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  distance_km DOUBLE PRECISION,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
