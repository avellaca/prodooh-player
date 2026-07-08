# Implementation Plan: Hybrid Ad Player System

## Overview

This plan implements the Hybrid Ad Player system as a monorepo with three directories: `/backend` (Laravel 11 + PHP 8.4 + PostgreSQL), `/player` (Vanilla TypeScript compiled for Chromium kiosk on Raspberry Pi 5), and `/contracts` (shared API type definitions). Tasks are ordered so dependencies are respected: contracts and scaffolding first, then backend database and auth, then APIs, then player core logic, then integration and deployment.

## Tasks

- [x] 1. Project scaffolding and shared contracts
  - [x] 1.1 Initialize monorepo structure with backend, player, and contracts directories
    - Create `/backend` with Laravel 11 skeleton (composer create-project)
    - Create `/player` with TypeScript project (tsconfig, Vitest, fast-check)
    - Create `/contracts` with shared OpenAPI types and TypeScript interfaces
    - Add root README and `.gitignore` entries for each directory
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 1.2 Define shared API contract types in `/contracts`
    - Define TypeScript interfaces for Device Auth, Config, Heartbeat, Playlist Sync, Playback Logs, Screenshot endpoints
    - Define `SourceType`, `PreparedContent`, `LoopConfig`, `SlotConfig` shared types
    - Define OpenAPI YAML schema for backend REST endpoints
    - _Requirements: 13.4, 7.1, 8.1_

  - [x] 1.3 Configure player project tooling
    - Set up Vitest with `jsdom` environment and `--run` flag
    - Install and configure `fast-check` for property-based testing
    - Set up TypeScript strict mode compilation targeting ES2022
    - Configure build script for Raspberry Pi deployment bundle
    - _Requirements: 13.3_

  - [x] 1.4 Configure backend project tooling
    - Set up PHPUnit with Eris for property-based testing
    - Configure PostgreSQL connection in `.env.example`
    - Set up Laravel Sanctum for admin auth
    - Add API route groups (device, admin)
    - _Requirements: 13.2_

- [x] 2. Backend: Database migrations and models
  - [x] 2.1 Create database migrations for tenants, users, and screen groups
    - Create `tenants` table migration (uuid PK, name, api_credential, default_config JSONB, defaults for duration/timezone/schedule/transition)
    - Create `users` table migration (uuid PK, tenant_id FK, email, password_hash, role enum)
    - Create `screen_groups` table migration (uuid PK, tenant_id FK, name, duration, schedule JSONB, orientation, resolution)
    - _Requirements: 11.1, 11.2, 12.1, 15.1, 15.2_

  - [x] 2.2 Create database migrations for screens and device commands
    - Create `screens` table migration (uuid PK, tenant_id FK, group_id FK nullable, venue_id unique, device_token_hash, name, status enum, all config columns, loop_config JSONB, sources_config JSONB)
    - Create `device_commands` table migration (uuid PK, screen_id FK, type enum, payload JSONB, status enum, timestamps)
    - _Requirements: 1.2, 7.1, 8.1, 10.1, 20.1_

  - [x] 2.3 Create database migrations for content, playlists, and playlist items
    - Create `content` table migration (uuid PK, tenant_id FK, filename, mime_type, storage_path, file_size, dimensions, duration, orientation, rotation, checksum)
    - Create `playlists` table migration (uuid PK, tenant_id FK, name, version)
    - Create `playlist_items` table migration (uuid PK, playlist_id FK, content_id FK nullable, type enum, url, duration, position, refresh_interval)
    - Create `screen_playlists` pivot table migration
    - _Requirements: 4.3, 9.1, 21.1, 26.1, 28.1_

  - [x] 2.4 Create database migrations for screenshots and playback logs
    - Create `screenshots` table migration (uuid PK, screen_id FK, storage_path, captured_at, created_at)
    - Create `playback_logs` table migration (uuid PK, screen_id FK, tenant_id FK, content_id, source enum, started_at, ended_at, duration, result enum, failure_reason, synced_at)
    - _Requirements: 17.3, 18.1, 18.3_

  - [x] 2.5 Create Eloquent models with relationships and scopes
    - Create Tenant, User, Screen, ScreenGroup, Content, Playlist, PlaylistItem, ScreenPlaylist, Screenshot, PlaybackLog, DeviceCommand models
    - Define all relationships (belongsTo, hasMany, belongsToMany)
    - Add tenant-aware scope trait for row-level filtering
    - _Requirements: 11.4, 12.3_

