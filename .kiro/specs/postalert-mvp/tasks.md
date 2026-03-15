# Implementation Plan: PostAlert MVP

## Overview

This implementation plan covers the complete PostAlert MVP platform including authentication, incident reporting, real-time mapping, authority management, notifications, comments, analytics, and content moderation. Tasks build incrementally, with each step integrating into the existing Next.js 16 App Router architecture.

## Tasks

- [x] 1. Authentication System
  - [x] 1.1 Implement citizen registration in platform-store.js
    - Add `registerCitizen()` function with email/password/name/parish validation
    - Hash passwords with bcryptjs, assign default reputation score 50
    - Return session user object on success
    - _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_

  - [x] 1.2 Implement authority registration in platform-store.js
    - Add `registerAuthority()` function with organization/badge validation
    - Validate email ends in .gov.jm or .org.jm (error 4006)
    - Create account with verified=false, reputation score 65
    - _Requirements: 1.4, 1.5, 1.8_

  - [x]* 1.3 Write property tests for registration
    - **Property 1: Registration creates valid accounts with correct defaults**
    - **Property 2: Password validation rejects short passwords**
    - **Property 3: Duplicate email registration is rejected**
    - **Property 4: Authority email domain validation**
    - **Property 5: Password hashing round-trip**
    - **Validates: Requirements 1.1-1.8**

  - [x] 1.4 Implement verifyCredentials in platform-store.js
    - Validate email exists and password matches hash
    - Return session user on success, null on failure (no field-specific errors)
    - _Requirements: 2.1, 2.2_

  - [x]* 1.5 Write property tests for authentication
    - **Property 6: Authentication with valid credentials succeeds**
    - **Property 7: Authentication with invalid credentials fails generically**
    - **Validates: Requirements 2.1, 2.2**

  - [x] 1.6 Update auth.js NextAuth configuration
    - Configure credentials provider to use verifyCredentials
    - Set up JWT session strategy
    - Configure session callbacks for user data
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 1.7 Implement password reset flow
    - Add `generateResetToken()` and `resetPassword()` to platform-store.js
    - Tokens expire after 1 hour, invalidate on use
    - Invalidate existing tokens when new one generated
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x]* 1.8 Write property tests for password reset
    - **Property 8: Password reset token round-trip**
    - **Property 9: Expired reset tokens are rejected**
    - **Validates: Requirements 3.2-3.5**

  - [x] 1.9 Update /app/api/auth/register/route.js
    - Handle both citizen and authority registration
    - Return appropriate error codes (4004, 4006, 4090)
    - _Requirements: 1.1-1.8_

  - [x] 1.10 Create /app/api/auth/reset-password/route.js
    - POST to request reset token, PUT to reset password
    - _Requirements: 3.1-3.5_

