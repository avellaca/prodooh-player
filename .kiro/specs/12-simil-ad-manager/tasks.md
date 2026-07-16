# Implementation Plan: Loop Template (Ad Manager v3)

## Overview

Migration from flat manifest (5,760 positions/day) to Loop Template model. The implementation is organized in phases: database migrations first, then backend core services, API endpoints, contracts, player refactor, and frontend modules. Each phase builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Database migrations and model updates
  - [x] 1.1 Create migration to add loop config columns to tenants table
    - Add `num_slots` (unsignedSmallInteger, default 10), `ssp_slots` (default 2), `playlist_slots` (default 1), `sync_interval_seconds` (default 240), `cache_flush_interval_hours` (default 24) to `tenants` table
    - Update `Tenant` model `$fillable` array to include new fields
    - _Requirements: 1.1, 1.2, 1.3, 8.1, 8.2_

  - [x] 1.2 Create migration to add num_slots override to screen_groups and screens
    - Add nullable `num_slots` (unsignedSmallInteger) to `screen_groups` table
    - Add nullable `num_slots` (unsignedSmallInteger) to `screens` table
    - Update `ScreenGroup` and `Screen` models `$fillable` arrays
    - _Requirements: 1.6_

  - [x] 1.3 Create migration to add slots_purchased and by_slot to order_lines
    - Add nullable `slots_purchased` (unsignedSmallInteger) and `by_slot` (boolean, default false) to `order_lines` table
    - Update `OrderLine` model `$fillable` and `$casts`
    - _Requirements: 4.5_

  - [x] 1.4 Create migration to drop starts_at and ends_at from orders table
    - Drop columns `starts_at` and `ends_at` from `orders`
    - Add computed accessors `starts_at` and `ends_at` to `Order` model (MIN/MAX from order_lines)
    - Update `Order` model to set default status `draft` on creation
    - _Requirements: 5.1, 5.2, 5.5_

  - [x] 1.5 Create migration to add is_active to users and support trafficker role
    - Add `is_active` (boolean, default true) to `users`
    - Update User model to include trafficker role support
    - _Requirements: 9.1_

  - [x] 1.6 Create migration for audit_logs table
    - Create `audit_logs` table with: uuid id, auditable_type, auditable_id, user_id (nullable FK), event_type, diff (jsonb nullable), created_at
    - Add indexes on (auditable_type, auditable_id), user_id, created_at
    - Create `AuditLog` model with fillable fields and relationships
    - _Requirements: 11.1, 11.2, 11.6_

  - [x] 1.7 Create migration for user_invitations table
    - Create `user_invitations` table with: uuid id, tenant_id (FK), email, role, token (unique, 64 chars), expires_at, accepted_at (nullable), created_at
    - Create `UserInvitation` model
    - _Requirements: 10.1_

  - [x] 1.8 Create migration for password_resets table
    - Create `password_resets` table with: uuid id, user_id (FK), token (unique, 64 chars), expires_at, used_at (nullable), created_at
    - Create `PasswordReset` model
    - _Requirements: 10.6_

- [x] 2. Checkpoint - Run migrations and verify schema
  - Ensure all migrations run without errors, ask the user if questions arise.

