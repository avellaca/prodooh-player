# Implementation Plan

## Overview

Este plan implementa la capa de datos fundacional para la reingeniería del player: migraciones de BD (orders, order_lines, order_line_targets, creatives, impressions), modelos Eloquent con relaciones, validaciones de containment de fechas, observers, y tests feature.

## Tasks

- [x] 1. Create migration for `orders` table
  - Requirements: Req 1
  - Design: Migración 1 — `create_orders_table`
  - Sub-tasks:
    - 1.1. Create migration file `database/migrations/2026_07_09_000001_create_orders_table.php`
    - 1.2. Define schema: uuid PK, `tenant_id` FK cascade to tenants, `name` string not null, `advertiser_name` string nullable, `starts_at` date, `ends_at` date, `status` enum (draft/active/paused/finished default draft), timestamps
    - 1.3. Add indexes on `tenant_id`, `status`, composite `[starts_at, ends_at]`
    - 1.4. Add CHECK constraint via DB::statement: `ends_at >= starts_at`
    - 1.5. Implement `down()` method: drop constraint then drop table
    - 1.6. Run `php artisan migrate` and verify table creation
    - 1.7. Run `php artisan migrate:rollback` and verify clean removal

- [x] 2. Create migration for `order_lines` table
  - Requirements: Req 2
  - Design: Migración 2 — `create_order_lines_table`
  - Sub-tasks:
    - 2.1. Create migration file `database/migrations/2026_07_09_000002_create_order_lines_table.php`
    - 2.2. Define schema: uuid PK, `order_id` FK cascade to orders, `name` string, `priority_tier` enum (patrocinio/estandar/red_interna), `starts_at` date, `ends_at` date, `target_spots` integer nullable, `delivery_pace` enum (asap/uniform default uniform), `share_weight` integer default 100, `time_window` jsonb nullable, `status` enum (draft/active/paused/finished default draft), timestamps
    - 2.3. Add indexes on `order_id`, `priority_tier`, `status`, composite `[starts_at, ends_at]`
    - 2.4. Add CHECK constraint: `ends_at >= starts_at`
    - 2.5. Implement `down()` method
    - 2.6. Run migration and verify

- [x] 3. Create migration for `order_line_targets` table
  - Requirements: Req 3
  - Design: Migración 3 — `create_order_line_targets_table`
  - Sub-tasks:
    - 3.1. Create migration file `database/migrations/2026_07_09_000003_create_order_line_targets_table.php`
    - 3.2. Define schema: uuid PK, `order_line_id` FK cascade to order_lines, `screen_id` uuid FK nullable cascade to screens, `screen_group_id` uuid FK nullable cascade to screen_groups, `created_at` timestamp useCurrent
    - 3.3. Add indexes on `order_line_id`, `screen_id`, `screen_group_id`
    - 3.4. Add XOR CHECK constraint via DB::statement: exactly one of screen_id/screen_group_id must be non-null
    - 3.5. Implement `down()` method
    - 3.6. Run migration and verify XOR constraint works (test insert with both null, both present, one present)

- [x] 4. Create migration for `creatives` table
  - Requirements: Req 4
  - Design: Migración 4 — `create_creatives_table`
  - Sub-tasks:
    - 4.1. Create migration file `database/migrations/2026_07_09_000004_create_creatives_table.php`
    - 4.2. Define schema: uuid PK, `order_line_id` FK cascade to order_lines, `content_id` FK RESTRICT to content, `weight` integer default 100, `active_dates` jsonb not null, timestamps
    - 4.3. Add indexes on `order_line_id`, `content_id`
    - 4.4. Implement `down()` method
    - 4.5. Run migration and verify RESTRICT behavior (cannot delete content referenced by a creative)