- [x] 2. Checkpoint - Authentication complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Incident Reporting Core
  - [x] 3.1 Implement content moderation in platform-store.js
    - Add `scanContent()` function with prohibited/sensitive keyword detection
    - Block prohibited keywords (fake bomb, target civilians, hate speech) with error 4015
    - Flag sensitive keywords (gun, knife, blood, child, shooting, domestic abuse)
    - _Requirements: 18.1, 18.2_

  - [x]* 3.2 Write property tests for content moderation
    - **Property 43: Prohibited keywords block submission**
    - **Property 44: Sensitive keywords flag but allow submission**
    - **Validates: Requirements 18.1, 18.2**

  - [x] 3.3 Implement location validation in platform-store.js
    - Add `withinJamaica()` function for boundary validation
    - Add `assignParish()` using haversine distance to parish centers
    - Reject coordinates outside Jamaica with error 4014
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x]* 3.4 Write property tests for location validation
    - **Property 15: Jamaica boundary validation**
    - **Property 16: Parish assignment uses nearest center**
    - **Validates: Requirements 5.1-5.4**

  - [x] 3.5 Implement createIncident in platform-store.js
    - Validate category/subcategory mapping, description length (10-500 chars)
    - Validate severity levels, handle anonymous flag
    - Apply content moderation, assign parish from coordinates
    - Generate title as "{subcategory} in {parish}"
    - _Requirements: 4.1-4.9, 5.1-5.4_

  - [x]* 3.6 Write property tests for incident creation
    - **Property 10: Category-subcategory mapping is consistent**
    - **Property 12: Description length validation**
    - **Property 13: Severity levels are all accepted**
    - **Property 14: Anonymous submission hides reporter identity**
    - **Validates: Requirements 4.2, 4.6, 4.7, 4.8**

  - [x] 3.7 Implement photo validation in platform-store.js
    - Validate JPEG/PNG only, max 5MB per photo, max 3 photos
    - Store photo metadata with unique ID and scanStatus='queued'
    - Return error 4016 for invalid photos
    - _Requirements: 4.5, 24.1, 24.2, 24.3, 24.4, 24.5_

  - [x]* 3.8 Write property tests for photo validation
    - **Property 11: Photo validation enforces type and size constraints**
    - **Property 52: Photo metadata is stored completely**
    - **Validates: Requirements 4.5, 24.1-24.5**

  - [x] 3.9 Update /app/api/incidents/route.js
    - POST handler for incident creation with all validations
    - GET handler for listing with filters
    - _Requirements: 4.1-4.9, 7.1-7.5_

  - [x] 3.10 Update /app/report/page.jsx wizard UI
    - Step 1: Category selection with subcategory display
    - Step 2: GPS location capture with map confirmation, manual fallback
    - Step 3: Description, photos (up to 3), severity, anonymous toggle
    - Step 4: Review and submit
    - _Requirements: 4.1-4.9_

- [x] 4. Checkpoint - Incident reporting complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Incident Feed and Filtering
  - [x] 5.1 Implement listIncidents in platform-store.js
    - Support filters: categories, severities, parish, date range, status
    - Sort by createdAt descending (newest first)
    - Paginate with 8 items per page, return metadata (page, limit, total, hasMore)
    - _Requirements: 6.5, 7.1, 7.2, 7.3_

  - [x]* 5.2 Write property tests for incident listing
    - **Property 17: Incident filtering returns only matching results**
    - **Property 18: Incidents are sorted newest first**
    - **Property 19: Pagination respects page size**
    - **Validates: Requirements 6.5, 7.1, 7.2, 7.3**

  - [x] 5.3 Implement incident serialization in platform-store.js
    - Include all required fields: id, category, subcategory, title, description, severity, status, credibility, confirmationCount, disputeCount, parish, latitude, longitude, photos, authorityActions, reporter info, timestamps
    - Handle anonymous reporter display as "Anonymous Reporter"
    - _Requirements: 7.4, 7.5, 8.1, 8.2, 8.3, 8.4_

  - [x]* 5.4 Write property tests for incident serialization
    - **Property 20: Incident serialization includes all required fields**
    - **Property 50: Incident serialization round-trip**
    - **Validates: Requirements 7.4, 7.5, 8.1-8.4, 22.5**

  - [x] 5.5 Update /app/page.jsx incident feed UI
    - Display incident cards with category icon, severity badge, title, parish, relative time
    - Show credibility status (pending, verified, flagged)
    - Implement filter panel for category, severity, parish
    - Add pagination controls
    - _Requirements: 7.1-7.5_

- [x] 6. Real-Time Map Display
  - [x] 6.1 Implement map component in platform-shell.jsx
    - Center on Jamaica (18.1096, -77.2975) with zoom level 9
    - Display incident markers color-coded by severity (emerald/amber/orange/rose)
    - Show incident summary popup on marker click
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [x] 6.2 Implement Supabase Realtime subscription
    - Subscribe to incidents table changes
    - Push new incidents to connected clients
    - Update markers when status/counts change
    - Animate new markers appearing
    - _Requirements: 6.4, 21.1, 21.2, 21.3, 21.4, 21.5_

  - [x] 6.3 Add map filter controls
    - Filter by category, severity, parish
    - Sync filters with feed view
    - _Requirements: 6.5_

