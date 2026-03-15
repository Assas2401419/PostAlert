# Implementation Plan: Postalert

## Overview

This implementation plan now reflects the delivered stack:

- **Frontend + Backend**: Next.js 16 App Router with Route Handlers
- **Authentication**: Auth.js with credentials-based sign-in
- **Database**: Supabase PostgreSQL with an application-level persistence adapter
- **Realtime**: Supabase Realtime subscriptions with browser refresh fallback
- **UI**: Tailwind CSS, custom global styling, and `lucide-react` icons only
- **Deployment**: Vercel-ready configuration

## Tasks

- [x] 1. Platform Foundation
  - [x] 1.1 Consolidate the project into a single Next.js App Router application
  - [x] 1.2 Configure Tailwind CSS, global styling, and shared application layout
  - [x] 1.3 Configure Auth.js and protected route proxying
  - [x] 1.4 Add environment templates for Auth.js and Supabase
  - [x] 1.5 Add Vercel deployment configuration

- [x] 2. Supabase Data Layer
  - [x] 2.1 Create Supabase schema migration for users, incidents, confirmations, strikes, device tokens, and moderation appeals
  - [x] 2.2 Extend the schema for notifications, pending photo scans, and geographic coordinates
  - [x] 2.3 Implement a Supabase persistence adapter behind the Postalert business logic
  - [x] 2.4 Preserve a local JSON fallback for development without Supabase credentials

- [x] 3. Authentication and Access Control
  - [x] 3.1 Implement citizen registration with validation and password hashing
  - [x] 3.2 Implement authority registration with pending-verification workflow
  - [x] 3.3 Implement Auth.js credentials sign-in and JWT session strategy
  - [x] 3.4 Enforce role-aware access for report and profile routes
  - [x] 3.5 Support authority approval by administrators

- [x] 4. UI System and Navigation
  - [x] 4.1 Build a clean responsive shell for feed, auth, reporting, authority, profile, and trends screens
  - [x] 4.2 Use `lucide-react` for all iconography and avoid emoji-based UI icons
  - [x] 4.3 Create route-level pages for `/`, `/auth`, `/report`, `/authority`, `/profile`, and `/trends`
  - [x] 4.4 Add a branded loading fallback for App Router suspense boundaries

- [x] 5. Incident Reporting Workflow
  - [x] 5.1 Implement the multi-step reporting flow for category, location, media/severity, and review
  - [x] 5.2 Validate description length, Jamaica bounds, and severity defaults
  - [x] 5.3 Validate photo count, format, and size limits
  - [x] 5.4 Block prohibited content and flag sensitive content
  - [x] 5.5 Queue photo-scan review metadata for submitted attachments
  - [x] 5.6 Create incident records and redirect to the incident detail state on success

- [x] 6. Feed, Detail View, and Realtime Awareness
  - [x] 6.1 Implement map/list feed toggle with filtering, recency sorting, and pagination
  - [x] 6.2 Implement incident detail viewing with confirmations, disputes, reporter masking, and authority actions
  - [x] 6.3 Implement confirmation and dispute actions with duplicate prevention
  - [x] 6.4 Implement credibility escalation for verified and flagged incidents
  - [x] 6.5 Add Supabase Realtime incident subscriptions for cross-client refreshes when Supabase is configured
  - [x] 6.6 Keep BroadcastChannel refresh support for local development and offline-friendly flows

- [x] 7. Authority and Moderation Workflows
  - [x] 7.1 Implement authority dashboard statistics and jurisdiction-scoped incident lists
  - [x] 7.2 Implement authority actions for verify, respond, resolve, and dismiss
  - [x] 7.3 Implement strike issuance and posting restrictions for false reports
  - [x] 7.4 Implement strike appeal submission
  - [x] 7.5 Implement strike decay processing in the application service layer

- [x] 8. Notifications, Profile, and Trends
  - [x] 8.1 Implement device registration and notification preference APIs
  - [x] 8.2 Surface nearby-incident notification records in the user profile data
  - [x] 8.3 Implement profile retrieval, editing, incident history, and activity history
  - [x] 8.4 Implement trends endpoints for counts, heatmap points, and top categories
  - [x] 8.5 Implement authority alert presentation for recent high-severity incidents

- [x] 9. Offline Resilience
  - [x] 9.1 Cache the last successful incident feed in local storage
  - [x] 9.2 Queue incident reports while offline and auto-submit them when connectivity returns
  - [x] 9.3 Register a service worker for offline-aware behavior
  - [x] 9.4 Show offline and recovery feedback in the interface

- [x] 10. Deployment and Verification
  - [x] 10.1 Add a health endpoint for runtime checks
  - [x] 10.2 Verify the project with `npm run lint`
  - [x] 10.3 Verify the project with `npm run build`
  - [x] 10.4 Prepare the application for Vercel deployment with Auth.js and Supabase environment variables

## Notes

- This checklist supersedes the earlier React + Express + Socket.io implementation plan.
- Supabase persistence is live when the required environment variables are present; the project falls back to the local JSON store for no-credential development.
- Realtime updates use Supabase Realtime for hosted deployments and BroadcastChannel refreshes as a local fallback.
