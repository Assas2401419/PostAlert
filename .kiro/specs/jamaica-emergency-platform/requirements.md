# Requirements Document

## Introduction

Postalert is a crowdsourced, real-time incident reporting and intelligence platform designed for Jamaica. It combines the community-driven approach of Waze and Citizen with emergency management capabilities tailored for Jamaican citizens and authorities. The platform enables citizens (16+) to report incidents with photos, GPS location, and severity ratings, while providing authorities (police, fire, ambulance, community leaders) with a dashboard for monitoring, verification, and response coordination.

This is an MVP scope designed for a 24-hour hackathon, focusing on core functionality: user authentication, incident reporting, real-time map visualization, community confirmation system, authority dashboard, notifications, and basic content moderation.

## Glossary

- **Postalert**: The main system being developed - a crowdsourced emergency reporting platform for Jamaica
- **Citizen_User**: A registered user aged 16+ who can report and confirm incidents
- **Authority_User**: A verified user representing police, fire, ambulance, or community leadership with elevated privileges
- **Incident**: A reported event including crime, accident, natural disaster, infrastructure issue, or community alert
- **Confirmation**: A community validation action where users verify or dispute reported incidents
- **Severity_Level**: A classification of incident urgency: Low (green), Medium (yellow), High (orange), Critical (red)
- **Strike**: A penalty point assigned to users for content policy violations
- **Incident_Feed**: The real-time map and list view showing active incidents
- **Authority_Dashboard**: A specialized interface for authorities to monitor, verify, and respond to incidents
- **Report_Form**: A multi-step form for submitting new incidents
- **Geofence**: A geographic boundary used to filter incidents and notifications by location
- **PostGIS**: PostgreSQL extension for geographic data storage and queries
- **Realtime_Layer**: Real-time update channel used to push incident changes to clients

## Requirements

### Requirement 1: User Registration

**User Story:** As a new user, I want to register an account with my email and password, so that I can access the platform and report incidents.

#### Acceptance Criteria

1. WHEN a user submits valid registration data (email, password, name, parish), THE Registration_Service SHALL create a new Citizen_User account
2. WHEN a user submits an email that already exists, THE Registration_Service SHALL return an error indicating the email is already registered
3. WHEN a user submits a password shorter than 8 characters, THE Registration_Service SHALL return a validation error
4. THE Registration_Service SHALL hash passwords using bcrypt before storing in the database
5. WHEN registration succeeds, THE Registration_Service SHALL return a JWT authentication token

### Requirement 2: User Authentication

**User Story:** As a registered user, I want to log in with my credentials, so that I can access my account and platform features.

#### Acceptance Criteria

1. WHEN a user submits valid email and password, THE Authentication_Service SHALL return a JWT token and user profile
2. WHEN a user submits invalid credentials, THE Authentication_Service SHALL return an authentication error without revealing which field was incorrect
3. THE Authentication_Service SHALL include user role (citizen or authority) in the JWT payload
4. WHEN a JWT token expires, THE Authentication_Service SHALL require re-authentication
5. IF a user account has 3 or more active strikes, THEN THE Authentication_Service SHALL restrict posting privileges while allowing read access

### Requirement 3: Authority User Verification

**User Story:** As an authority representative, I want to register with my official credentials, so that I can access the authority dashboard and verify incidents.

#### Acceptance Criteria

1. WHEN an authority user registers, THE Registration_Service SHALL require additional fields: organization name, badge/ID number, and official email domain
2. THE Registration_Service SHALL flag new authority registrations for manual verification
3. WHILE an authority account is pending verification, Postalert SHALL grant read-only access to the platform
4. WHEN an administrator approves an authority account, Postalert SHALL upgrade the user role to Authority_User

### Requirement 4: Incident Reporting - Basic Information

**User Story:** As a citizen, I want to report an incident with category and description, so that I can alert the community about emergencies.

#### Acceptance Criteria

1. WHEN a user initiates a new report, THE Report_Form SHALL present Step 1 with incident category selection
2. THE Report_Form SHALL offer these categories: Crime, Accident, Natural Disaster, Infrastructure, Community Alert
3. WHEN a user selects a category, THE Report_Form SHALL display relevant subcategories
4. THE Report_Form SHALL require a description between 10 and 500 characters
5. WHEN description is outside valid length, THE Report_Form SHALL display a character count and validation message

### Requirement 5: Incident Reporting - Location

**User Story:** As a citizen, I want to specify the incident location, so that responders and community members can find it.

#### Acceptance Criteria

1. WHEN a user reaches Step 2, THE Report_Form SHALL request GPS location permission
2. WHEN GPS permission is granted, THE Report_Form SHALL auto-populate coordinates and display on a map
3. WHEN GPS permission is denied, THE Report_Form SHALL allow manual address entry or map pin placement
4. THE Report_Form SHALL validate that location is within Jamaica's geographic boundaries
5. WHEN location is outside Jamaica, THE Report_Form SHALL display an error and prevent submission

