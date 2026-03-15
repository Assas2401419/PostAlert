# Requirements Document

## Introduction

PostAlert is a real-time crowdsourced emergency incident reporting platform for Jamaica. The platform enables citizens to report incidents with photos, GPS location, and severity ratings while providing authorities with dashboards for monitoring, verification, and response coordination. The system keeps communities informed about nearby emergencies through push notifications and real-time updates.

## Glossary

- **PostAlert_System**: The complete emergency incident reporting platform
- **Auth_Service**: The authentication and authorization module handling user registration, login, and session management
- **Incident_Service**: The module responsible for creating, reading, updating, and managing incident reports
- **Map_Service**: The real-time map display component showing incidents with color-coded severity markers
- **Notification_Service**: The push notification system for alerting users about nearby incidents
- **Moderation_Service**: The content moderation system managing strikes, appeals, and user restrictions
- **Authority_Dashboard**: The interface for verified officials to manage and respond to incidents
- **Trends_Service**: The analytics module providing incident statistics and heatmaps
- **Profile_Service**: The user profile management module
- **Comments_Service**: The module for incident discussion threads
- **Citizen**: A registered user who can report and confirm incidents
- **Authority**: A verified official who can verify, respond to, resolve, or dismiss incidents
- **Admin**: A platform administrator who can approve authority accounts and manage the system
- **Incident**: A reported emergency event with location, category, severity, and supporting details
- **Confirmation**: A community vote validating an incident's authenticity
- **Dispute**: A community vote challenging an incident's authenticity
- **Strike**: A penalty issued to users for policy violations
- **Parish**: One of Jamaica's 14 administrative divisions used for geographic filtering

## Requirements

### Requirement 1: User Registration

**User Story:** As a new user, I want to create an account, so that I can report and interact with incidents.

#### Acceptance Criteria

1. WHEN a citizen submits valid registration data (email, password, name, parish), THE Auth_Service SHALL create a new citizen account and return a session token
2. WHEN a citizen submits a password shorter than 8 characters, THE Auth_Service SHALL reject the registration with error code 4004
3. WHEN a citizen submits an email already registered, THE Auth_Service SHALL reject the registration with error code 4090
4. WHEN an authority submits valid registration data (email, password, name, parish, organization, badge number), THE Auth_Service SHALL create a pending authority account requiring admin approval
5. WHEN an authority submits an email not ending in .gov.jm or .org.jm, THE Auth_Service SHALL reject the registration with error code 4006
6. THE Auth_Service SHALL hash all passwords using bcryptjs before storage
7. THE Auth_Service SHALL assign a default reputation score of 50 to new citizen accounts
8. THE Auth_Service SHALL assign a default reputation score of 65 to new authority accounts

### Requirement 2: User Authentication

**User Story:** As a registered user, I want to log in securely, so that I can access my account and platform features.

#### Acceptance Criteria

1. WHEN a user submits valid email and password credentials, THE Auth_Service SHALL authenticate the user and return a JWT session token
2. WHEN a user submits invalid credentials, THE Auth_Service SHALL reject the login attempt without revealing which field was incorrect
3. WHILE a user session is active, THE Auth_Service SHALL maintain the session using JWT strategy
4. WHEN a user requests logout, THE Auth_Service SHALL invalidate the current session
5. THE Auth_Service SHALL use Auth.js (NextAuth v5) with credentials provider for authentication

### Requirement 3: Password Reset

**User Story:** As a user who forgot my password, I want to reset it securely, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a user requests a password reset with a registered email, THE Auth_Service SHALL generate a secure reset token and send it via email
2. WHEN a user submits a valid reset token with a new password, THE Auth_Service SHALL update the password hash and invalidate the token
3. WHEN a user submits an expired or invalid reset token, THE Auth_Service SHALL reject the request with an appropriate error
4. THE Auth_Service SHALL expire password reset tokens after 1 hour
5. THE Auth_Service SHALL invalidate all existing reset tokens when a new one is generated

