CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  parish VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'citizen',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  organization_name VARCHAR(255),
  badge_number VARCHAR(255),
  official_email VARCHAR(255),
  strike_count INTEGER NOT NULL DEFAULT 0,
  posting_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  restricted_until TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  reporter_id UUID NOT NULL,
  category VARCHAR(64) NOT NULL,
  subcategory VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  parish VARCHAR(128) NOT NULL,
  severity VARCHAR(32) NOT NULL DEFAULT 'medium',
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  credibility VARCHAR(32) NOT NULL DEFAULT 'pending',
  confirmation_count INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS incidents_location_gix ON incidents USING GIST (location);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_category_idx ON incidents (category);
CREATE INDEX IF NOT EXISTS incidents_created_at_idx ON incidents (created_at DESC);

CREATE TABLE IF NOT EXISTS incident_photos (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL,
  url TEXT NOT NULL,
  cloudinary_id VARCHAR(255),
  scan_status VARCHAR(32) NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS confirmations (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL,
  user_id UUID NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (incident_id, user_id)
);

CREATE TABLE IF NOT EXISTS authority_actions (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL,
  authority_id UUID NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS strikes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  platform VARCHAR(32) NOT NULL DEFAULT 'web',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  min_severity VARCHAR(32) NOT NULL DEFAULT 'high',
  radius_km INTEGER NOT NULL DEFAULT 5,
  quiet_hours_start VARCHAR(5),
  quiet_hours_end VARCHAR(5),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
