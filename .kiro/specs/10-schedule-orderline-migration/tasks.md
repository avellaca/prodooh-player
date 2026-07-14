# Implementation Plan: Schedule OrderLine Migration

## Overview

Migrate the `active_dates` field from the Creative model to the OrderLine model. The implementation follows a database-first approach: add the column to order_lines, migrate existing data, update backend logic (validation, observer, ManifestGenerator), update frontend (OrderLineForm, schema changes, remove from creative flows), then drop the column from creatives.

## Tasks

- [x] 1. Database migration and model updates
  - [x] 1.1 Create database migration to add `active_dates` to `order_lines`, migrate data, and drop from `creatives`
    - Create migration file `database/migrations/xxxx_move_active_dates_to_order_lines.php`
    - In `up()`: add `active_dates` jsonb nullable column to `order_lines` after `ends_at`
    - In `up()`: run SQL to compute the union of distinct `active_dates` from creatives via order_line_targets and store in the OrderLine's new column
    - In `up()`: drop `active_dates` column from `creatives` table
    - In `down()`: restore `active_dates` jsonb nullable column on `creatives`, drop from `order_lines`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 1.2 Update OrderLine model to include `active_dates` in fillable and casts
    - Add `'active_dates'` to `$fillable` array
    - Add `'active_dates' => 'array'` to `casts()` method
    - _Requirements: 1.1_

  - [x] 1.3 Update Creative model to remove `active_dates` from fillable and casts
    - Remove `'active_dates'` from `$fillable` array
    - Remove `'active_dates' => 'array'` from `casts()` method
    - _Requirements: 4.1_

- [x] 2. Backend validation and observer updates
  - [x] 2.1 Add `validateOrderLineActiveDates` method to DateContainmentValidator
    - Implement the method to check all dates in `active_dates` fall within parent Order's [starts_at, ends_at] range
    - Return 422 with invalid dates listed in the error message
    - Remove the `validateCreativeActiveDates` method
    - _Requirements: 1.3, 1.4, 5.2, 5.3_

  - [x] 2.2 Write property test for date containment validation (Property 1)
    - **Property 1: Date containment validation**
    - Use Eris to generate arbitrary OrderLine active_dates arrays and Order date ranges
    - Verify validation passes iff all dates are within [starts_at, ends_at]
    - Keep iterations to 5
    - **Validates: Requirements 1.3, 1.4, 5.3**

  - [x] 2.3 Update OrderLineObserver to validate `active_dates`
    - Add `'active_dates'` to `RECALCULATE_FIELDS` constant
    - In `creating()`: call `$this->validator->validateOrderLineActiveDates($orderLine)`
    - In `updating()`: if `active_dates` is dirty, call `validateOrderLineActiveDates`
    - _Requirements: 5.4, 5.5_

  - [x] 2.4 Update CreativeObserver to remove `active_dates` validation
    - Remove `validateCreativeActiveDates` calls from `creating()` and `updating()` hooks
    - Remove `'active_dates'` from `RECALCULATE_FIELDS`
    - _Requirements: 5.1_