- [x] 3. Backend core services — Loop Template generation
  - [x] 3.1 Implement LoopConfigValidator service
    - Create `App\Services\LoopConfigValidator` with validation rules: num_slots [1,100], ssp_slots [0,num_slots], playlist_slots [0,num_slots], sync_interval_seconds [30,900], cache_flush_interval_hours [1,720]
    - Validate constraint: ssp_slots + playlist_slots < num_slots (at least 1 ad_slot)
    - Calculate and return ad_slots = num_slots - ssp_slots - playlist_slots
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2_

  - [x] 3.2 Write property tests for LoopConfigValidator (Properties 1, 2)
    - **Property 1: Validation of range for loop config fields**
    - **Property 2: ad_slots invariant and minimum constraint**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2**

  - [x] 3.3 Implement resolveNumSlots helper in LoopTemplateGenerator
    - Create `App\Services\LoopTemplateGenerator` implementing `LoopTemplateGeneratorInterface`
    - Implement `resolveNumSlots(Screen): int` — hierarchy: Screen.num_slots → ScreenGroup.num_slots → Tenant.num_slots → 10
    - _Requirements: 1.6, 2.1_

  - [x] 3.4 Write property test for num_slots inheritance (Property 3)
    - **Property 3: Herencia de num_slots por jerarquía**
    - **Validates: Requirements 1.6**

  - [x] 3.5 Implement SlotAllocator service
    - Create `App\Services\SlotAllocator` implementing `SlotAllocatorInterface`
    - Implement waterfall allocation: Patrocinio (fixed slots_purchased) → Estandar ASAP → Estandar Uniform → Red_Interna
    - Patrocinio lines get N guaranteed fixed positions; reject activation if sum exceeds ad_slots
    - When more lines than available slots in a tier, assign multiple candidates per slot with round_robin strategy
    - Red_Interna fills remaining slots distributed by share_weight
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.9, 2.10_

  - [x] 3.6 Write property tests for SlotAllocator (Properties 6, 7, 9)
    - **Property 6: Waterfall allocation with strict priority**
    - **Property 7: Round-robin when tier is over-subscribed**
    - **Property 9: Red_Interna proportional distribution by share_weight**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.9, 2.10**

  - [x] 3.7 Implement RotationScheduler service
    - Create `App\Services\RotationScheduler` implementing `RotationSchedulerInterface`
    - Implement ASAP:Uniform ratio: 1:2 when total active creatives ≤10, 1:3 when >10
    - If only ASAP lines (no Uniform), distribute by share_weight without ratio
    - Implement `distributeByWeight` for Red_Interna proportional allocation
    - _Requirements: 2.6, 2.7, 2.15_

  - [x] 3.8 Write property test for RotationScheduler (Property 8)
    - **Property 8: Ratio ASAP:Uniform rotation**
    - **Validates: Requirements 2.6, 2.7, 2.15**

  - [x] 3.9 Complete LoopTemplateGenerator.generate() orchestration
    - Resolve num_slots, ssp_slots, playlist_slots by hierarchy
    - Calculate loops_per_day = operating_window_seconds / (num_slots × slot_duration_seconds)
    - Call SlotAllocator to assign ad_slots
    - Call RotationScheduler for rotation order
    - Build Loop Template JSON: slots array with positions in predictable ranges (ad → ssp → playlist)
    - Compute version as SHA-256 hash of serialized template content
    - Upsert into screen_manifests table
    - _Requirements: 2.1, 2.8, 2.12, 2.13_

  - [x] 3.10 Write property tests for LoopTemplateGenerator (Properties 5, 10)
    - **Property 5: Structural invariant of Loop Template (exact num_slots, correct type ranges)**
    - **Property 10: Hash version integrity**
    - **Validates: Requirements 2.1, 2.8, 2.12, 2.13**

  - [x] 3.11 Implement regenerateAffected() for event-driven template updates
    - When a line is activated, deactivated, or modified, regenerate templates for all affected screens
    - Use queue dispatch for batch processing; must complete within 30 seconds
    - Generate empty Loop Template when no active content exists for a screen
    - _Requirements: 2.11, 2.14_

- [x] 4. Backend core services — Order lifecycle and auxiliary
  - [x] 4.1 Implement pace enforcement logic on OrderLine save
    - In OrderLine observer or Form Request: force delivery_pace to "uniform" when priority_tier is "patrocinio" or "red_interna"
    - Allow "asap" or "uniform" only for priority_tier "estandar"
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 4.2 Write property test for pace enforcement (Property 11)
    - **Property 11: Pace forced by tier**
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [x] 4.3 Implement "Por Slot" target_spots calculation for Patrocinio
    - When by_slot=true and slots_purchased=N, calculate target_spots = N × loops_per_day
    - Store both slots_purchased and calculated target_spots
    - Keep target_spots fixed after creation (no recalculation on num_slots change)
    - _Requirements: 4.3, 4.5, 4.6_

  - [x] 4.4 Write property test for target_spots calculation (Property 12)
    - **Property 12: target_spots = N × loops_per_day**
    - **Validates: Requirements 4.3**

  - [x] 4.5 Implement AvailabilityAnalyzer service
    - Create `App\Services\AvailabilityAnalyzer` implementing `AvailabilityAnalyzerInterface`
    - Calculate: target_spots vs (loops_per_day × assignable_slots) considering other active lines on same screens
    - Return `AvailabilityResult` with isSufficient, targetSpots, availableCapacity, saturationPercent, warningMessage
    - Execute only at activation time, not during draft editing
    - _Requirements: 6.1, 6.5, 6.6_

  - [x] 4.6 Write property test for availability calculation (Property 15)
    - **Property 15: Availability inventory calculation**
    - **Validates: Requirements 6.1**

  - [x] 4.7 Implement Order activation validation
    - Reject activation if order has no OrderLine with at least 1 Creative assigned
    - Return descriptive error message
    - _Requirements: 5.6_

  - [x] 4.8 Write unit test for activation rejection without creative (Property 14)
    - **Property 14: Rejection of activation without creative**
    - **Validates: Requirements 5.6**

  - [x] 4.9 Implement AuditService
    - Create `App\Services\AuditService` implementing `AuditServiceInterface`
    - Log events: created, field_modified, status_changed, creative_added, creative_removed, spots_modified, name_changed, target_added, target_removed
    - Store diff with old_value/new_value for field_modified events
    - Record user_id and created_at for each entry
    - Integrate via model observers on Order, OrderLine, Creative, OrderLineTarget
    - _Requirements: 11.1, 11.2, 11.3, 11.6_

  - [x] 4.10 Write property test for audit completeness (Property 20)
    - **Property 20: Audit log completeness**
    - **Validates: Requirements 11.1, 11.3, 11.6**

  - [x] 4.11 Implement UserInvitationService
    - Create `App\Services\UserInvitationService` implementing `UserInvitationServiceInterface`
    - Send invitation email via Resend with 48h token
    - Reject registration with expired token
    - Complete registration: hash password with bcrypt, activate account
    - Implement password reset flow: send email with 1h token, complete reset
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [x] 4.12 Write unit tests for UserInvitationService
    - Test expired invitation token rejection
    - Test successful registration with valid token
    - Test expired reset token rejection
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