- [x] 5. Create migration for `impressions` table (replaces `playback_logs`)
  - Requirements: Req 5
  - Design: Migración 5 — `create_impressions_table`
  - Sub-tasks:
    - 5.1. Create migration file `database/migrations/2026_07_09_000005_create_impressions_table.php`
    - 5.2. In `up()`: drop `playback_logs` table, then create `impressions` with all fields as specified in design
    - 5.3. Add FKs: `screen_id` cascade, `creative_id` set null, `order_line_id` set null
    - 5.4. Add indexes on `screen_id`, `creative_id`, `order_line_id`, `source`, `started_at`, `synced_at`
    - 5.5. In `down()`: drop `impressions`, recreate `playback_logs` with original structure
    - 5.6. Run migration and verify both directions

- [x] 6. Create migration to remove obsolete columns from `screens`
  - Requirements: Req 6
  - Design: Migración 6 — `remove_loop_columns_from_screens`
  - Sub-tasks:
    - 6.1. Create migration file `database/migrations/2026_07_09_000006_remove_loop_columns_from_screens.php`
    - 6.2. In `up()`: drop columns `loop_config`, `sources_config`, `duration_seconds`
    - 6.3. In `down()`: recreate columns as nullable (jsonb nullable, jsonb nullable, integer nullable)
    - 6.4. Run migration and verify columns are gone
    - 6.5. Run rollback and verify columns are restored

- [x] 7. Create Order model with relations
  - Requirements: Req 7
  - Design: Modelo Order
  - Sub-tasks:
    - 7.1. Create `app/Models/Order.php` with `HasUuids`, `BelongsToTenant` traits
    - 7.2. Define `$fillable`, `$keyType`, `$incrementing`, `casts()`
    - 7.3. Add relation `orderLines()` → hasMany(OrderLine)
    - 7.4. Add relation via `BelongsToTenant` trait (provides `tenant()`)
    - 7.5. Verify model instantiation and relations via tinker

- [x] 8. Create OrderLine model with relations
  - Requirements: Req 8
  - Design: Modelo OrderLine
  - Sub-tasks:
    - 8.1. Create `app/Models/OrderLine.php` with `HasUuids` trait
    - 8.2. Define `$fillable`, `$keyType`, `$incrementing`, `casts()` (dates, time_window as array)
    - 8.3. Add relations: `order()`, `creatives()`, `targets()`, `impressions()`
    - 8.4. Add `resolveTargetScreens()` method that resolves direct screens + screens via groups
    - 8.5. Verify model and relations via tinker

- [x] 9. Create OrderLineTarget model with XOR validation
  - Requirements: Req 9, Req 14
  - Design: Modelo OrderLineTarget
  - Sub-tasks:
    - 9.1. Create `app/Models/OrderLineTarget.php` with `HasUuids` trait
    - 9.2. Define `$fillable`, disable timestamps (only `created_at`), set `CREATED_AT` constant
    - 9.3. Add XOR validation in `booted()` static method via `saving` event
    - 9.4. Add relations: `orderLine()`, `screen()`, `screenGroup()`
    - 9.5. Verify XOR validation: create with both null fails, both present fails, one present succeeds

- [x] 10. Create Creative model with relations
  - Requirements: Req 10
  - Design: Modelo Creative
  - Sub-tasks:
    - 10.1. Create `app/Models/Creative.php` with `HasUuids` trait
    - 10.2. Define `$fillable`, `$keyType`, `$incrementing`, `casts()` (active_dates as array)
    - 10.3. Add relations: `orderLine()`, `content()`, `impressions()`
    - 10.4. Verify model and relations via tinker

- [x] 11. Create Impression model with relations
  - Requirements: Req 11
  - Design: Modelo Impression
  - Sub-tasks:
    - 11.1. Create `app/Models/Impression.php` with `HasUuids` trait
    - 11.2. Define `$fillable`, disable `updated_at`, set `CREATED_AT` constant, `casts()` (datetimes, decimal)
    - 11.3. Add relations: `screen()`, `creative()`, `orderLine()`
    - 11.4. Verify model and relations via tinker