### Requirement 6: Incident Reporting - Media and Severity

**User Story:** As a citizen, I want to attach photos and set severity level, so that responders understand the situation better.

#### Acceptance Criteria

1. WHEN a user reaches Step 3, THE Report_Form SHALL allow up to 3 photo uploads
2. THE Report_Form SHALL accept JPEG and PNG formats up to 5MB each
3. WHEN a photo exceeds size limit, THE Report_Form SHALL display an error with the size limit
4. THE Report_Form SHALL present Severity_Level options: Low, Medium, High, Critical with color coding
5. THE Report_Form SHALL default to Medium severity if user does not select

### Requirement 7: Incident Reporting - Review and Submit

**User Story:** As a citizen, I want to review my report before submitting, so that I can verify accuracy.

#### Acceptance Criteria

1. WHEN a user reaches Step 4, THE Report_Form SHALL display a summary of all entered information
2. THE Report_Form SHALL allow navigation back to any previous step for editing
3. WHEN a user confirms submission, THE Incident_Service SHALL create a new Incident record with status "active"
4. WHEN submission succeeds, THE Incident_Service SHALL return the new incident ID and redirect to the incident detail view
5. IF photo upload fails, THEN THE Incident_Service SHALL create the incident without photos and notify the user

### Requirement 8: Real-Time Incident Map Feed

**User Story:** As a user, I want to see incidents on a map in real-time, so that I can stay aware of nearby emergencies.

#### Acceptance Criteria

1. THE Incident_Feed SHALL display an interactive map centered on the user's current location or Kingston by default
2. THE Incident_Feed SHALL render incident markers with color coding matching Severity_Level
3. WHEN a new incident is created, THE Realtime_Layer SHALL push the incident to connected clients within 2 seconds
4. WHEN a user taps an incident marker, THE Incident_Feed SHALL display a preview card with category, severity, time, and confirmation count
5. THE Incident_Feed SHALL support filtering by category, severity, and time range

### Requirement 9: Incident List View

**User Story:** As a user, I want to see incidents in a list format, so that I can browse without using the map.

#### Acceptance Criteria

1. THE Incident_Feed SHALL provide a toggle between map view and list view
2. THE List_View SHALL display incidents sorted by recency (newest first) by default
3. THE List_View SHALL show: category icon, title, severity badge, time ago, confirmation count, and distance
4. WHEN a user scrolls to the bottom, THE List_View SHALL load additional incidents (pagination)
5. THE List_View SHALL support the same filters as the map view

### Requirement 10: Incident Detail View

**User Story:** As a user, I want to view full incident details, so that I can understand the situation completely.

#### Acceptance Criteria

1. WHEN a user selects an incident, THE Incident_Detail_View SHALL display: full description, all photos, exact location on map, reporter info (anonymized option), timestamp, and all confirmations
2. THE Incident_Detail_View SHALL display the current confirmation count and dispute count
3. THE Incident_Detail_View SHALL show authority actions if any have been taken
4. WHEN incident status changes, THE Realtime_Layer SHALL update the detail view in real-time

### Requirement 11: Incident Confirmation System

**User Story:** As a citizen, I want to confirm or dispute incidents, so that the community can validate report accuracy.

#### Acceptance Criteria

1. WHEN a user views an incident they did not report, THE Incident_Detail_View SHALL display Confirm and Dispute buttons
2. WHEN a user confirms an incident, THE Confirmation_Service SHALL increment the confirmation count and record the user ID
3. WHEN a user disputes an incident, THE Confirmation_Service SHALL increment the dispute count and record the user ID
4. THE Confirmation_Service SHALL prevent users from confirming or disputing the same incident twice
5. WHEN confirmation count reaches 5, THE Incident_Service SHALL upgrade incident credibility status to "verified"
6. WHEN dispute count exceeds confirmation count by 3, THE Incident_Service SHALL flag the incident for review

### Requirement 12: Authority Dashboard - Incident Monitoring

**User Story:** As an authority user, I want to monitor all incidents in my jurisdiction, so that I can coordinate responses.

#### Acceptance Criteria

1. WHILE a user has Authority_User role, Postalert SHALL display the Authority_Dashboard option
2. THE Authority_Dashboard SHALL display incidents filtered by the authority's assigned parish or jurisdiction
3. THE Authority_Dashboard SHALL highlight unverified and high-severity incidents
4. THE Authority_Dashboard SHALL display incident statistics: total active, by category, by severity
5. WHEN a new high-severity incident is created in jurisdiction, THE Realtime_Layer SHALL trigger an alert sound and visual notification

### Requirement 13: Authority Dashboard - Incident Actions

**User Story:** As an authority user, I want to take official actions on incidents, so that I can update the community on response status.

#### Acceptance Criteria

