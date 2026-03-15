# Tech Stack

## Framework & Runtime
- Next.js 16 (App Router)
- React 19
- Node.js with ES modules (`"type": "module"`)

## Styling
- Tailwind CSS 4
- Custom CSS variables in `app/globals.css`
- Dark theme with warm alert accents

## Authentication
- Auth.js (NextAuth v5 beta) with credentials provider
- JWT session strategy
- Password hashing with bcryptjs

## Database & Persistence
- Supabase PostgreSQL (primary)
- Local JSON fallback (`data/local-db.json`) for development without Supabase
- Supabase Realtime for live updates

## Icons
- lucide-react (no emoji iconography)

## Deployment
- Vercel
- Environment variables: `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## Common Commands

```bash
# Development
npm run dev

# Production build
npm run build

# Start production server
npm start

# Lint
npm run lint
```

## Path Aliases
- `@/*` maps to project root (configured in `jsconfig.json`)

## API Response Pattern
All API routes use helpers from `lib/api-response.js`:
- `ok(data)` - Success response
- `fail(error)` - Error response with consistent format `{error: string, code: number}`