### Requirement 4: Incident Reporting Wizard

**User Story:** As a citizen, I want to report an incident through a guided wizard, so that I can provide complete and accurate information.

#### Acceptance Criteria

1. THE Incident_Service SHALL present a 4-step wizard: Category Selection, Location, Details with Photos, and Review
2. WHEN a user selects a category, THE Incident_Service SHALL display relevant subcategories (Crime: Robbery/Assault/Suspicious Activity/Burglary/Violence; Accident: Vehicle Collision/Pedestrian Injury/Road Hazard/Fire/Marine Incident; Natural Disaster: Flooding/Landslide/Hurricane Damage/Earthquake Impact/Storm Surge; Infrastructure: Power Outage/Water Supply/Road Damage/Collapsed Drain/Bridge Issue; Community Alert: Missing Person/School Lockdown/Public Health/Crowd Surge/Evacuation)
3. WHEN a user reaches the location step, THE Incident_Service SHALL request GPS coordinates and display a map for confirmation
4. WHEN GPS is unavailable, THE Incident_Service SHALL allow manual parish and address entry
5. WHEN a user uploads photos, THE Incident_Service SHALL accept up to 3 images in JPEG or PNG format with maximum size of 5MB each
6. WHEN a user submits a description shorter than 10 characters or longer than 500 characters, THE Incident_Service SHALL reject with error code 4013
7. THE Incident_Service SHALL allow users to select severity level (low, medium, high, critical)
8. THE Incident_Service SHALL allow users to submit anonymously by toggling the anonymous option
9. WHEN a user completes the review step and submits, THE Incident_Service SHALL create the incident and return to the feed

### Requirement 5: Location Validation

**User Story:** As a platform operator, I want all incidents to be within Jamaica, so that the platform remains focused on its geographic scope.

#### Acceptance Criteria

1. WHEN an incident location is submitted, THE Incident_Service SHALL validate coordinates are within Jamaica's boundaries (latitude 17.65-18.55, longitude -78.45 to -76.1)
2. WHEN coordinates fall outside Jamaica, THE Incident_Service SHALL reject with error code 4014
3. THE Incident_Service SHALL automatically determine the parish based on the nearest parish center using haversine distance calculation
4. THE Incident_Service SHALL store both raw coordinates and computed parish for each incident

### Requirement 6: Real-Time Incident Map

**User Story:** As a user, I want to view incidents on a map, so that I can understand the geographic distribution of emergencies.

#### Acceptance Criteria

1. THE Map_Service SHALL display all active incidents as markers on an interactive map
2. THE Map_Service SHALL color-code markers by severity (emerald for low, amber for medium, orange for high, rose for critical)
3. WHEN a user clicks a marker, THE Map_Service SHALL display an incident summary popup with category, severity, and time
4. THE Map_Service SHALL update in real-time using Supabase Realtime subscriptions
5. THE Map_Service SHALL allow filtering by category, severity, and parish
6. THE Map_Service SHALL center on Jamaica with appropriate zoom level showing all 14 parishes

### Requirement 7: Incident Feed

**User Story:** As a user, I want to browse incidents in a list view, so that I can quickly scan recent reports.

#### Acceptance Criteria

1. THE Incident_Service SHALL display incidents in reverse chronological order (newest first)
2. THE Incident_Service SHALL paginate results with 8 incidents per page
3. WHEN filters are applied, THE Incident_Service SHALL return only matching incidents
4. THE Incident_Service SHALL display category icon, severity badge, title, parish, and relative time for each incident
5. THE Incident_Service SHALL indicate credibility status (pending, verified, flagged) on each incident card

### Requirement 8: Incident Detail View

**User Story:** As a user, I want to view full incident details, so that I can understand the situation and take appropriate action.

#### Acceptance Criteria

