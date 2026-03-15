# Project Structure

```
├── app/                    # Next.js App Router
│   ├── api/               # Route handlers (REST API)
│   │   ├── auth/          # Authentication endpoints
│   │   ├── incidents/     # Incident CRUD and actions
│   │   ├── authority/     # Authority dashboard endpoints
│   │   ├── profile/       # User profile endpoints
│   │   ├── trends/        # Analytics endpoints
│   │   ├── notifications/ # Push notification endpoints
│   │   └── moderation/    # Content moderation endpoints
│   ├── auth/              # Auth page
│   ├── authority/         # Authority dashboard page
│   ├── profile/           # User profile page
│   ├── report/            # Incident reporting wizard
│   ├── trends/            # Trends/analytics page
│   ├── globals.css        # Global styles and CSS variables
│   ├── layout.jsx         # Root layout with providers
│   └── page.jsx           # Home page (incident feed)
│
├── components/            # React components
│   ├── platform-shell.jsx # Main app shell with all UI logic
│   └── providers.jsx      # Context providers (session, etc.)
│
├── lib/                   # Shared utilities and business logic
│   ├── api-response.js    # API response helpers (ok/fail)
│   ├── constants.js       # App constants (parishes, categories, severity levels)
│   ├── platform-store.js  # Core business logic and data operations
│   ├── session-user.js    # Session user helpers
│   ├── supabase-persistence.js # Supabase data adapter
│   ├── utils.js           # General utilities
│   └── supabase/          # Supabase client setup
│       ├── client.js      # Browser client
│       └── server.js      # Server client
│
├── public/                # Static assets
│   └── sw.js              # Service worker for offline support
│
├── supabase/              # Supabase configuration
│   └── migrations/        # Database migrations
│
├── data/                  # Local data storage (dev fallback)
│
├── auth.js                # Auth.js configuration
└── proxy.js               # Route protection middleware
```

## Key Patterns

### API Routes
- Located in `app/api/` following Next.js conventions
- Use `lib/api-response.js` for consistent responses
- Business logic delegated to `lib/platform-store.js`

### Components
- `platform-shell.jsx` is the main monolithic component containing most UI
- Pages are thin wrappers that render `PlatformShell` with a page prop

### Data Layer
- `lib/platform-store.js` contains all domain logic
- Automatically uses Supabase when configured, falls back to local JSON
- `lib/supabase-persistence.js` handles Supabase read/write operations
