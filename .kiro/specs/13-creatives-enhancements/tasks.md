# Implementation Plan: Creative Assignment UX Enhancements

## Overview

Este plan implementa las mejoras de asignación de creativos en orden de dependencia: primero las migraciones y modelos base, luego los controladores backend, después la integración frontend, y finalmente los cambios en el player. Cada tarea entrega valor end-to-end cuando es posible.

## Tasks

- [x] 1. Database migrations and model updates
  - [x] 1.1 Create tags and content_tags migrations + Tag model
    - Create migration `create_tags_table` with columns: id (uuid PK), tenant_id (uuid FK), name (varchar 100), created_at. Unique index on (tenant_id, name)
    - Create migration `create_content_tags_table` with columns: content_id (uuid FK ON DELETE CASCADE), tag_id (uuid FK ON DELETE CASCADE). Composite PK (content_id, tag_id)
    - Create `Tag` model with HasUuids, BelongsToTenant, HasFactory traits. Add `contents()` belongsToMany relation
    - Add `tags()` belongsToMany relation to existing `Content` model
    - _Requirements: 1.2, 1.5, 2.1_

  - [x] 1.2 Create tracking_pixels migration + TrackingPixel model
    - Create migration `create_tracking_pixels_table` with columns: id (uuid PK), trackable_type (varchar 50 NOT NULL), trackable_id (uuid NOT NULL), url (varchar 2048 NOT NULL), trigger_type (varchar 20 NOT NULL CHECK IN play/impression), multiplier (integer NOT NULL DEFAULT 1 CHECK >= 1), created_at, updated_at. Index on (trackable_type, trackable_id)
    - Create `TrackingPixel` model with HasUuids, HasFactory. Define `trackable()` morphTo relation
    - Add `trackingPixels()` morphMany relation to `Order`, `OrderLine`, and `Creative` models
    - _Requirements: 13.1, 14.1, 15.1_

  - [x] 1.3 Add playback_mode and position columns
    - Create migration `add_playback_mode_to_order_lines`: add playback_mode varchar(20) DEFAULT 'round_robin' with CHECK constraint
    - Create migration `add_playback_mode_override_to_order_line_targets`: add playback_mode_override varchar(20) nullable with CHECK constraint
    - Create migration `add_position_to_creatives`: add position integer nullable. Index on (order_line_target_id, position)
    - Update `OrderLine` model: add 'playback_mode' to $fillable
    - Update `OrderLineTarget` model: add 'playback_mode_override' to $fillable
    - Update `Creative` model: add 'position' to $fillable
    - _Requirements: 7.1, 7.2, 8.1, 9.1, 9.3_

- [x] 2. Tags system — Backend CRUD + Frontend integration
  - [x] 2.1 Implement TagController with routes
    - Create `TagController` in `App\Http\Controllers\Admin` with: index (list tenant tags), store (create tag), update (rename), destroy (delete)
    - Create `ContentTagController` or add methods to TagController for: assignToContent (POST /content/{id}/tags), removeFromContent (DELETE /content/{id}/tags/{tagId})
    - Register routes in `routes/api.php` under `authorize:config` middleware group
    - Add FormRequest validation for tag name (required, max:100, unique per tenant)
    - _Requirements: 1.2, 1.5, 2.1_

  - [x] 2.2 Implement frontend Tags management in Biblioteca (ContentPage)
    - Create `tagsApi` functions in `features/content/api.ts` (list, create, assignToContent, removeFromContent)
    - Create TanStack Query hooks: `useTags`, `useCreateTag`, `useAssignTags`
    - Create `TagManager` component (badge list + add/remove) rendered in ContentPage for each content item
    - Create `BulkTagAssign` component for the bulk upload flow
    - Wire into ContentPage — tags visible on content cards, editable on click
    - _Requirements: 1.2, 1.5, 18.2_

  - [x] 2.3 Write property test for tag assignment in bulk upload
    - **Property 17: Tag assignment en carga masiva**
    - **Validates: Requirements 1.2**