1. WHEN a user selects an incident, THE Incident_Service SHALL display full details including description, photos, location map, reporter info (or "Anonymous Reporter"), and timestamp
2. THE Incident_Service SHALL display confirmation and dispute counts
3. THE Incident_Service SHALL display all authority actions with timestamps and notes
4. THE Incident_Service SHALL display the incident status (active, responding, authority_verified, resolved, dismissed)
5. WHEN viewing photos, THE Incident_Service SHALL display a gallery with zoom capability

### Requirement 9: Community Confirmation System

**User Story:** As a citizen, I want to confirm or dispute incidents, so that the community can validate report accuracy.

#### Acceptance Criteria

1. WHEN a user confirms an incident, THE Incident_Service SHALL increment the confirmation count by 1
2. WHEN a user disputes an incident, THE Incident_Service SHALL increment the dispute count by 1
3. WHEN a user attempts to vote on their own incident, THE Incident_Service SHALL reject with error code 4017
4. WHEN a user has already voted on an incident, THE Incident_Service SHALL reject with error code 4091
5. WHEN an incident reaches 5 confirmations, THE Incident_Service SHALL update credibility status to "verified"
6. WHEN dispute count exceeds confirmation count by 3 or more, THE Incident_Service SHALL update credibility status to "flagged"

### Requirement 10: Authority Dashboard

**User Story:** As an authority, I want a dedicated dashboard, so that I can monitor and manage incidents in my jurisdiction.

#### Acceptance Criteria

1. WHEN an authority accesses the dashboard, THE Authority_Dashboard SHALL display incidents filtered by their assigned parish
2. THE Authority_Dashboard SHALL display statistics: total active incidents, breakdown by category, breakdown by severity
3. THE Authority_Dashboard SHALL allow authorities to filter by status (active, responding, resolved)
4. WHEN an unverified authority attempts to access the dashboard, THE Authority_Dashboard SHALL display read-only mode with pending approval message
5. THE Authority_Dashboard SHALL allow admins to view any parish by selecting from a dropdown

### Requirement 11: Authority Actions

**User Story:** As an authority, I want to take official actions on incidents, so that I can coordinate emergency response.

#### Acceptance Criteria

1. WHEN an authority verifies an incident, THE Incident_Service SHALL update status to "authority_verified" and record the action
2. WHEN an authority responds to an incident, THE Incident_Service SHALL update status to "responding" and record timestamp
3. WHEN an authority resolves an incident, THE Incident_Service SHALL update status to "resolved" and record timestamp
4. WHEN an authority dismisses an incident as false, THE Incident_Service SHALL update status to "dismissed" and issue a strike to the reporter
5. THE Incident_Service SHALL record authority name, action type, notes (up to 300 characters), and timestamp for each action
6. WHEN an unverified authority attempts an action, THE Incident_Service SHALL reject with error code 4030

### Requirement 12: Admin Authority Approval

**User Story:** As an admin, I want to approve authority accounts, so that only verified officials can take official actions.

#### Acceptance Criteria

1. WHEN an admin requests pending authorities, THE Auth_Service SHALL return all authority accounts with verified=false
2. WHEN an admin approves an authority, THE Auth_Service SHALL set verified=true and grant full authority permissions
3. WHEN a non-admin attempts to approve authorities, THE Auth_Service SHALL reject with error code 4031
4. THE Auth_Service SHALL display organization name and badge number for verification

### Requirement 13: Push Notifications

**User Story:** As a user, I want to receive notifications about nearby incidents, so that I can stay informed about emergencies in my area.

#### Acceptance Criteria

1. WHEN a high or critical severity incident is created, THE Notification_Service SHALL evaluate all users for notification eligibility
2. THE Notification_Service SHALL send notifications only to users within their configured radius (default 5km)
3. THE Notification_Service SHALL respect user category preferences and minimum severity settings
4. WHILE quiet hours are active (default 22:00-06:00), THE Notification_Service SHALL suppress notifications
5. THE Notification_Service SHALL include incident category, severity, and distance in notification body
6. WHEN a user registers a device token, THE Notification_Service SHALL store it for push delivery