- [x] 3. Backend: Authentication and multi-tenant middleware
  - [x] 3.1 Implement device authentication (JWT token issuance)
    - Create `DeviceAuthController` with POST `/api/device/auth` endpoint
    - Validate device_token + venue_id against screens table
    - Issue JWT token with screen_id, tenant_id, venue_id claims
    - Handle invalid credentials (401), not found device (404)
    - _Requirements: 1.2_

  - [x] 3.2 Implement admin authentication with Laravel Sanctum
    - Create `AdminAuthController` with login/logout endpoints
    - Configure Sanctum for SPA token-based auth
    - Create seeder for super-admin user
    - _Requirements: 11.4, 12.1_

  - [x] 3.3 Implement TenantScopeMiddleware for row-level data isolation
    - Create middleware that applies global scopes to all tenant-aware models for tenant-admin users
    - Super-admin bypasses all scopes
    - Apply middleware to admin API route group
    - _Requirements: 11.4, 12.1, 12.2, 12.3_

  - [ ]* 3.4 Write property test for tenant data isolation (Backend)
    - **Property 17: Tenant Data Isolation**
    - Generate random users (tenant-admin/super-admin) and resources across multiple tenants
    - Verify tenant-admin sees only own tenant resources; super-admin sees all
    - **Validates: Requirements 11.4, 12.1, 12.2, 12.3**

  - [x] 3.5 Implement Role Guard middleware
    - Create middleware to enforce super-admin vs tenant-admin permissions per route
    - Protect tenant CRUD and cross-tenant endpoints for super-admin only
    - _Requirements: 11.4, 12.3_

- [~] 4. Checkpoint - Database and auth foundation
  - Ensure all migrations run cleanly, models instantiate, auth endpoints return correct responses. Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Backend: Tenant and device management APIs
  - [~] 5.1 Implement TenantService and admin tenant CRUD endpoints
    - Create TenantService with create, update, delete, list methods
    - Generate unique API credential on tenant creation
    - Implement POST/GET/PUT/DELETE `/api/admin/tenants` endpoints
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ]* 5.2 Write property test for tenant credential uniqueness (Backend)
    - **Property 16: Tenant Credential Uniqueness**
    - Generate N tenants and verify all API credentials are pairwise distinct
    - **Validates: Requirements 11.2**

  - [~] 5.3 Implement DeviceService and screen management endpoints
    - Create DeviceService with register, assign to tenant, update config methods
    - Implement POST/GET/PUT `/api/admin/screens` endpoints
    - Include device_token generation and secure hashing
    - _Requirements: 11.3, 1.2, 20.1_

  - [~] 5.4 Implement ScreenGroupService and group endpoints
    - Create ScreenGroupService with CRUD and screen assignment
    - Implement POST/PUT `/api/admin/groups` and screen assignment
    - Implement config inheritance (duration, schedule, orientation from group)
    - _Requirements: 15.2, 15.8, 16.7, 20.4_

- [ ] 6. Backend: Loop configuration and source toggle APIs
  - [~] 6.1 Implement LoopConfigService and loop configuration endpoint
    - Create LoopConfigService with slot count, duration per slot, source assignment
    - Implement PUT `/api/admin/screens/{id}/loop` endpoint
    - Default config: 4 slots x 10s, one per source (25% SOV each)
    - Validate that all slots have valid source assignments
    - _Requirements: 7.1, 7.2, 7.5, 7.7_

  - [ ]* 6.2 Write property test for weight-to-slot assignment (Backend)
    - **Property 10: Weight-to-Slot Assignment**
    - Generate random source weights summing to N slots; verify slot array has exact counts
    - **Validates: Requirements 7.2, 7.7**

  - [~] 6.3 Implement SourceToggleService and source enable/disable
    - Create SourceToggleService that enables/disables sources per screen
    - Reassign disabled source slots to playlist local
    - Implement as part of screen config update endpoint
    - _Requirements: 10.1, 10.2, 10.3, 7.6_

  - [ ]* 6.4 Write property test for disabled source slot reassignment (Backend)
    - **Property 12: Disabled Source Slot Reassignment**
    - Toggle source off → verify all its slots become playlist; total slot count unchanged
    - **Validates: Requirements 7.6, 10.2**