1. WHEN an authority user views an incident, THE Authority_Dashboard SHALL display action buttons: Verify, Respond, Resolve, Dismiss
2. WHEN an authority verifies an incident, THE Incident_Service SHALL update status to "authority_verified" and record the authority user
3. WHEN an authority marks responding, THE Incident_Service SHALL update status to "responding" with timestamp
4. WHEN an authority resolves an incident, THE Incident_Service SHALL update status to "resolved" and move to historical data
5. WHEN an authority dismisses an incident as false, THE Incident_Service SHALL update status to "dismissed" and increment reporter's strike count

### Requirement 14: Push Notifications

**User Story:** As a user, I want to receive notifications about nearby incidents, so that I can stay safe.

#### Acceptance Criteria

1. WHEN a user enables notifications, THE Notification_Service SHALL register the device token
2. WHEN a high or critical severity incident is created within 5km of user's location, THE Notification_Service SHALL send a push notification within 30 seconds
3. THE Notification_Service SHALL include incident category, severity, and distance in the notification
4. WHEN a user taps a notification, Postalert SHALL open the incident detail view
5. THE Notification_Service SHALL respect user notification preferences (categories, severity threshold, quiet hours)

### Requirement 15: Historical Trends Dashboard

**User Story:** As a user, I want to view incident trends and statistics, so that I can understand safety patterns in my area.

#### Acceptance Criteria

1. THE Trends_Dashboard SHALL display incident counts by category over selectable time periods (24h, 7d, 30d)
2. THE Trends_Dashboard SHALL display a heat map showing incident density by location
3. THE Trends_Dashboard SHALL show top 5 incident categories for the selected period
4. THE Trends_Dashboard SHALL allow filtering by parish
5. WHEN data is insufficient for trends, THE Trends_Dashboard SHALL display a message indicating minimum data requirements

### Requirement 16: Content Moderation - Strike System

**User Story:** As a platform administrator, I want to enforce content policies through a strike system, so that the platform remains trustworthy.

#### Acceptance Criteria

1. WHEN an incident is dismissed as false by an authority, THE Moderation_Service SHALL add 1 strike to the reporter's account
2. WHEN a user accumulates 3 strikes, THE Moderation_Service SHALL restrict posting privileges for 7 days
3. WHEN a user accumulates 5 strikes, THE Moderation_Service SHALL permanently ban the account from posting
4. THE Moderation_Service SHALL allow users to appeal strikes through a support form
5. THE Moderation_Service SHALL automatically remove 1 strike after 90 days of good standing

### Requirement 17: Content Moderation - Automated Filtering

**User Story:** As a platform administrator, I want automated content filtering, so that inappropriate content is blocked before publication.

#### Acceptance Criteria

1. WHEN an incident description is submitted, THE Moderation_Service SHALL scan for prohibited keywords and phrases
2. IF prohibited content is detected, THEN THE Moderation_Service SHALL block submission and display a policy violation message
3. THE Moderation_Service SHALL flag incidents with potentially sensitive content for manual review
4. WHEN a photo is uploaded, THE Moderation_Service SHALL queue it for content safety scanning

### Requirement 18: User Profile Management

**User Story:** As a user, I want to manage my profile and view my activity, so that I can track my contributions.

#### Acceptance Criteria

1. THE Profile_View SHALL display user's name, parish, account creation date, and reputation score
2. THE Profile_View SHALL list user's reported incidents with status
3. THE Profile_View SHALL list user's confirmations and disputes
4. THE Profile_View SHALL display current strike count if any
5. WHEN a user updates profile information, THE Profile_Service SHALL validate and save changes

### Requirement 19: Responsive Design

**User Story:** As a user, I want to access the platform on any device, so that I can report and view incidents anywhere.

#### Acceptance Criteria

1. Postalert SHALL render correctly on mobile devices (320px - 767px width)
2. Postalert SHALL render correctly on tablets (768px - 1023px width)
3. Postalert SHALL render correctly on desktops (1024px+ width)
4. THE Report_Form SHALL be fully functional on mobile devices with touch-friendly controls
5. THE Incident_Feed map SHALL support touch gestures for pan and zoom on mobile

### Requirement 20: Offline Resilience

**User Story:** As a user, I want basic functionality when offline, so that I can still access critical information.

#### Acceptance Criteria

1. WHEN network connection is lost, Postalert SHALL display cached incidents from the last successful sync
2. WHEN a user attempts to report while offline, Postalert SHALL queue the report for submission when connection restores
3. WHEN connection is restored, Postalert SHALL automatically submit queued reports and sync new data
4. Postalert SHALL display a clear offline indicator when network is unavailable

### Requirement 21: Data Persistence and API

**User Story:** As a developer, I want a well-structured API and database, so that the platform is maintainable and extensible.

#### Acceptance Criteria

1. THE API SHALL follow RESTful conventions with consistent endpoint naming
2. THE API SHALL return JSON responses with consistent error format: {error: string, code: number}
3. THE Database SHALL use PostGIS for geographic queries and spatial indexing
4. THE API SHALL implement rate limiting: 100 requests per minute for authenticated users, 20 for unauthenticated
5. FOR ALL Incident objects, serializing to JSON then parsing back SHALL produce an equivalent object (round-trip property)