- [x] 7. Checkpoint - Feed and map complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Incident Detail and Confirmation System
  - [x] 8.1 Implement getIncidentById in platform-store.js
    - Return full incident details including photos, authority actions
    - Handle reporter info display (anonymous vs named)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 8.2 Update /app/api/incidents/[id]/route.js
    - GET handler for single incident details
    - _Requirements: 8.1-8.5_

  - [x] 8.3 Implement confirmIncident and disputeIncident in platform-store.js
    - Increment correct counter (confirmationCount or disputeCount)
    - Prevent self-voting (error 4017)
    - Prevent duplicate voting (error 4091)
    - Update credibility: 5 confirmations → "verified", disputes exceed confirms by 3 → "flagged"
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x]* 8.4 Write property tests for voting system
    - **Property 21: Voting increments correct counter**
    - **Property 22: Self-voting is prevented**
    - **Property 23: Duplicate voting is prevented**
    - **Property 24: Credibility status transitions correctly**
    - **Validates: Requirements 9.1-9.6**

  - [x] 8.5 Update /app/api/incidents/[id]/confirm/route.js and dispute/route.js
    - POST handlers for confirmation and dispute actions
    - _Requirements: 9.1-9.6_

  - [x] 8.6 Create incident detail view in platform-shell.jsx
    - Display full description, photo gallery with zoom
    - Show confirmation/dispute counts with vote buttons
    - Display authority actions timeline
    - Show status badge
    - _Requirements: 8.1-8.5, 9.1-9.6_

- [x] 9. Checkpoint - Incident detail complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Authority Dashboard and Actions
  - [x] 10.1 Implement getAuthorityDashboard in platform-store.js
    - Filter incidents by authority's assigned parish
    - Calculate stats: totalActive, byCategory, bySeverity
    - Support admin parish override
    - _Requirements: 10.1, 10.2, 10.5_

  - [x]* 10.2 Write property tests for authority dashboard
    - **Property 25: Authority dashboard filters by parish**
    - **Property 26: Dashboard statistics are accurate**
    - **Property 27: Unverified authorities have read-only access**
    - **Validates: Requirements 10.1, 10.2, 10.4, 10.5**

  - [x] 10.3 Implement applyAuthorityAction in platform-store.js
    - Handle verify → "authority_verified", respond → "responding", resolve → "resolved", dismiss → "dismissed"
    - Record action with authority name, type, notes (max 300 chars), timestamp
    - Issue strike to reporter on dismiss
    - Reject unverified authority actions (error 4030)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x]* 10.4 Write property tests for authority actions
    - **Property 28: Authority actions update status correctly**
    - **Property 29: Dismiss action issues strike to reporter**
    - **Validates: Requirements 11.1-11.6**

  - [x] 10.5 Update /app/api/authority/dashboard/route.js
    - GET handler returning dashboard data
    - _Requirements: 10.1-10.5_

  - [x] 10.6 Update /app/api/authority/incidents/[id]/[action]/route.js
    - POST handler for authority actions
    - _Requirements: 11.1-11.6_

  - [x] 10.7 Update /app/authority/page.jsx dashboard UI
    - Display stats cards (total, by category, by severity)
    - List incidents with action buttons (verify, respond, resolve, dismiss)
    - Show notes input for actions
    - Display pending approval message for unverified authorities
    - Add parish selector for admins
    - _Requirements: 10.1-10.5, 11.1-11.6_

- [x] 11. Admin Authority Approval
  - [x] 11.1 Implement listPendingAuthorities in platform-store.js
    - Return all authority accounts with verified=false
    - Include organization name and badge number
    - _Requirements: 12.1, 12.4_

  - [x] 11.2 Implement approveAuthority in platform-store.js
    - Set verified=true for authority
    - Reject non-admin requests (error 4031)
    - _Requirements: 12.2, 12.3_

  - [x]* 11.3 Write property tests for admin approval
    - **Property 30: Pending authorities list is accurate**
    - **Property 31: Authority approval grants full permissions**
    - **Property 32: Non-admin cannot approve authorities**
    - **Validates: Requirements 12.1-12.4**

  - [x] 11.4 Update /app/api/admin/authorities/pending/route.js
    - GET handler for pending authorities list
    - _Requirements: 12.1, 12.4_

  - [x] 11.5 Update /app/api/admin/authorities/[id]/approve/route.js
    - POST handler for authority approval
    - _Requirements: 12.2, 12.3_

  - [x] 11.6 Add admin panel to authority dashboard
    - Display pending authorities with org/badge info
    - Add approve button for each pending authority
    - _Requirements: 12.1-12.4_