- [x] 3. Checkpoint - Ensure backend validation tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. ManifestGenerator and controller updates
  - [x] 4.1 Update ManifestGenerator to filter by OrderLine `active_dates`
    - Replace the creative-level `whereJsonContains('active_dates', $today)` query with OrderLine-level filtering
    - Load active order lines that match today: null/empty active_dates (falls back to starts_at/ends_at range) OR active_dates contains today
    - Load creatives from active order lines' targets
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 4.2 Write property test for ManifestGenerator inclusion logic (Property 2)
    - **Property 2: ManifestGenerator inclusion logic**
    - Use Eris to generate arbitrary OrderLines with varying active_dates (null, empty, populated) and arbitrary today dates
    - Verify inclusion iff: (a) active_dates is null/empty AND starts_at <= d <= ends_at, OR (b) d is in active_dates
    - Keep iterations to 5
    - **Validates: Requirements 1.5, 2.1, 2.2, 2.3**

  - [x] 4.3 Ensure manifest recalculation dispatches on `active_dates` update
    - Verify the OrderLineObserver dispatches RecalculateManifestJob when `active_dates` is dirty (handled by the existing RECALCULATE_FIELDS logic added in 2.3)
    - _Requirements: 2.4_

  - [x] 4.4 Write property test for manifest recalculation dispatch (Property 3)
    - **Property 3: Manifest recalculation dispatch on active_dates change**
    - Use Eris to generate arbitrary OrderLine updates with dirty active_dates
    - Verify exactly one RecalculateManifestJob is dispatched per targeted screen
    - Keep iterations to 5
    - **Validates: Requirements 2.4**

  - [x] 4.5 Update OrderLineController to accept `active_dates` in store and update validation
    - Add `'active_dates' => ['nullable', 'array']` and `'active_dates.*' => ['required', 'string', 'date_format:Y-m-d']` to store rules
    - Add `'active_dates' => ['sometimes', 'nullable', 'array']` and `'active_dates.*' => ['required', 'string', 'date_format:Y-m-d']` to update rules
    - _Requirements: 1.2_

  - [x] 4.6 Write property test for active_dates format validation (Property 5)
    - **Property 5: OrderLine active_dates format validation**
    - Use Eris to generate arrays of strings, verify controller accepts iff all match YYYY-MM-DD or array is null/empty
    - Keep iterations to 5
    - **Validates: Requirements 1.2, 3.4**

  - [x] 4.7 Update CreativeController to remove `active_dates` from store and update validation
    - Remove `active_dates` from validation rules in `store()` and `update()` methods
    - _Requirements: 4.3, 4.4_

  - [x] 4.8 Update BulkCreativeController to remove `active_dates` from bulkByResolution validation
    - Remove `active_dates` from validation rules in `bulkByResolution()` method
    - _Requirements: 4.5_

- [x] 5. Checkpoint - Ensure backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Frontend: OrderLineForm integration
  - [x] 6.1 Add `active_dates` field to orderLineSchema
    - Add `active_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable().optional().default(null)` to the schema
    - _Requirements: 3.4_

  - [x] 6.2 Integrate ActiveDatesPicker into OrderLineForm
    - Import `ActiveDatesPicker` component
    - Watch `starts_at` and `ends_at` values to pass as `minDate`/`maxDate` props
    - Add `Controller` wrapping the `ActiveDatesPicker` bound to `active_dates` field
    - Display helper text and validation errors
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 6.3 Write property test for ActiveDatesPicker bounds reactivity (Property 4)
    - **Property 4: ActiveDatesPicker bounds reactivity**
    - Use fast-check to generate arbitrary starts_at/ends_at date pairs
    - Verify the ActiveDatesPicker's minDate/maxDate props always equal the form's starts_at/ends_at values after reactive changes
    - Keep iterations to 5
    - **Validates: Requirements 3.2, 3.3**

- [x] 7. Frontend: Remove active_dates from creative flows
  - [x] 7.1 Remove `active_dates` from creativeSchema and creativeForTargetSchema
    - Remove the `active_dates` field from both schemas in the schemas file
    - _Requirements: 4.6_

  - [x] 7.2 Remove `active_dates` from bulkByResolutionSchema
    - Remove the `active_dates` field from the bulk schema
    - _Requirements: 4.7_

  - [x] 7.3 Remove ActiveDatesPicker and date generation from creative assignment forms
    - Remove `ActiveDatesPicker` from individual creative assignment form (e.g., `ScreenCreativeList` edit mode)
    - Remove `active_dates` from mutation payloads in creative assignment
    - Remove `generateDateRange()` helper where only used for creative dates
    - _Requirements: 6.1, 6.3_

  - [x] 7.4 Remove ActiveDatesPicker and date generation from bulk creative assignment
    - Remove `ActiveDatesPicker` from `ResolutionGroupCard` / `DirectUploadDialog`
    - Remove `active_dates` from bulk assignment mutation payloads
    - Remove `orderLineDates` prop where only used for creative date generation
    - _Requirements: 6.2, 6.3_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Backend property tests use Eris with PHPUnit (iterations: 5)
- Frontend property tests use fast-check v4.8.0 with Vitest (iterations: 5)
- The migration must run in a specific order: add column → migrate data → drop old column

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.4", "4.5", "4.7", "4.8", "6.1", "7.1", "7.2"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.1", "4.6", "6.2", "7.3", "7.4"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.3"] },
    { "id": 5, "tasks": ["4.4"] }
  ]
}
```
