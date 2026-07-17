---
inclusion: auto
---

# Completitud Full-Stack — Regla de Integración Obligatoria

## Principio

Cada funcionalidad implementada DEBE estar completamente integrada y accesible por el usuario final. No basta con crear un componente, modelo, endpoint o servicio — DEBE estar conectado al flujo completo del usuario.

## Checklist obligatorio por capa

### Backend (Laravel)

- [ ] Modelo creado con `$fillable`, `$casts` y relaciones
- [ ] Migración creada y ejecutable
- [ ] Controlador con métodos CRUD necesarios
- [ ] Rutas registradas en `routes/api.php` con el middleware correcto
- [ ] Validación de request implementada
- [ ] Observer/Event registrado si hay efectos secundarios (regenerar manifests, etc.)

### Admin Frontend (React)

- [ ] Componente/página creado
- [ ] **Ruta registrada en `src/routes.tsx`** con el guard de roles correcto
- [ ] **Link/botón de navegación visible en la UI** (Header, menú, sidebar, o dentro de la vista padre)
- [ ] API client creado en el módulo `api.ts` correspondiente
- [ ] Hook de TanStack Query creado si aplica
- [ ] **Componente renderizado en la vista padre** (si es un panel, modal, sección, tab, etc., debe estar montado en la página donde el usuario lo necesita)
- [ ] Props y datos conectados (el componente recibe datos reales, no está vacío ni con datos mock)

### Player (TypeScript)

- [ ] Lógica de negocio implementada
- [ ] Integrada en el flujo del LoopEngine o módulo correspondiente
- [ ] Manifest consumption actualizado si hay nuevos campos
- [ ] Build exitoso (`npm run build`)

## Regla crítica

**NUNCA** considerar una tarea como completada si:

1. Se creó un componente pero no se importó ni renderizó en ninguna vista
2. Se creó una ruta en el backend pero no se consume desde el frontend
3. Se creó una página pero no hay forma de navegar a ella (falta link en Header, botón, o ruta)
4. Se creó un endpoint que retorna datos nuevos pero el frontend no los usa ni muestra
5. Se creó un modelo con campos nuevos pero el controlador no los incluye en la respuesta JSON
6. Se agregó un campo al manifest pero el player no lo lee ni lo usa

## Proceso de verificación

Al terminar CADA tarea que involucra UI visible:

1. **Trazar el flujo completo**: Desde el punto de entrada del usuario (clic en menú, botón, etc.) hasta el resultado final (datos mostrados, acción ejecutada)
2. **Verificar la cadena**: Navegación → Ruta → Página → Componente → Hook → API → Backend → Respuesta → Render
3. **Si algún eslabón falta**, completarlo antes de marcar la tarea como terminada

## Ejemplo de error común a evitar

```
❌ Malo: "Creé SspPage.tsx con toda la UI"
   → Pero no agregué la ruta en routes.tsx
   → Ni el link en Header.tsx
   → El usuario no puede llegar a la página

✅ Correcto: "Creé SspPage.tsx, registré la ruta en routes.tsx, 
   agregué el link condicional en Header.tsx, y verifiqué que 
   la navegación funciona desde el menú"
```

## Aplica a specs y tareas

Esta regla aplica tanto durante la generación de tareas en specs (asegurar que las tareas incluyan la integración) como durante la ejecución de tareas individuales.
