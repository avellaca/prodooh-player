---
inclusion: fileMatch
fileMatchPattern: "admin-frontend/**/*.{ts,tsx}"
---

# React Best Practices — Admin Frontend

## useEffect: NO usar salvo sincronización con sistemas externos

`useEffect` es un "escape hatch" según la documentación oficial de React.
En este proyecto, con TanStack Query para data fetching y React Hook Form para formularios, NO hay razón para usar `useEffect` en la gran mayoría de componentes.

### Prohibido (anti-patterns):

```tsx
// ❌ NO: Derivar estado de props/state
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// ✅ SÍ: Calcular directo en render
const fullName = firstName + ' ' + lastName;
```

```tsx
// ❌ NO: Fetch de datos con useEffect
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
useEffect(() => {
  fetch('/api/screens').then(r => r.json()).then(setData);
}, []);

// ✅ SÍ: Usar TanStack Query
const { data, isLoading } = useQuery({
  queryKey: ['screens'],
  queryFn: () => api.screens.list(),
});
```

```tsx
// ❌ NO: Lógica de eventos en Effect
useEffect(() => {
  if (formSubmitted) {
    sendData(formValues);
  }
}, [formSubmitted]);

// ✅ SÍ: Lógica en el event handler
function handleSubmit(values) {
  mutation.mutate(values);
}
```

```tsx
// ❌ NO: Cadenas de Effects que actualizan estado entre sí
useEffect(() => { setB(derived(a)); }, [a]);
useEffect(() => { setC(derived(b)); }, [b]);

// ✅ SÍ: Calcular todo junto en el handler o en render
const b = derived(a);
const c = derived(b);
```

```tsx
// ❌ NO: Sincronizar estado entre componentes con Effect
useEffect(() => { onChange(localState); }, [localState]);

// ✅ SÍ: Lifting state up o llamar onChange en el event handler
function handleChange(newValue) {
  setLocalState(newValue);
  onChange(newValue);
}
```

### Permitido (usos legítimos de useEffect):

- Sincronizar con un sistema externo no-React (WebSocket, browser API, third-party widget)
- Analytics de "componente visible" (e.g., trackear pageview on mount)
- Cleanup de recursos (timers, event listeners del DOM)
- `useSyncExternalStore` es preferible a useEffect para suscripciones externas

### Alternativas recomendadas en este proyecto:

| Antes (useEffect) | Ahora |
|---|---|
| Fetch de datos | `useQuery` de TanStack Query |
| Mutaciones (POST/PUT/DELETE) | `useMutation` de TanStack Query |
| Estado derivado | Variable calculada en render |
| Cálculos costosos | `useMemo` (o React Compiler automático) |
| Formularios controlados | React Hook Form (`useForm`) |
| Suscripción a store | `useSyncExternalStore` |
| Reset de estado al cambiar prop | `key` prop en componente |

### Regla de revisión:

Si encuentras un `useEffect` en un componente, pregúntate:
1. ¿Estoy sincronizando con algo FUERA de React? → OK
2. ¿Estoy derivando estado? → Calcular en render
3. ¿Estoy respondiendo a un evento del usuario? → Mover al event handler
4. ¿Estoy haciendo fetch? → Usar TanStack Query

## Referencia

- [You Might Not Need an Effect — React Docs](https://react.dev/learn/you-might-not-need-an-effect)
- [TanStack Query docs](https://tanstack.com/query/latest)