- [x] 5. Checkpoint - Verify backend services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Backend API endpoints and authorization
  - [x] 6.1 Implement Trafficker role authorization middleware
    - Create policy/middleware to enforce trafficker permissions: CRUD on orders, order_lines, creatives only
    - Deny activation (HTTP 403), configuration access (HTTP 403), user management (HTTP 403)
    - Ensure super_admin has full access, tenant_admin has full access within own tenant
    - Validate permissions at endpoint level regardless of frontend visibility
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 12.1, 12.2, 12.3, 12.4, 12.6_

  - [x] 6.2 Write property test for permission matrix (Property 19)
    - **Property 19: Permission matrix by role and tenant**
    - **Validates: Requirements 9.1, 12.2**

  - [x] 6.3 Implement loop config API endpoints
    - `PUT /api/admin/tenants/{id}/loop-config` — update num_slots, ssp_slots, playlist_slots (tenant_admin/super_admin only)
    - `PUT /api/admin/tenants/{id}/network-settings` — update sync_interval_seconds, cache_flush_interval_hours
    - `POST /api/admin/tenants/{id}/loop-config/propagate` — propagate num_slots to descendants without explicit override
    - Use LoopConfigValidator for all validation
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.8, 1.9, 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 6.4 Write property test for selective propagation (Property 4)
    - **Property 4: Selective propagation of num_slots**
    - **Validates: Requirements 1.8**

  - [x] 6.5 Modify Order endpoints for dynamic dates
    - `POST /api/admin/orders` — remove starts_at, ends_at from request body; auto-assign status "draft"
    - `GET /api/admin/orders/{id}` — compute starts_at/ends_at dynamically from order_lines
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 6.6 Write property test for derived order dates (Property 13)
    - **Property 13: Order dates derived from order lines**
    - **Validates: Requirements 5.2**

  - [x] 6.7 Modify OrderLine endpoints for patrocinio and activation
    - `PUT /api/admin/order-lines/{id}` — accept slots_purchased, by_slot for patrocinio tier
    - `PATCH /api/admin/order-lines/{id}/activate` — run AvailabilityAnalyzer; return availability result
    - `GET /api/admin/order-lines/{id}/availability` — return availability check result
    - On activation, trigger LoopTemplateGenerator.regenerateAffected()
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.5, 6.6_

  - [x] 6.8 Implement audit log API endpoint
    - `GET /api/admin/{auditableType}/{id}/audit-logs` — return paginated audit history for an entity
    - _Requirements: 11.1, 11.4_

  - [x] 6.9 Implement user management and auth API endpoints
    - `POST /api/admin/users/invite` — send invitation (tenant_admin manages own tenant, super_admin manages all)
    - `POST /api/auth/register` — complete registration with token
    - `POST /api/auth/forgot-password` — request password reset
    - `POST /api/auth/reset-password` — complete password reset
    - Enforce tenant_admin can only invite within own tenant; super_admin can manage all
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 6.10 Modify device manifest endpoint for Loop Template format
    - `GET /api/device/manifest` — return Loop Template JSON with ETag/If-None-Match support (HTTP 304)
    - Include sync_interval_seconds and cache_flush_interval_hours in response
    - _Requirements: 7.1, 7.2, 8.5_

