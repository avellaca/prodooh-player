---
inclusion: auto
---

# Validación Post-Ejecución de Tareas

Después de completar cada grupo/wave de tareas (es decir, cuando todas las tareas de una wave terminan), se DEBEN ejecutar las siguientes validaciones antes de continuar con la siguiente wave:

## Backend (`/backend`)

1. **Tests**: Ejecutar `php artisan test` para correr todos los tests (Unit, Feature, Property).
2. **Lint/Static analysis**: Si hay herramientas configuradas (Pint, PHPStan), ejecutarlas.
3. **Migrations**: Verificar que las migraciones corren limpiamente con `php artisan migrate:fresh --seed` (en entorno de testing con SQLite in-memory).

## Player (`/player`)

1. **Tests**: Ejecutar `npm test` (Vitest con `--run`).
2. **Type check**: Ejecutar `npm run build:typecheck` para verificar que TypeScript compila sin errores.
3. **Build**: Ejecutar `npm run build` para confirmar que el bundle se genera correctamente.

## Contracts (`/contracts`)

1. **Type check**: Ejecutar `npx tsc --noEmit` para verificar que los tipos compilan sin errores.

## Reglas

- Si alguna validación falla, se debe corregir ANTES de proceder a la siguiente wave de tareas.
- Reportar al usuario un resumen breve del resultado de las validaciones (e.g., "✅ Backend: 15 tests pass. ✅ Player: 8 tests pass, build OK.").
- No omitir validaciones aunque parezcan redundantes — queremos confirmar progreso sin regresiones.