- [ ] 7. Backend: Content library and playlist management
  - [~] 7.1 Implement ContentValidationPipeline and content upload
    - Create FormatValidator, CodecValidator, ResolutionValidator, FileSizeValidator, OrientationValidator
    - Create ContentLibraryService with upload, validate, store, delete
    - Implement POST/GET/DELETE `/api/admin/content` endpoints
    - Validate supported formats: JPEG, PNG, WebP, MP4 (H.264/H.265)
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 26.1, 26.2_

  - [ ]* 7.2 Write property test for content validation pipeline (Backend)
    - **Property 22: Content Validation Pipeline**
    - Generate random file metadata combinations; verify acceptance iff all criteria met
    - **Validates: Requirements 21.1, 21.2, 21.3, 21.4, 21.5**

  - [~] 7.3 Implement PlaylistService and playlist CRUD endpoints
    - Create PlaylistService with create, update items, assign to screens, version management
    - Implement GET/POST/PUT `/api/admin/playlists` endpoints
    - Implement POST `/api/admin/playlists/{id}/assign` for multi-screen assignment
    - Support image, video, and URL item types in playlists
    - Handle cascade delete when content removed from library
    - _Requirements: 9.1, 26.3, 26.4, 26.6, 26.7, 28.1, 28.2, 28.6_

  - [~] 7.4 Implement content rotation metadata endpoint
    - Implement PUT `/api/admin/content/{id}/rotate` for setting rotation (0°, 90°, 180°, 270°)
    - Store rotation as metadata without modifying original file
    - Validate video rotation restrictions (not allowed if in active playlist)
    - _Requirements: 24.1, 24.2, 24.5_

- [ ] 8. Backend: Device communication APIs
  - [~] 8.1 Implement ConfigSyncController (GET /api/device/config)
    - Serve full device config: loop config, sources config, display settings, schedule, sync intervals
    - Resolve duration using hierarchy: screen > group > tenant
    - Include all source credentials relevant to the device's tenant
    - _Requirements: 7.1, 15.4, 16.1, 1.2, 1.3_

  - [~] 8.2 Implement HeartbeatController (POST /api/device/heartbeat)
    - Receive heartbeat with current_content, storage status, uptime, playlist_version
    - Update screen last_heartbeat and status
    - Return pending device commands in response
    - _Requirements: 8.1, 8.2, 22.1_

  - [ ]* 8.3 Write property test for heartbeat grace period state machine (Backend)
    - **Property 14: Heartbeat Grace Period State Machine**
    - Generate random heartbeat timestamps and thresholds; verify state transitions
    - **Validates: Requirements 8.2**

  - [~] 8.4 Implement PlaylistSyncController (GET/POST /api/device/playlist)
    - Serve playlist manifest with ETag support (304 Not Modified)
    - Include item details: type, URL, duration, rotation, checksum
    - Receive adoption confirmation (POST /api/device/playlist/confirm)
    - _Requirements: 4.4, 9.1, 9.2, 9.3_

  - [~] 8.5 Implement PlaybackLogController (POST /api/device/playback-logs)
    - Receive batched playback log entries from device
    - Validate required fields: content_id, source, timestamps, duration, result
    - Acknowledge received entries by ID
    - _Requirements: 18.1, 18.2, 18.5_

  - [~] 8.6 Implement ScreenshotController (POST /api/device/screenshot)
    - Receive multipart screenshot upload with captured_at timestamp
    - Store screenshot associated with screen
    - Implement screenshot request command (triggered via device_commands)
    - _Requirements: 17.1, 17.2, 17.3_

  - [~] 8.7 Implement DeviceStatusService with online/offline detection
    - Track device status based on heartbeat intervals
    - Implement grace period logic before marking device as unresponsive
    - Expose status in admin screen list endpoint
    - _Requirements: 8.2_

- [ ] 9. Backend: Analytics and admin query endpoints
  - [~] 9.1 Implement PlaybackAnalyticsService and query endpoint
    - Create GET `/api/admin/analytics/playback` with date range, screen, source filters
    - Aggregate spots by screen, by source, by content/campaign
    - Enforce tenant isolation on analytics queries
    - _Requirements: 18.3, 18.4_

  - [~] 9.2 Implement screenshot viewing with tenant isolation
    - Create GET endpoint for admin to view screenshots of their own screens
    - Super-admin can view all; tenant-admin only their own
    - _Requirements: 17.4, 17.5_