- [x] 12. Checkpoint - Authority system complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Push Notifications
  - [x] 13.1 Implement notification evaluation in platform-store.js
    - Check user preferences: enabled, categories, minSeverity, radius, quiet hours
    - Calculate distance using haversine formula
    - Create notification records for eligible users
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x]* 13.2 Write property tests for notification eligibility
    - **Property 33: Notifications respect user preferences**
    - **Property 34: Notification content is complete**
    - **Validates: Requirements 13.1-13.5**

  - [x] 13.3 Implement registerDevice in platform-store.js
    - Store device token with user ID and platform
    - _Requirements: 13.6_

  - [x] 13.4 Update /app/api/notifications/register/route.js
    - POST handler for device token registration
    - _Requirements: 13.6_

  - [x] 13.5 Implement notification preferences in platform-store.js
    - Get and update preferences: enabled, categories, minSeverity, radiusKm, quietHoursStart, quietHoursEnd
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x]* 13.6 Write property tests for notification preferences
    - **Property 35: Notification preferences persist and apply**
    - **Validates: Requirements 14.1-14.6**

  - [x] 13.7 Update /app/api/notifications/preferences/route.js
    - GET and PUT handlers for preferences
    - _Requirements: 14.1-14.6_

  - [x] 13.8 Update /public/sw.js service worker
    - Handle push notification events
    - Display notification with incident info
    - _Requirements: 13.5, 20.1_

- [x] 14. Checkpoint - Notifications complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Comments System
  - [x] 15.1 Implement comments functions in platform-store.js
    - Add `createComment()` with content moderation
    - Add `listComments()` returning chronological order
    - Add `deleteComment()` for own comments only
    - Check posting restrictions before allowing comments
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [x]* 15.2 Write property tests for comments
    - **Property 36: Comments are stored with metadata and ordered chronologically**
    - **Property 37: Comment moderation blocks prohibited content**
    - **Property 38: Users can only delete their own comments**
    - **Property 39: Posting restrictions apply to comments**
    - **Validates: Requirements 15.1-15.6**

  - [x] 15.3 Create /app/api/incidents/[id]/comments/route.js
    - GET handler for listing comments
    - POST handler for creating comments
    - DELETE handler for deleting comments
    - _Requirements: 15.1-15.6_

  - [x] 15.4 Add comments section to incident detail view
    - Display comments in chronological order
    - Add comment input form
    - Show delete button for own comments
    - _Requirements: 15.1-15.6_

- [x] 16. Trends and Analytics Dashboard
  - [x] 16.1 Implement trends functions in platform-store.js
    - Add `getTrendsCounts()` for 24h, 7d, 30d periods
    - Add `getTopCategories()` with counts
    - Add `getHeatmapData()` with parish density
    - Support date range filtering
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [x]* 16.2 Write property tests for trends
    - **Property 40: Trends aggregation is accurate**
    - **Validates: Requirements 16.1-16.4**

  - [x] 16.3 Update /app/api/trends/counts/route.js
    - GET handler for period counts
    - _Requirements: 16.1_

  - [x] 16.4 Update /app/api/trends/top-categories/route.js
    - GET handler for category breakdown
    - _Requirements: 16.2_

  - [x] 16.5 Update /app/api/trends/heatmap/route.js
    - GET handler for parish density data
    - _Requirements: 16.3_

  - [x] 16.6 Update /app/trends/page.jsx dashboard UI
    - Display period count cards (24h, 7d, 30d)
    - Show top categories chart
    - Display parish heatmap
    - Add date range filter
    - _Requirements: 16.1-16.5_