- [x] 12. Create DateContainmentValidator service
  - Requirements: Req 12
  - Design: DateContainmentValidator service
  - Sub-tasks:
    - 12.1. Create `app/Services/DateContainmentValidator.php`
    - 12.2. Implement `validateOrderLineDates(OrderLine)`: check starts_at/ends_at within parent Order range
    - 12.3. Implement `validateCreativeActiveDates(Creative)`: check all active_dates within parent OrderLine range
    - 12.4. Implement `validateOrderDateShrink(Order)`: check no child OrderLines would be orphaned
    - 12.5. All methods throw `ValidationException::withMessages()` on failure

- [x] 13. Create model observers and register them
  - Requirements: Req 12
  - Design: Observers + AppServiceProvider registration
  - Sub-tasks:
    - 13.1. Create `app/Observers/OrderObserver.php` — validate date shrink on updating
    - 13.2. Create `app/Observers/OrderLineObserver.php` — validate date containment on creating/updating
    - 13.3. Create `app/Observers/CreativeObserver.php` — validate active_dates containment on creating/updating
    - 13.4. Register all observers in `AppServiceProvider::boot()`
    - 13.5. Test: create OrderLine with dates outside Order range → ValidationException
    - 13.6. Test: create Creative with active_dates outside OrderLine range → ValidationException
    - 13.7. Test: shrink Order dates when children exist outside → ValidationException

- [x] 14. Update existing models with new relations and remove obsolete fields
  - Requirements: Req 13
  - Design: Changes to Existing Models
  - Sub-tasks:
    - 14.1. `Screen` model: remove `loop_config`, `sources_config`, `duration_seconds` from `$fillable` and `casts()`; remove `playbackLogs()` relation; add `orderLineTargets()` and `impressions()` relations
    - 14.2. `ScreenGroup` model: add `orderLineTargets()` relation
    - 14.3. `Tenant` model: add `orders()` relation; remove `playbackLogs()` relation
    - 14.4. `Content` model: add `creatives()` relation
    - 14.5. Delete `app/Models/PlaybackLog.php` (model for removed table)

- [x] 15. Write feature tests for migrations and model validation
  - Requirements: Req 1–6, 12, 14
  - Design: Testing Strategy
  - Sub-tasks:
    - 15.1. Create `tests/Feature/OrderModelTest.php`: test full hierarchy creation (Order → OrderLine → Creative → Impression)
    - 15.2. Test cascade delete: deleting Order cascades through all children
    - 15.3. Test set-null on delete: deleting Creative sets `creative_id` to null in Impressions
    - 15.4. Test RESTRICT: cannot delete Content that is referenced by a Creative
    - 15.5. Test date containment: OrderLine dates must be within Order range
    - 15.6. Test date containment: Creative active_dates must be within OrderLine range
    - 15.7. Test Order date shrink prevention: cannot shrink if children exist outside
    - 15.8. Test XOR validation: OrderLineTarget rejects invalid combinations
    - 15.9. Test CHECK constraints at DB level: insert with `ends_at < starts_at` fails
    - 15.10. Run full test suite: `php artisan test --filter=OrderModelTest`

## Task Dependency Graph

```
1 -> 2 -> 3
2 -> 4
4 -> 5
1 -> 6
1 -> 7
2 -> 8
3 -> 9
4 -> 10
5 -> 11
7, 8, 9, 10, 11 -> 12
12 -> 13
7, 8, 9, 10, 11 -> 14
1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 -> 15
```

## Notes

- Las migraciones se ejecutan en orden estricto por dependencias de FK.
- La migración 5 elimina `playback_logs` (tabla vacía) antes de crear `impressions`.
- Los breaking changes en controllers/frontend NO se resuelven aquí — se abordan en spec 06 (motor).
- Todos los modelos usan UUID como PK con el trait `HasUuids` de Laravel.
