# Requirements Document

## Introduction

Migración del campo `active_dates` del modelo Creative al modelo OrderLine. Actualmente cada Creative define en qué fechas está activo. Con este cambio, la OrderLine define los días operativos mediante un campo `active_dates` (jsonb array de strings YYYY-MM-DD). Los creativos dejan de tener fechas propias. El ManifestGenerator filtra por `orderLine.active_dates` en lugar de `creative.active_dates`. El frontend integra el componente ActiveDatesPicker en el formulario de OrderLine.

## Glossary

- **OrderLine**: Línea de pedido que pertenece a una Order. Define prioridad, rango de fechas, peso de reparto y ahora también los días activos.
- **Creative**: Pieza creativa asociada a un OrderLineTarget. Contiene referencia a contenido y peso de rotación.
- **Order**: Pedido publicitario que agrupa OrderLines y define el rango temporal global (starts_at, ends_at).
- **ManifestGenerator**: Servicio backend que genera el manifiesto de reproducción para cada pantalla, decidiendo qué creativos incluir.
- **ActiveDatesPicker**: Componente React de calendario con 3 modos de selección (rango, multi-rango, días individuales) para elegir fechas activas.
- **OrderLineForm**: Formulario React para crear y editar OrderLines.
- **OrderLineController**: Controlador API que gestiona operaciones CRUD sobre OrderLines.
- **CreativeController**: Controlador API que gestiona operaciones CRUD sobre Creativos.
- **BulkCreativeController**: Controlador API para asignación masiva de creativos por resolución.
- **DateContainmentValidator**: Servicio que valida la contención de fechas entre entidades padre-hijo.
- **CreativeObserver**: Observer de Eloquent que valida active_dates y despacha recálculo de manifiestos al crear/actualizar/eliminar creativos.

## Requirements

### Requirement 1: Añadir active_dates a OrderLine

**User Story:** As a campaign manager, I want to define active dates at the order line level, so that all creatives within that line share the same operational schedule.

#### Acceptance Criteria

1. THE OrderLine model SHALL include an `active_dates` field of type jsonb array containing strings in format YYYY-MM-DD.
2. WHEN an OrderLine is created or updated with `active_dates`, THE OrderLineController SHALL accept `active_dates` as a nullable array of date strings in format YYYY-MM-DD.
3. WHEN `active_dates` is provided for an OrderLine, THE DateContainmentValidator SHALL verify that every date in `active_dates` falls within the parent Order's [starts_at, ends_at] range.
4. IF any date in `active_dates` falls outside the parent Order's [starts_at, ends_at] range, THEN THE OrderLineController SHALL return a 422 validation error specifying the invalid dates.
5. WHEN `active_dates` is null or an empty array on an OrderLine, THE ManifestGenerator SHALL treat the OrderLine as active every day within its own [starts_at, ends_at] range.

### Requirement 2: ManifestGenerator filtra por OrderLine active_dates

**User Story:** As a system operator, I want the manifest to include creatives only on the days the order line is active, so that screens display the correct content on the correct days.

#### Acceptance Criteria

1. WHEN generating a manifest for a screen, THE ManifestGenerator SHALL filter order line items by checking today's date against the OrderLine's `active_dates` field instead of the Creative's `active_dates` field.
2. WHILE an OrderLine has a non-empty `active_dates` array, THE ManifestGenerator SHALL include creatives of that OrderLine only when today's date is present in the OrderLine's `active_dates` array.
3. WHILE an OrderLine has a null or empty `active_dates` array, THE ManifestGenerator SHALL include creatives of that OrderLine for every day within the OrderLine's [starts_at, ends_at] range.
4. WHEN an OrderLine's `active_dates` is updated, THE system SHALL dispatch a manifest recalculation job for all screens targeted by that OrderLine.

### Requirement 3: Integrar ActiveDatesPicker en OrderLineForm

**User Story:** As a campaign manager, I want to select active dates visually when creating or editing an order line, so that I can easily configure the operational schedule.

#### Acceptance Criteria