- [x] 7. Checkpoint - Verify API endpoints
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Contracts — Shared TypeScript interfaces
  - [x] 8.1 Create Loop Template TypeScript contracts
    - Create `contracts/src/loop-template.ts` with interfaces: LoopTemplateResponse, LoopConfig, LoopSlotContract, CandidateContract
    - Include all types: 'ad' | 'ssp' | 'playlist', strategies: 'fixed' | 'round_robin'
    - Export from contracts index
    - _Requirements: 2.12, 7.3_

  - [x] 8.2 Update auth contracts for trafficker role
    - Update `AuthUser` type in contracts to include 'trafficker' in role union
    - _Requirements: 9.1_

- [x] 9. Player refactor — LoopEngine and sync updates
  - [x] 9.1 Implement LoopEngine class
    - Create `player/src/engine/LoopEngine.ts` implementing the LoopEngine interface from design
    - Continuous loop: slot[0] → slot[N-1] → slot[0]
    - Round-robin candidate selection: for 'fixed' strategy always candidates[0]; for 'round_robin' use (iteration mod N)
    - Atomic template swap via `updateTemplate()` — applies at start of next loop iteration
    - Track rotation offsets per slot position
    - SSP slot handling: delegate to SspPrefetcher; fallback to first playlist_item on no-fill
    - _Requirements: 7.8, 7.9, 7.10, 7.11, 7.12_

  - [x] 9.2 Write property test for round-robin selection in LoopEngine (Property 18)
    - **Property 18: Sequential round-robin rotation in player**
    - Use fast-check to generate slots with N candidates and M iterations
    - **Validates: Requirements 7.12**

  - [x] 9.3 Update SspPrefetcher for slot-based timing
    - Modify prefetch timing: start prefetch at the beginning of the slot preceding SSP (full slot_duration_seconds available)
    - Maintain existing ProDoohSource integration with print_id for proof-of-play
    - Deduplicate cache by exact asset URL
    - _Requirements: 7.8, 7.10_

  - [x] 9.4 Update ManifestSyncManager for Loop Template format
    - Parse new Loop Template JSON format from `/api/device/manifest`
    - Support ETag/If-None-Match for HTTP 304 (no change detection)
    - On new version: diff assets by checksum_sha256, download only new assets
    - On download failure: keep previous template, retry on next sync cycle
    - Mark removed assets as eligible for LRU cleanup (don't delete immediately)
    - Protect active template assets from LRU cleanup
    - Use sync_interval_seconds from template response for polling interval
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.11_

  - [x] 9.5 Write property test for differential asset download (Property 16)
    - **Property 16: Differential asset download by checksum**
    - **Validates: Requirements 7.4**

  - [x] 9.6 Write property test for LRU protection of active assets (Property 17)
    - **Property 17: Active assets protected from LRU cleanup**
    - **Validates: Requirements 7.7**

  - [x] 9.7 Wire LoopEngine into player main entry point
    - Replace ManifestEngine instantiation with LoopEngine
    - Connect ManifestSyncManager → LoopEngine.updateTemplate() on new version
    - Connect LoopEngine callbacks to impression reporter
    - Ensure graceful degradation: if backend unreachable, continue with local template
    - _Requirements: 7.1, 7.11_

- [x] 10. Checkpoint - Verify player refactor
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Frontend — Settings, User Management, and Audit modules
  - [x] 11.1 Create Loop Config settings panel component
    - Create `admin-frontend/src/features/settings/LoopConfigPanel.tsx`
    - Form fields: num_slots, ssp_slots, playlist_slots with validation (Zod schema)
    - Show computed ad_slots = num_slots - ssp_slots - playlist_slots live
    - "Aplicar a todos" button with confirmation modal showing affected count
    - Use existing duration_seconds field (no new field for slot duration)
    - _Requirements: 1.7, 1.10, 8.3_

  - [x] 11.2 Create Network Settings panel component
    - Create `admin-frontend/src/features/settings/NetworkSettingsPanel.tsx`
    - Form fields: sync_interval_seconds, cache_flush_interval_hours with Zod validation
    - TanStack Query mutation for PUT /api/admin/tenants/{id}/network-settings
    - _Requirements: 8.3_

  - [x] 11.3 Modify OrderLine form for pace and patrocinio slot toggle
    - Disable delivery_pace field (show "uniform") when priority_tier is "patrocinio" or "red_interna"
    - Enable delivery_pace (asap/uniform) when priority_tier is "estandar"
    - Show "Por Slot" toggle only for patrocinio tier
    - When toggle on: show numeric "Slots" field [1..ad_slots]; compute target_spots display
    - When toggle off: show target_spots input for manual entry
    - _Requirements: 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4_

  - [x] 11.4 Modify Order creation form for dynamic dates
    - Remove starts_at and ends_at fields from order creation form
    - Remove status field from creation form
    - Show only: name, advertiser_name
    - Display computed dates (read-only) in order detail view
    - _Requirements: 5.3, 5.4_

  - [x] 11.5 Implement availability alert modal on OrderLine activation
    - When activating an OrderLine, call availability endpoint
    - If insufficient: show modal with saturation info and options "Estoy de acuerdo" / "Modificar"
    - "Estoy de acuerdo" → proceed with activation
    - "Modificar" → return to edit form
    - If sufficient: activate directly without modal
    - _Requirements: 6.2, 6.3, 6.4, 6.6_

  - [x] 11.6 Create AuditLogModal component
    - Create `admin-frontend/src/features/audit/AuditLogModal.tsx`
    - Clock icon on each auditable entity (Order, OrderLine, Creative)
    - Modal shows chronological history of changes
    - Color badges: green (created, creative_added, target_added), yellow (field_modified, spots_modified, name_changed, status_changed), red (creative_removed, target_removed)
    - _Requirements: 11.4, 11.5_

  - [x] 11.7 Create User Management module
    - Create `admin-frontend/src/features/users/` with components for: user list, invite form, role display
    - Invite form: email, role selection (tenant_admin, trafficker)
    - List: show users in tenant with role and is_active status
    - super_admin sees all tenants' users; tenant_admin sees only own tenant
    - _Requirements: 10.1, 10.4, 10.5_

  - [x] 11.8 Implement Forgot Password and Registration pages
    - Add "¿Olvidaste tu contraseña?" link on login page
    - Create forgot-password page: email input → POST /api/auth/forgot-password
    - Create reset-password page: new password input → POST /api/auth/reset-password
    - Create registration page: accept invitation token → POST /api/auth/register
    - _Requirements: 10.3, 10.6, 10.7_

  - [x] 11.9 Implement role-based UI visibility for trafficker
    - Update AuthUser type to include 'trafficker'
    - Hide settings, activation buttons, and user management sections for trafficker role
    - Show only: Orders, Order Lines, Creatives sections
    - Update RoleGuard component and navigation
    - _Requirements: 9.5, 9.6, 12.5_

- [x] 12. Checkpoint - Verify frontend modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Integration wiring and final verification
  - [x] 13.1 Wire LoopTemplateGenerator triggers to OrderLine lifecycle events
    - On OrderLine activate/deactivate/modify: dispatch regeneration job for affected screens
    - On creative added/removed: trigger regeneration
    - Ensure regeneration completes within 30 seconds (use queue for batch)
    - _Requirements: 2.11_

  - [x] 13.2 Wire AuditService observers to all auditable models
    - Ensure Order, OrderLine, Creative, OrderLineTarget model changes trigger audit_log creation
    - Verify diff captures old_value/new_value correctly
    - _Requirements: 11.1, 11.3, 11.6_

  - [x] 13.3 Write integration tests for end-to-end flows
    - Test: activation flow with availability check
    - Test: loop template generation from order creation to player consumption
    - Test: user invitation → registration → login flow
    - Test: num_slots propagation across hierarchy
    - _Requirements: 2.11, 6.1, 10.1, 1.8_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Backend uses PHP (Laravel 11 / Pest), Player uses TypeScript (Vitest + fast-check), Frontend uses TypeScript (Vitest + Testing Library)
- The existing PriorityEngine and ManifestEngine are kept as reference; new services replace their functionality
- Database migrations must run before any service implementation
- Contracts can be developed in parallel with backend services

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] },
    { "id": 1, "tasks": ["3.1", "3.3", "8.1", "8.2"] },
    { "id": 2, "tasks": ["3.2", "3.4", "3.5", "3.7", "4.1", "4.9"] },
    { "id": 3, "tasks": ["3.6", "3.8", "3.9", "4.2", "4.3", "4.7", "4.11"] },
    { "id": 4, "tasks": ["3.10", "3.11", "4.4", "4.5", "4.8", "4.10", "4.12"] },
    { "id": 5, "tasks": ["4.6", "6.1", "6.3", "6.5"] },
    { "id": 6, "tasks": ["6.2", "6.4", "6.6", "6.7", "6.8", "6.9", "6.10"] },
    { "id": 7, "tasks": ["9.1", "9.3", "9.4"] },
    { "id": 8, "tasks": ["9.2", "9.5", "9.6", "9.7"] },
    { "id": 9, "tasks": ["11.1", "11.2", "11.3", "11.4", "11.5", "11.6", "11.7", "11.8", "11.9"] },
    { "id": 10, "tasks": ["13.1", "13.2"] },
    { "id": 11, "tasks": ["13.3"] }
  ]
}
```