- [x] 3. Bulk upload enhancements — Backend + Frontend
  - [x] 3.1 Implement bulk upload endpoint with tags
    - Modify `ContentController@store` to accept up to 50 files per batch with optional `tag_ids[]` parameter
    - After successful upload, associate provided tags via content_tags pivot
    - Return 207 Multi-Status with successes/failures arrays for partial failures
    - Extract and persist metadata: width, height, duration_seconds (video), file_size, mime_type, checksum_sha256
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.2 Implement BulkUploadDialog in ContentPage
    - Create `BulkUploadDialog` component in `features/content/components/`
    - Multi-file picker (max 50), tag selector, progress indicators per file
    - Show summary on completion (successful, failed with reasons)
    - Render dialog trigger button in ContentPage header area
    - API client + TanStack mutation hook for bulk upload
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.3 Write property test for batch resilience
    - **Property 16: Resiliencia de lotes — fallo parcial no afecta éxitos**
    - **Validates: Requirements 1.4**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Bulk assign with auto-matching — Backend + Frontend
  - [x] 5.1 Implement BulkCreativeController bulk-assign endpoint
    - Create or modify `BulkCreativeController` to add `bulkAssign` method at POST `/order-lines/{id}/creatives/bulk-assign`
    - Accept `{ content_ids: uuid[], weight: number }` in request body
    - Implement auto-matching logic: resolve all screens from targets → build resolution map → match content dimensions → create individual Creative per matching screen
    - Return summary: `{ created, unmatched_contents: [{id, width, height}], covered_screens }`
    - Register route in `routes/api.php` under `authorize:order_lines` middleware
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4_

  - [x] 5.2 Implement enhanced LibrarySelectorModal with auto-matching flow
    - Create `LibrarySelectorModal` in `features/orders/components/` with: thumbnail grid, search by tags/name/dimensions, metadata display (dimensions, duration, size, upload date), "Ya asignado" indicator
    - Create `bulkAssignApi` in `features/orders/api.ts`
    - Create `useBulkAssign` TanStack mutation hook
    - Multi-select content → call bulk-assign → show summary dialog with results
    - Render modal trigger in OrderLineDetailPage creative section
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 18.1, 18.2, 18.3, 18.4_

  - [x] 5.3 Write property test for auto-matching
    - **Property 1: Auto-matching produce creativos individuales por pantalla con resolución coincidente**
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 11.1**

  - [x] 5.4 Write property test for library search filtering
    - **Property 10: Búsqueda en biblioteca filtra por tags, nombre y dimensiones**
    - **Validates: Requirements 2.1, 18.2**

- [x] 6. Tabbed creative views — Frontend
  - [x] 6.1 Implement TabbedCreativeView with By Resolution tab (default)
    - Create `TabbedCreativeView` container component in `features/orders/components/` with 3 tabs: "Por Resolución", "Por Grupo", "Por Pantalla"
    - Extract/refactor existing resolution-based view as `ByResolutionTab` component
    - "Por Resolución" is the default active tab
    - Render `TabbedCreativeView` in `OrderLineDetailPage` replacing the current creative section
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 6.2 Implement ByGroupTab
    - Create `ByGroupTab` component in `features/orders/components/`
    - Fetch screens and group by ScreenGroup. Show "Sin grupo" section for ungrouped screens
    - Show creative cards per group with add/remove/reorder controls
    - Operations at group level apply to individual screen Creatives
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.3 Implement ByScreenTab with sort and search
    - Create `ByScreenTab` component in `features/orders/components/`
    - Flat list of all screens with their creatives. Paginate/virtualize if >20 screens
    - Sort controls: by name (alphabetical), by resolution (WxH)
    - Inline search field filtering screens by name in real-time
    - Full creative management per screen (add, remove, reorder)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.4 Write property tests for screen grouping and sorting
    - **Property 11: Agrupación de pantallas por resolución**
    - **Property 12: Agrupación de pantallas por ScreenGroup**
    - **Property 19: Ordenamiento de pantallas**
    - **Property 20: Filtro de pantallas por nombre**
    - **Validates: Requirements 4.2, 5.1, 5.2, 6.4, 6.5**