### Requirement 14: Notification Preferences

**User Story:** As a user, I want to customize my notification settings, so that I receive relevant alerts without being overwhelmed.

#### Acceptance Criteria

1. THE Profile_Service SHALL allow users to enable or disable notifications
2. THE Profile_Service SHALL allow users to select which categories trigger notifications
3. THE Profile_Service SHALL allow users to set minimum severity threshold (low, medium, high, critical)
4. THE Profile_Service SHALL allow users to set notification radius in kilometers
5. THE Profile_Service SHALL allow users to configure quiet hours start and end times
6. THE Profile_Service SHALL persist preferences and apply them to all future notifications

### Requirement 15: Comments System

**User Story:** As a user, I want to comment on incidents, so that I can share additional information or ask questions.

#### Acceptance Criteria

1. WHEN a user submits a comment on an incident, THE Comments_Service SHALL store the comment with user reference and timestamp
2. THE Comments_Service SHALL display comments in chronological order on the incident detail view
3. THE Comments_Service SHALL apply content moderation rules to comments
4. WHEN a comment contains prohibited keywords, THE Comments_Service SHALL reject the submission
5. THE Comments_Service SHALL allow users to delete their own comments
6. WHILE a user has posting restrictions, THE Comments_Service SHALL reject comment submissions

### Requirement 16: Trends and Analytics Dashboard

**User Story:** As a user, I want to view incident trends, so that I can understand patterns and make informed decisions.

#### Acceptance Criteria

1. THE Trends_Service SHALL display total incident counts by time period (24h, 7d, 30d)
2. THE Trends_Service SHALL display top categories with incident counts
3. THE Trends_Service SHALL display a heatmap showing incident density by parish
4. THE Trends_Service SHALL allow filtering by date range
5. THE Trends_Service SHALL update statistics in real-time as new incidents are reported

### Requirement 17: User Profile Page

**User Story:** As a user, I want to manage my profile, so that I can update my information and view my activity.

#### Acceptance Criteria

1. THE Profile_Service SHALL display user name, email, parish, role, and reputation score
2. THE Profile_Service SHALL allow users to update their name and parish
3. THE Profile_Service SHALL display a list of incidents reported by the user
4. THE Profile_Service SHALL display confirmation and dispute activity history
5. THE Profile_Service SHALL display active strikes and their reasons
6. THE Profile_Service SHALL display notification preferences with edit capability
7. WHEN a user updates their location, THE Profile_Service SHALL store the new coordinates for notification distance calculations

### Requirement 18: Strike-Based Content Moderation

**User Story:** As a platform operator, I want to moderate content and penalize violations, so that the platform remains trustworthy.

#### Acceptance Criteria

1. WHEN content contains prohibited keywords (fake bomb, target civilians, hate speech), THE Moderation_Service SHALL block submission with error code 4015
2. WHEN content contains sensitive keywords (gun, knife, blood, child, shooting, domestic abuse), THE Moderation_Service SHALL flag the incident for review but allow submission
3. WHEN an authority dismisses an incident as false, THE Moderation_Service SHALL issue a strike to the reporter
4. WHEN a user accumulates 3 active strikes, THE Moderation_Service SHALL restrict posting for 7 days
5. WHEN a user accumulates 5 active strikes, THE Moderation_Service SHALL permanently ban posting
6. THE Moderation_Service SHALL decay one strike after 90 days of no new strikes (oldest first)
7. WHILE a user has posting restrictions, THE Incident_Service SHALL reject new incident submissions with error code 4032

### Requirement 19: Moderation Appeals

**User Story:** As a user who received a strike, I want to appeal the decision, so that I can contest unfair penalties.

#### Acceptance Criteria