- [x] 17. Checkpoint - Comments and trends complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. User Profile Page
  - [x] 18.1 Implement profile functions in platform-store.js
    - Add `getProfile()` returning user data, strikes, notifications
    - Add `updateProfile()` for name, parish, location updates
    - Add `listProfileIncidents()` for user's reported incidents
    - Add `listProfileActivity()` for confirmation/dispute history
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x]* 18.2 Write property tests for profile
    - **Property 41: Profile data is complete**
    - **Property 42: Profile updates persist correctly**
    - **Validates: Requirements 17.1-17.7**

  - [x] 18.3 Update /app/api/profile/route.js
    - GET handler for profile data
    - PUT handler for profile updates
    - _Requirements: 17.1, 17.2, 17.7_

  - [x] 18.4 Update /app/api/profile/incidents/route.js
    - GET handler for user's incidents
    - _Requirements: 17.3_

  - [x] 18.5 Update /app/api/profile/activity/route.js
    - GET handler for activity history
    - _Requirements: 17.4_

  - [x] 18.6 Update /app/profile/page.jsx UI
    - Display user info: name, email, parish, role, reputation
    - Show editable name and parish fields
    - List user's reported incidents
    - Show confirmation/dispute activity
    - Display active strikes with reasons
    - Show notification preferences with edit capability
    - _Requirements: 17.1-17.7_

- [x] 19. Checkpoint - Profile complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Strike-Based Content Moderation
  - [x] 20.1 Implement strike management in platform-store.js
    - Add `issueStrike()` function
    - Implement 3 strikes → 7-day restriction, 5 strikes → permanent ban
    - Implement 90-day decay for oldest strike
    - Check posting restrictions before incident/comment submission (error 4032)
    - _Requirements: 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x]* 20.2 Write property tests for strike system
    - **Property 45: Strike thresholds trigger correct restrictions**
    - **Property 46: Strike decay after 90 days**
    - **Property 47: Posting restrictions are enforced**
    - **Validates: Requirements 18.3-18.7**

  - [x] 20.3 Implement appeals in platform-store.js
    - Add `submitAppeal()` with one appeal per strike limit
    - Add `listAppeals()` for user's appeals
    - Handle appeal approval removing strike
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

  - [x]* 20.4 Write property tests for appeals
    - **Property 48: Appeal creation and limits**
    - **Property 49: Appeal approval removes strike**
    - **Validates: Requirements 19.1-19.4**

  - [x] 20.5 Update /app/api/moderation/appeals/route.js
    - GET handler for listing appeals
    - POST handler for submitting appeals
    - _Requirements: 19.1-19.4_

  - [x] 20.6 Add appeals UI to profile page
    - Display appeal status for each strike
    - Add appeal submission form
    - _Requirements: 19.1-19.5_

- [x] 21. Checkpoint - Moderation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Offline Support
  - [x] 22.1 Update /public/sw.js service worker
    - Register service worker for offline capability
    - Cache essential assets (HTML, CSS, JS)
    - Implement offline incident queue
    - Auto-submit queued incidents when online
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 22.2 Add offline indicators to UI
    - Show stale data indicator when offline
    - Display queued submission count
    - _Requirements: 20.5_

- [x] 23. API Response Consistency
  - [x] 23.1 Audit all API routes for consistent responses
    - Ensure all success responses use ok(data)
    - Ensure all errors use fail(error) with {error, code}
    - Verify HTTP status codes match error code ranges
    - _Requirements: 23.1, 23.2, 23.3_

  - [x]* 23.2 Write property tests for API responses
    - **Property 51: API error responses have consistent format**
    - **Validates: Requirements 23.2, 23.3**

- [x] 24. Accessibility Compliance
  - [x] 24.1 Audit and update all components for accessibility
    - Use semantic HTML elements
    - Add alt text to all images and icons
    - Ensure keyboard navigation works
    - Verify color contrast ratios
    - Add aria-labels to lucide-react icons
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

- [x] 25. Database Schema Update
  - [x] 25.1 Update supabase/migrations for new tables
    - Add comments table
    - Add password_reset_tokens table
    - Add indexes for performance
    - _Requirements: 22.3, 22.4_

- [x] 26. Final Checkpoint - All features complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All API routes use lib/api-response.js helpers for consistent responses
- Business logic is centralized in lib/platform-store.js