- [x] 7. Playback mode — Backend + Frontend
  - [x] 7.1 Implement playback mode in OrderLine and OrderLineTarget controllers
    - Modify `OrderLineController@update` to accept and validate `playback_mode` field ('round_robin' | 'sequential')
    - Modify `OrderLineTargetController` (or add update method) to accept `playback_mode_override` field (nullable)
    - Implement `resolveEffectivePlaybackMode` helper: override ?? orderLine.playback_mode ?? 'round_robin'
    - Include playback_mode in OrderLine show/index JSON responses
    - Include playback_mode_override in OrderLineTarget responses
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3_

  - [x] 7.2 Implement PlaybackModeSelector in OrderLineDetailPage
    - Create `PlaybackModeSelector` component in `features/orders/components/`
    - Dropdown/radio: round_robin / sequential, calls PUT /order-lines/{id} with playback_mode
    - Display per-screen override option in ByScreenTab
    - Conditionally show drag & drop UI when sequential, hide when round_robin
    - Conditionally show/hide weight editor based on mode
    - Wire into OrderLineDetailPage
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 9.4, 12.5_

  - [x] 7.3 Write property test for playback mode resolution
    - **Property 2: Resolución del modo de reproducción efectivo**
    - **Validates: Requirements 7.1, 8.1, 8.2, 8.3**

- [x] 8. Drag & drop sequential ordering — Backend + Frontend
  - [x] 8.1 Implement reorder endpoint in CreativeController
    - Add `reorder` method: POST `/order-line-targets/{targetId}/creatives/reorder` accepting `{ creative_ids: uuid[] }`
    - Update position = index for each creative in the provided order (0, 1, 2, ..., N-1)
    - On new creative creation in sequential mode, assign position = max(existing_positions) + 1
    - Register route in `routes/api.php`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 8.2 Implement DragDropCreativeList frontend component
    - Create `DragDropCreativeList` in `features/orders/components/` using @dnd-kit/core or similar
    - Show position indicators, drag handles
    - On drop: call reorder API, optimistic update
    - Create `useReorderCreatives` TanStack mutation hook + `creativesApi.reorder` in api.ts
    - Render conditionally in creative card lists when mode is 'sequential'
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 8.3 Write property tests for reorder and new creative position
    - **Property 4: Reordenamiento produce posiciones contiguas**
    - **Property 5: Nuevo creativo en modo secuencial obtiene posición final**
    - **Validates: Requirements 9.2, 9.3**

- [x] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Manifest sequential mode — Backend (LoopTemplateGenerator)
  - [x] 10.1 Modify LoopTemplateGenerator for sequential strategy
    - In `enrichAdCandidates` method: when effective playback_mode is 'sequential', order creatives by position ASC (nulls last)
    - Set slot strategy to 'sequential' instead of 'round_robin' in generated manifest JSON
    - Include all candidates in order (no weight-based selection)
    - Ensure existing round_robin behavior unchanged when mode is round_robin
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 10.2 Write property test for manifest sequential ordering
    - **Property 3: Manifest secuencial ordena candidatos por position**
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [x] 11. Player sequential strategy — TypeScript LoopEngine
  - [x] 11.1 Implement sequential strategy in LoopEngine
    - Update `LoopSlot` interface to include `'sequential'` in strategy union type
    - Modify `selectCandidate` method: when strategy === 'sequential', play candidates in array order (index 0, 1, 2... cycling back to 0)
    - Add fallback: unknown strategy → use round_robin behavior
    - Ensure existing fixed and round_robin strategies unchanged
    - Build player successfully (`npm run build` in player directory)
    - _Requirements: 10.1, 10.2_

  - [x] 11.2 Write unit tests for LoopEngine sequential strategy
    - Test sequential plays candidates in order
    - Test sequential cycles back to start after last candidate
    - Test unknown strategy falls back to round_robin
    - Test existing round_robin and fixed behaviors unchanged
    - _Requirements: 10.1, 10.2_