- [~] 10. Checkpoint - Backend APIs complete
  - Ensure all backend endpoints respond correctly, migrations run, tenant isolation works, all backend tests pass. Ask the user if questions arise.

- [ ] 11. Player: Local storage layer and configuration
  - [~] 11.1 Implement LocalConfigStore with SQLite schema
    - Create SQLite database initialization with all tables (device_config, loop_config, playlist, playlist_items, pop_queue, playback_log, schedule)
    - Implement key-value config read/write (venue_id, device_token, credentials)
    - Implement loop_config and schedule persistence
    - _Requirements: 1.1, 1.4, 4.1_

  - [~] 11.2 Implement device authentication client
    - Create BackendApi client class with POST `/api/device/auth` call
    - Store JWT token locally, handle token refresh on expiry
    - Implement graceful degradation when backend is unreachable
    - _Requirements: 1.2, 1.4_

  - [ ]* 11.3 Write property test for credential isolation
    - **Property 1: Credential Isolation**
    - Generate random source configs with distinct credentials; verify each request uses only its own credentials
    - **Validates: Requirements 1.3**

  - [ ]* 11.4 Write property test for graceful degradation on missing configuration
    - **Property 2: Graceful Degradation on Missing Configuration**
    - Generate random subsets of missing configs; verify only affected operations are disabled
    - **Validates: Requirements 1.4**

- [ ] 12. Player: Content source interface and PlaylistSource
  - [~] 12.1 Define ContentSource interface and PreparedContent types
    - Create `ContentSource` interface with prefetch, confirmPlay, reportFailure, isAvailable methods
    - Define `PreparedContent` type with id, type, mediaUrl, duration, metadata, element
    - Define `SourceType` enum: 'prodooh' | 'gam' | 'url' | 'playlist'
    - _Requirements: 7.4_

  - [~] 12.2 Implement PlaylistSource (local playlist content source)
    - Implement ContentSource interface for local playlist cycling
    - Read playlist items from SQLite local store
    - Cycle through items sequentially, wrapping at end
    - Support image, video, and URL item types
    - _Requirements: 4.1, 4.2, 28.1, 28.3_

  - [~] 12.3 Implement FallbackBuffer with pre-decoded content ready in memory
    - Maintain at least 1 pre-decoded playlist item in memory at all times
    - Implement replenish logic (async, non-blocking)
    - Support fallback to factory/precargado content when playlist is empty
    - Pre-render images (decode), videos (canplaythrough), iframes (load)
    - _Requirements: 4.1, 6.3, 6.4, 25.1, 25.2, 25.3_

  - [ ]* 12.4 Write property test for fallback buffer invariant
    - **Property 6: Fallback Buffer Invariant**
    - Simulate sequences of getNext() and replenish(); verify buffer always has ≥1 item
    - **Validates: Requirements 4.1, 6.4**

- [ ] 13. Player: ProDooh and GAM content sources
  - [~] 13.1 Implement ProDoohSource (Prodooh Ad Serving API client)
    - Implement ContentSource interface for Prodooh API
    - POST `/public/v1/ad` with venue_id, dimensions, supported_media
    - Handle success (media URL + print_id), no-fill, and errors
    - Implement rate limiting (minimum 10s between requests)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 13.2 Write property test for rate limit compliance
    - **Property 4: Rate Limit Compliance**
    - Generate sequences of ad requests with varying timing; verify minimum interval enforced
    - **Validates: Requirements 2.5**

  - [~] 13.3 Implement GamVastSource (Google Ad Manager VAST client)
    - Implement ContentSource interface for GAM VAST
    - Validate sandbox tag format before sending request
    - Parse VAST XML to extract media URL and duration
    - Handle timeout, empty response, malformed XML
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 13.4 Write property test for sandbox tag validation
    - **Property 5: Sandbox Tag Validation**
    - Generate random strings; verify only valid sandbox tag patterns are accepted
    - **Validates: Requirements 3.1**