1. THE OrderLineForm SHALL include the ActiveDatesPicker component for selecting `active_dates`.
2. WHEN rendering the ActiveDatesPicker in OrderLineForm, THE OrderLineForm SHALL set the `minDate` prop to the OrderLine's `starts_at` value and the `maxDate` prop to the OrderLine's `ends_at` value.
3. WHEN the OrderLine's `starts_at` or `ends_at` values change in the form, THE OrderLineForm SHALL update the ActiveDatesPicker's `minDate` and `maxDate` props reactively.
4. THE orderLineSchema SHALL include an `active_dates` field defined as a nullable array of strings in YYYY-MM-DD format.
5. WHEN submitting the OrderLineForm, THE frontend SHALL send the `active_dates` array (or null if empty) as part of the request payload to the OrderLine API.

### Requirement 4: Eliminar active_dates del modelo Creative

**User Story:** As a developer, I want to remove the active_dates responsibility from creatives, so that scheduling is managed solely at the order line level.

#### Acceptance Criteria

1. THE Creative model SHALL remove `active_dates` from its fillable fields and casts.
2. THE database migration SHALL remove the `active_dates` column from the `creatives` table.
3. THE CreativeController store endpoint SHALL stop requiring and accepting `active_dates` in the request validation.
4. THE CreativeController update endpoint SHALL stop accepting `active_dates` in the request validation.
5. THE BulkCreativeController bulkByResolution endpoint SHALL stop requiring and accepting `active_dates` in the request validation and payload.
6. THE creativeSchema and creativeForTargetSchema in the frontend SHALL remove the `active_dates` field.
7. THE bulkByResolutionSchema in the frontend SHALL remove the `active_dates` field.

### Requirement 5: Eliminar validación DateContainment para creativos

**User Story:** As a developer, I want to remove the creative-level date containment validation, so that the system no longer enforces a constraint that has moved to the order line level.

#### Acceptance Criteria

1. THE CreativeObserver SHALL remove the invocation of `DateContainmentValidator::validateCreativeActiveDates` in the `creating` and `updating` hooks.
2. THE DateContainmentValidator SHALL remove the `validateCreativeActiveDates` method.
3. THE DateContainmentValidator SHALL add a new `validateOrderLineActiveDates` method that validates OrderLine `active_dates` are within the parent Order's [starts_at, ends_at] range.
4. WHEN an OrderLine is created with `active_dates`, THE system SHALL invoke the new `validateOrderLineActiveDates` validation.
5. WHEN an OrderLine is updated and `active_dates` is dirty, THE system SHALL invoke the new `validateOrderLineActiveDates` validation.

### Requirement 6: Eliminar active_dates de flujos de asignación de creativos en frontend

**User Story:** As a campaign manager, I want the creative assignment forms to no longer ask for active dates, so that the workflow is simpler and dates are managed at the order line level.

#### Acceptance Criteria

1. THE creative assignment form (individual target assignment) SHALL remove the ActiveDatesPicker component and the `active_dates` field from its form schema and submission payload.
2. THE bulk creative assignment form (bulk-by-resolution) SHALL remove the ActiveDatesPicker component and the `active_dates` field from its form schema and submission payload.
3. WHEN a creative upload or assignment flow submits data to the API, THE frontend SHALL omit the `active_dates` field from the request body.

### Requirement 7: Migración de datos existentes

**User Story:** As a system administrator, I want existing creative active_dates data to be migrated to order lines, so that no scheduling information is lost during the transition.

#### Acceptance Criteria

1. THE database migration SHALL add the `active_dates` column (jsonb, nullable, default null) to the `order_lines` table before removing the column from `creatives`.
2. THE database migration SHALL copy the union of all distinct `active_dates` from a given OrderLine's creatives (via their OrderLineTargets) into the OrderLine's new `active_dates` field.
3. IF an OrderLine has no creatives with `active_dates` values, THEN THE migration SHALL leave the OrderLine's `active_dates` as null.
4. THE database migration SHALL include a rollback that restores the `active_dates` column on the `creatives` table.