- [x] 12. Creative explosion (group → screen) — Migration command
  - [x] 12.1 Implement MigrateGroupCreativesCommand
    - Create Artisan command `creatives:migrate-groups` with `--dry-run` option
    - Logic: find all Creatives linked to OrderLineTargets with screen_group_id → for each, resolve group screens → create individual Creative per screen (copy content_id, weight, resolution_width, resolution_height) → delete original group Creative
    - Fix null resolution_width/height by copying from associated Content
    - Log progress and errors. Continue on individual failures
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 11.3_

  - [x] 12.2 Write property tests for migration
    - **Property 14: Migración de grupo explota a pantallas individuales**
    - **Property 15: Migración corrige dimensiones null desde Content**
    - **Validates: Requirements 21.2, 21.3, 11.3, 21.5**

- [x] 13. Inline weight editing — Frontend
  - [x] 13.1 Implement InlineWeightEditor component
    - Create `InlineWeightEditor` in `features/orders/components/`
    - Display weight value on creative card. Click to edit inline (numeric input)
    - Confirm on Enter/blur → call PUT /creatives/{id} with new weight
    - Validate: reject < 1, non-numeric. Show inline error message
    - Hide when playback_mode is 'sequential'
    - Create `useUpdateCreative` TanStack mutation hook
    - Integrate into creative cards within ResolutionGroupCard and other tabs
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 13.2 Write property test for weight validation
    - **Property 18: Validación de peso rechaza valores inválidos**
    - **Validates: Requirements 12.4**

- [x] 14. Tracking pixels — Backend + Frontend
  - [x] 14.1 Implement TrackingPixelController with polymorphic routes
    - Create `TrackingPixelController` with: index, store, update, destroy
    - Routes: GET/POST `/admin/{trackableType}/{id}/tracking-pixels`, PUT/DELETE `/admin/tracking-pixels/{id}`
    - Validate trackableType in ['orders', 'order-lines', 'creatives']
    - FormRequest validation: url (required, valid URL, max:2048), trigger_type (required, in:play,impression), multiplier (integer, min:1)
    - Register routes in `routes/api.php`
    - _Requirements: 13.1, 14.1, 15.1_

  - [x] 14.2 Implement TrackingPixelPanel frontend component
    - Create `TrackingPixelPanel` in `features/orders/components/` — CRUD list of pixels with URL, trigger_type, multiplier fields
    - Create `trackingPixelsApi` in `features/orders/api.ts` (list, create, update, delete)
    - Create TanStack hooks: `useTrackingPixels`, `useCreateTrackingPixel`, `useUpdateTrackingPixel`, `useDeleteTrackingPixel`
    - Render panel in: OrderDetailPage (Order-level), OrderLineDetailPage (OrderLine-level), and creative detail/modal (Creative-level)
    - _Requirements: 13.1, 13.3, 14.1, 15.1_

  - [x] 14.3 Write property test for pixel accumulation and multiplier
    - **Property 7: Disparo acumulativo de tracking pixels en los 3 niveles**
    - **Property 8: Multiplier determina cantidad de disparos**
    - **Validates: Requirements 13.2, 14.2, 14.3, 15.2, 15.3**

- [x] 15. Server-side pixel firing — Backend job
  - [x] 15.1 Implement FireTrackingPixelJob + ImpressionsController integration
    - Create `FireTrackingPixelJob` with: tries=4, backoff=[10,60,300], HTTP GET to pixel URL, multiplier loop
    - Add `failed()` method: log error with url, creative_id, impression_id
    - Modify `ImpressionsController@store`: after recording impression, collect pixels from Order + OrderLine + Creative levels, filter by trigger_type, dispatch FireTrackingPixelJob for each matching pixel
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 13.2, 14.2, 15.2, 15.3_

  - [x] 15.2 Write unit tests for FireTrackingPixelJob
    - Test successful fire
    - Test failure with retry (job re-queued)
    - Test permanent failure after max retries (logged)
    - Test multiplier fires N times
    - _Requirements: 16.1, 16.2, 16.3_