- [ ] 14. Player: URL source and Proof of Play queue
  - [~] 14.1 Implement UrlSource (web content source)
    - Implement ContentSource interface for URL-based content
    - Load URLs in hidden iframe, swap to visible when ready
    - Support multiple URLs with internal rotation
    - Handle timeout (default 10s), load failures
    - Support dynamic variable injection (venue_id, tenant_id, timestamp)
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6_

  - [~] 14.2 Implement POPQueue (Proof of Play persistent queue)
    - Create persistent queue in SQLite for proof_of_play and expiration notifications
    - Implement enqueue for both action types
    - Implement processQueue with exponential backoff (1s → 2s → 4s → ... → 60s max)
    - Handle HTTP 201 (success), 409 (already processed), and errors
    - Never discard undelivered notifications
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 14.3 Write property test for print ID lifecycle completeness
    - **Property 7: Print ID Lifecycle Completeness**
    - Generate random playback outcomes; verify each print_id gets exactly one terminal action
    - **Validates: Requirements 2.2, 5.1, 5.2, 5.3**

  - [ ]* 14.4 Write property test for exponential backoff calculation
    - **Property 8: Exponential Backoff Calculation**
    - Generate random failure counts; verify delay = min(2^N * 1000, 60000) and never discarded
    - **Validates: Requirements 5.4**

- [ ] 15. Player: Core loop engine
  - [~] 15.1 Implement LoopEngine (fixed-slot sequential execution)
    - Execute slots in strict sequential order (0, 1, ..., N-1, 0, 1, ...)
    - Call assigned ContentSource for each slot
    - On source failure, fill with FallbackBuffer content
    - Support dynamic config updates without restart
    - Integrate with ScheduleManager for operating hours check
    - _Requirements: 7.1, 7.3, 7.8, 6.1, 6.2_

  - [ ]* 15.2 Write property test for loop sequential determinism
    - **Property 9: Loop Sequential Determinism**
    - Generate random loop sizes and execution counts K; verify current index = K mod N
    - **Validates: Requirements 7.1, 7.8**

  - [ ]* 15.3 Write property test for source fallback to playlist local
    - **Property 3: Source Fallback to Playlist Local**
    - Generate random slot assignments with random source failures; verify all failures fill with playlist
    - **Validates: Requirements 2.3, 2.4, 3.3, 6.3, 7.3**

  - [~] 15.4 Implement PrefetchManager (background content preparation)
    - While current slot plays, prefetch content for next slot
    - Store prefetched content keyed by source type
    - Replenish fallback buffer after each slot completes
    - _Requirements: 6.1, 6.2_

  - [~] 15.5 Implement slot configuration with source toggle and reassignment
    - Handle disabled sources: reassign their slots to playlist local
    - Preserve total slot count and positions of other sources
    - Support re-enabling a source (restore original config)
    - _Requirements: 7.6, 10.1, 10.2, 10.3_

  - [ ]* 15.6 Write property test for dynamic loop configuration
    - **Property 11: Dynamic Loop Configuration**
    - Generate random valid LoopConfigs; verify engine accepts and executes without source modifications
    - **Validates: Requirements 7.5**

  - [ ]* 15.7 Write property test for source toggle round-trip
    - **Property 13: Source Toggle Round-Trip**
    - Disable then re-enable a source; verify loop config matches original
    - **Validates: Requirements 10.3**

- [~] 16. Checkpoint - Player core loop and content sources
  - Ensure LoopEngine cycles through slots, sources respond correctly, fallback works. Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Player: Duration resolution and schedule manager
  - [~] 17.1 Implement resolveDuration function (hierarchy-based duration resolution)
    - Video: use natural duration always
    - VAST: use VAST XML duration
    - Prodooh API: use API-provided duration if available, else hierarchy
    - Static content: screen override > group override > tenant default
    - _Requirements: 15.4, 15.5, 15.6, 15.7_

  - [ ]* 17.2 Write property test for duration resolution hierarchy
    - **Property 18: Duration Resolution Hierarchy**
    - Generate random content types and config hierarchies; verify most-specific rule wins
    - **Validates: Requirements 15.4, 15.5, 15.6, 15.7**

  - [~] 17.3 Implement ScheduleManager (operating hours enforcement)
    - Evaluate isWithinOperatingHours using timezone-aware schedule rules
    - Support per-day schedules (different hours per day of week)
    - Default to 24/7 if no schedule configured
    - Enter/exit sleep mode at schedule boundaries
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6_

  - [ ]* 17.4 Write property test for schedule evaluation correctness
    - **Property 19: Schedule Evaluation Correctness**
    - Generate random timestamps, timezones, and schedule rules; verify correctness
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.6**