1. WHEN a user submits an appeal for a strike, THE Moderation_Service SHALL create an appeal record with status "submitted"
2. THE Moderation_Service SHALL allow one appeal per strike
3. WHEN an admin reviews an appeal, THE Moderation_Service SHALL update status to "approved" or "rejected"
4. WHEN an appeal is approved, THE Moderation_Service SHALL remove the associated strike
5. THE Profile_Service SHALL display appeal status on the user's profile

### Requirement 20: Offline Support

**User Story:** As a user with unreliable connectivity, I want the app to work offline, so that I can still report incidents.

#### Acceptance Criteria

1. THE PostAlert_System SHALL register a service worker for offline capability
2. WHEN offline, THE Incident_Service SHALL queue incident submissions locally
3. WHEN connectivity is restored, THE Incident_Service SHALL automatically submit queued incidents
4. THE PostAlert_System SHALL cache essential assets for offline access
5. WHILE offline, THE Map_Service SHALL display cached incident data with a stale indicator

### Requirement 21: Real-Time Updates

**User Story:** As a user, I want to see updates without refreshing, so that I have the latest information.

#### Acceptance Criteria

1. THE PostAlert_System SHALL subscribe to Supabase Realtime channels for incident updates
2. WHEN a new incident is created, THE Incident_Service SHALL push it to all connected clients
3. WHEN an incident status changes, THE Incident_Service SHALL broadcast the update
4. WHEN confirmation or dispute counts change, THE Incident_Service SHALL update all viewing clients
5. THE Map_Service SHALL animate new incident markers appearing on the map

### Requirement 22: Data Persistence

**User Story:** As a platform operator, I want reliable data storage, so that no incident reports are lost.

#### Acceptance Criteria

1. THE PostAlert_System SHALL use Supabase PostgreSQL as the primary database
2. WHEN Supabase is not configured, THE PostAlert_System SHALL fall back to local JSON storage (data/local-db.json)
3. THE PostAlert_System SHALL use PostGIS for geographic queries and distance calculations
4. THE PostAlert_System SHALL index incidents by location, status, category, and created_at for query performance
5. FOR ALL valid Incident objects, serializing then deserializing SHALL produce an equivalent object (round-trip property)

### Requirement 23: API Response Consistency

**User Story:** As a developer, I want consistent API responses, so that client code is predictable.

#### Acceptance Criteria

1. THE PostAlert_System SHALL return success responses using the ok(data) helper
2. THE PostAlert_System SHALL return error responses using the fail(error) helper with format {error: string, code: number}
3. THE PostAlert_System SHALL use appropriate HTTP status codes (200 success, 400 bad request, 401 unauthorized, 403 forbidden, 404 not found, 409 conflict)
4. THE PostAlert_System SHALL include pagination metadata (page, limit, total, hasMore) for list endpoints

### Requirement 24: Photo Management

**User Story:** As a user, I want to attach photos to incidents, so that I can provide visual evidence.

#### Acceptance Criteria

1. WHEN a user uploads a photo, THE Incident_Service SHALL validate file type (JPEG, PNG only) and size (5MB maximum)
2. THE Incident_Service SHALL store photos with unique IDs and queue them for content scanning
3. THE Incident_Service SHALL support up to 3 photos per incident
4. WHEN a photo fails validation, THE Incident_Service SHALL reject with error code 4016
5. THE Incident_Service SHALL store photo metadata including name, type, size, and scan status

### Requirement 25: Accessibility Compliance

**User Story:** As a user with disabilities, I want the platform to be accessible, so that I can use all features.

#### Acceptance Criteria

1. THE PostAlert_System SHALL use semantic HTML elements for proper screen reader navigation
2. THE PostAlert_System SHALL provide alt text for all images and icons
3. THE PostAlert_System SHALL support keyboard navigation for all interactive elements
4. THE PostAlert_System SHALL maintain sufficient color contrast ratios for text and UI elements
5. THE PostAlert_System SHALL use lucide-react icons with appropriate aria-labels (no emoji iconography)