- [x] 16. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Video duration validation — Frontend
  - [x] 17.1 Implement DurationWarningBadge and validation logic
    - Create `DurationWarningBadge` component in `features/orders/components/`
    - Implement `checkVideoDuration` utility: compare content.duration_seconds vs resolveSlotDuration(screen)
    - Show warning badge on creative cards when video exceeds slot duration
    - Show non-blocking warning dialog when assigning a video that exceeds duration (allow user to proceed)
    - Integrate into creative cards and bulk-assign flow
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 17.2 Write property test for duration validation
    - **Property 9: Validación de duración video vs slot**
    - **Validates: Requirements 17.1, 17.2**

- [x] 18. Loop preview — Backend endpoint + Frontend modal
  - [x] 18.1 Implement LoopPreviewController
    - Create `LoopPreviewController` with `show` method at GET `/admin/screens/{id}/loop-preview`
    - Return manifest data + metadata: slot timing, position, type, creative info, playback mode
    - Register route in `routes/api.php`
    - _Requirements: 19.1, 19.2_

  - [x] 18.2 Implement LoopPreviewModal frontend
    - Create `LoopPreviewModal` in `features/orders/components/`
    - Create `loopPreviewApi.get` in `features/orders/api.ts`
    - Create `useLoopPreview` TanStack query hook
    - Visual loop timeline: show slots in order with duration, type labels, creative thumbnails
    - Show sequential order or round_robin weights per mode
    - Add "Preview" button to each screen row in ByScreenTab and ByResolutionTab
    - _Requirements: 19.1, 19.2, 19.3, 19.4_

- [x] 19. Copy creatives between OrderLines — Backend + Frontend
  - [x] 19.1 Implement CopyCreativesController
    - Create `CopyCreativesController` at POST `/admin/order-lines/{sourceId}/copy-creatives`
    - Accept `{ target_order_line_id: uuid }`
    - Logic: get source creatives' Content → resolve target screens by resolution → create matching Creatives in target → skip non-matching
    - Return: `{ created, skipped, covered_screens }`
    - Register route in `routes/api.php`
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 19.2 Implement CopyCreativesDialog frontend
    - Create `CopyCreativesDialog` in `features/orders/components/`
    - OrderLine selector: show available lines from same order + other orders of same tenant
    - Create `copyCreativesApi.copy` in `features/orders/api.ts`
    - Create `useCopyCreatives` TanStack mutation hook
    - Show results summary after copy
    - Render trigger button in OrderLineDetailPage creative section header
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

  - [x] 19.3 Write property test for copy creatives
    - **Property 13: Copia de creativos respeta coincidencia de resolución**
    - **Validates: Requirements 20.2, 20.3, 20.4**

- [x] 20. Creative delete isolation
  - [x] 20.1 Verify and enforce individual creative deletion behavior
    - Ensure `CreativeController@destroy` only deletes the specific Creative record without cascade to other screens' creatives
    - Verify bulk-assign always creates individual Creatives per screen (not per group)
    - Add integration test: delete creative from screen A → screen B creatives unchanged
    - _Requirements: 11.1, 11.2_

  - [x] 20.2 Write property test for delete isolation
    - **Property 6: Eliminación de creativo es aislada por pantalla**
    - **Validates: Requirements 11.2**

- [x] 21. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Backend uses PHP/Laravel, frontend uses TypeScript/React with TanStack Query, player uses TypeScript
- The `full-stack-integration` steering rule is embedded in tasks: each frontend task includes API client, hook, component creation AND rendering in parent view
- No new routes need to be added to `routes.tsx` (no new pages), but components must be rendered in existing pages (OrderDetailPage, OrderLineDetailPage, ContentPage)
- The migration command (task 12.1) should be run manually by the operator before other features that depend on individual screen-level creatives

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "12.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "5.1", "7.1", "8.1", "14.1"] },
    { "id": 3, "tasks": ["2.3", "3.3", "5.2", "5.3", "7.2", "8.2", "13.1", "14.2"] },
    { "id": 4, "tasks": ["5.4", "6.1", "7.3", "8.3", "10.1", "13.2", "14.3", "15.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "10.2", "11.1", "12.2", "15.2", "17.1"] },
    { "id": 6, "tasks": ["6.4", "11.2", "17.2", "18.1", "19.1", "20.1"] },
    { "id": 7, "tasks": ["18.2", "19.2", "19.3", "20.2"] }
  ]
}
```