- [ ] 18. Player: Sync layer (playlist sync, heartbeat, playback logger)
  - [~] 18.1 Implement PlaylistSyncManager
    - Poll backend for playlist updates using ETag (304 Not Modified)
    - Download new media assets with checksum validation
    - Implement atomic swap with adoption confirmation
    - Revert to previous version on confirmation failure (Requirement 9.3)
    - _Requirements: 4.4, 9.1, 9.2, 9.3_

  - [ ]* 18.2 Write property test for playlist sync atomicity
    - **Property 15: Playlist Sync Atomicity**
    - Simulate sync operations with random failures; verify final state is always clean
    - **Validates: Requirements 9.3**

  - [~] 18.3 Implement HeartbeatService
    - Send periodic heartbeat with device status (storage, current content, uptime, playlist version)
    - Process pending commands from heartbeat response (screenshot requests)
    - _Requirements: 8.1, 22.1_

  - [~] 18.4 Implement PlaybackLogger (local recording + batch sync)
    - Record every play event with all required fields
    - Persist to SQLite before any network attempt
    - Batch sync to backend periodically
    - Mark entries as synced only after backend acknowledgment
    - _Requirements: 18.1, 18.2, 18.5_

  - [ ]* 18.5 Write property test for playback log completeness
    - **Property 20: Playback Log Completeness**
    - Generate random playback events; verify all required fields are present
    - **Validates: Requirements 18.1**

  - [ ]* 18.6 Write property test for playback log durability
    - **Property 21: Playback Log Durability**
    - Simulate sync failures; verify no log entries are lost
    - **Validates: Requirements 18.5**

- [ ] 19. Player: Display, rendering, and transitions
  - [~] 19.1 Implement FullscreenRenderer with layered display
    - Create primary content layer, transition layer, and fallback layer
    - Implement show() for initial display and transitionTo() for animated swap
    - Implement showFallback() as synchronous instant swap
    - _Requirements: 6.2, 6.3_

  - [~] 19.2 Implement TransitionAnimator (CSS-based transitions)
    - Support cut (instant), fade (opacity), and slide (translateX) transitions
    - Configurable duration (200ms - 2000ms, default 500ms)
    - Ensure no black frames or visual artifacts during transitions
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5_

  - [~] 19.3 Implement media renderers (Image, Video, Webview)
    - ImageRenderer: render images with rotation metadata applied
    - VideoRenderer: HTML5 video with hardware-accelerated decode
    - WebviewRenderer: iframe-based web content with timeout and error handling
    - All renderers support fullscreen display at configured resolution
    - _Requirements: 24.3, 27.4, 28.3, 28.5, 20.2_

- [ ] 20. Player: Storage management and screenshot service
  - [~] 20.1 Implement StorageManager with LRU cleanup
    - Monitor disk usage, report in heartbeat
    - Run LRU cleanup when free space < 20%
    - Never delete active playlist items or fallback buffer content
    - Report critical alert when free space < 10% after cleanup
    - _Requirements: 22.1, 22.2, 22.3, 22.4_

  - [ ]* 20.2 Write property test for LRU cleanup safety
    - **Property 23: LRU Cleanup Safety**
    - Generate random cached files and active playlist sets; verify active items never deleted
    - **Validates: Requirements 22.2, 22.3**

  - [~] 20.3 Implement ScreenshotService
    - Capture current frame on demand using screen capture API
    - Upload JPEG screenshot to backend via multipart POST
    - Handle capture within 30s timeout
    - _Requirements: 17.1, 17.2_

- [~] 21. Checkpoint - Player fully functional
  - Ensure player boots, authenticates, syncs config and playlist, runs loop engine, transitions content, reports heartbeat, handles all sources. Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Player: Kiosk mode and Raspberry Pi deployment setup
  - [~] 22.1 Create kiosk mode systemd service and Cage/Chromium configuration
    - Create systemd service unit for auto-starting player on boot
    - Configure Cage compositor with Chromium in kiosk mode (--kiosk flag)
    - Implement keyboard/mouse blocking in kiosk mode
    - Create watchdog service for auto-restart on crash (< 10s)
    - _Requirements: 14.1, 14.2, 14.4_

  - [~] 22.2 Implement kiosk unlock mechanism
    - Create kiosk password validation (hashed, not plaintext)
    - Implement secure unlock sequence for maintenance access
    - Store password hash securely on device
    - _Requirements: 14.3, 14.5_

  - [~] 22.3 Bundle factory/precargado content with player
    - Include Prodooh branding animation (landscape + portrait)
    - Configure as last-resort fallback when playlist is empty and no connectivity
    - Stop showing in normal rotation once first real playlist is adopted
    - _Requirements: 25.1, 25.2, 25.3, 25.4_

- [ ] 23. Integration wiring and end-to-end flows
  - [~] 23.1 Wire player boot sequence (full startup flow)
    - Load local config → authenticate with backend → fetch config → start loop
    - Handle first-boot scenario (no config yet, show factory content)
    - Graceful degradation if backend unreachable (use cached config)
    - _Requirements: 1.1, 1.4, 4.1, 25.2_

  - [~] 23.2 Wire backend admin panel content preview
    - Implement content preview rendering with screen dimensions and orientation
    - Show resolution, duration, format info, and orientation mismatch warnings
    - Support preview for images, videos, and URLs
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 24.4, 28.7_

  - [~] 23.3 Wire multi-tenant pilot demonstration
    - Create seeder with 2 tenants, each with different configs (one with GAM active, one without)
    - Assign screens to different tenants with distinct playlists
    - Verify complete isolation between tenants
    - _Requirements: 12.4_

  - [ ]* 23.4 Write integration tests for player ↔ backend communication
    - Test auth flow, config sync, heartbeat, playlist sync, playback log batch
    - Test offline behavior (queue accumulation, eventual delivery)
    - _Requirements: 1.2, 8.1, 9.2, 18.2_

- [ ] 24. Deployment scripts and documentation
  - [~] 24.1 Create Raspberry Pi provisioning script
    - Install Cage, Chromium, and dependencies
    - Deploy player bundle to device
    - Configure systemd services (player + watchdog)
    - Set up initial device config (venue_id, device_token, backend URL)
    - _Requirements: 14.1, 14.4, 25.5_

  - [~] 24.2 Create backend local development setup script
    - docker-compose for PostgreSQL
    - Laravel migration + seeder runner
    - Create initial super-admin credentials
    - _Requirements: 13.2_

- [~] 25. Final checkpoint - Full system operational
  - Ensure all tests pass (Vitest + fast-check for player, PHPUnit + Eris for backend), both apps can deploy independently, multi-tenant pilot scenario works end-to-end. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Backend uses PHP 8.4 with Laravel 11, PHPUnit + Eris for property-based testing
- Player uses TypeScript with Vitest (`--run` flag) + fast-check for property-based testing
- The `/contracts` directory holds shared API type definitions (copied, not imported) to maintain deployment independence
- All 23 correctness properties from the design document are covered by property test tasks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "12.1"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "5.1", "11.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.4", "6.1", "11.2", "11.3", "11.4"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.1", "12.2", "12.3"] },
    { "id": 7, "tasks": ["6.4", "7.2", "7.3", "7.4", "12.4", "13.1"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "13.2", "13.3"] },
    { "id": 9, "tasks": ["9.1", "9.2", "13.4", "14.1", "14.2"] },
    { "id": 10, "tasks": ["14.3", "14.4", "15.1"] },
    { "id": 11, "tasks": ["15.2", "15.3", "15.4", "15.5"] },
    { "id": 12, "tasks": ["15.6", "15.7", "17.1", "17.3"] },
    { "id": 13, "tasks": ["17.2", "17.4", "18.1", "18.3", "18.4"] },
    { "id": 14, "tasks": ["18.2", "18.5", "18.6", "19.1", "19.2", "19.3"] },
    { "id": 15, "tasks": ["20.1", "20.2", "20.3"] },
    { "id": 16, "tasks": ["22.1", "22.2", "22.3"] },
    { "id": 17, "tasks": ["23.1", "23.2", "23.3", "23.4"] },
    { "id": 18, "tasks": ["24.1", "24.2"] }
  ]
}
```
