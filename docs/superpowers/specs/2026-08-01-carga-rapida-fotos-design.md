# Carga Rápida — Fotos (Fase 1 de 3)

## Contexto

`index.html` es hoy de solo lectura: muestra datos, no los carga (eso vive en
`carga.html`). Ariel quiere una forma mucho más rápida de cargar lo más
frecuente desde el celular — Compra, Gastos y Fotos — directamente en la app
que ya usa a diario, sin pasar por `carga.html`. Es la primera vez que
`index.html` escribe en Supabase.

Es la primera de 3 fases (ver plan de arquitectura general aprobado en la
sesión de planning: Fotos → Compra → Gastos, de más simple a más compleja).
Esta fase es la única sin IA — no depende de ninguna infraestructura nueva
(Edge Functions, OpenAI), así que se puede construir y pushear primero,
dejando la arquitectura del menú "+" lista para que Compra y Gastos la
reutilicen después.

## Objetivo

Agregar un botón "+" junto a Dashboard/Stock/Vendidos que abre un menú con 3
opciones (Fotos / Compra / Gastos). Solo "Fotos" funciona en esta fase:
elegir un auto existente y subirle fotos directo a Supabase Storage (bucket
`auto-fotos`) + tabla `auto_fotos`, igual que ya hace `carga.html`. Compra y
Gastos aparecen en el menú marcados "Pronto" (no clickeables), para dejar el
lugar reservado sin implementarlos todavía.

## No-objetivos

- Compra y Gastos (fases 2 y 3, con IA — se planifican por separado).
- Cambios en `carga.html` o en el schema de Supabase.
- Borrar fotos desde `index.html` (sigue viviendo en `carga.html`).
- Cualquier Edge Function o integración con IA (no aplica a esta fase).

## Diseño

### 1. Punto de entrada — botón "+" y menú overlay

- Botón `.tab-plus` de ancho fijo (no `flex:1` como los otros 3 tabs), al
  lado de "Vendidos" en `.tab-bar` (`index.html:151-155`).
- Al tocarlo, abre un overlay tipo bottom-sheet (mismo patrón que
  `#photo-peek`, `index.html:334-349`: un div fijo creado una vez, togglea
  con clase `.show`) con 3 opciones: "📷 Fotos" (clickeable), "🛒 Compra" y
  "🎙️ Gastos" (ambas con tag "Pronto", sin `onclick`, mismo espíritu que el
  nav item bloqueado que ya existe en `carga.html` para "Carga por voz").

### 2. Estado — extiende la máquina de estados existente

Nuevas variables globales, mismo patrón que `currentTab`/`drillView`/
`detailCar` (`index.html:299-301`):

```javascript
let quickMenuOpen = false;  // menú "+" abierto/cerrado
let quickFlow = null;       // null | 'fotos'
let quickStep = 0;          // paso dentro del flujo activo
let quickData = {};         // datos en progreso del flujo activo
```

`render()` (`index.html:364-371`) gana un guard `if (quickFlow) {...; return;}`
antes que `detailCar`. `goBack()`/`updateBackBtn()` (`index.html:303-310`)
ganan una rama: si hay `quickFlow` activo, retrocede un paso o sale del flujo
antes de caer al comportamiento actual. `showTab()` (`index.html:312-318`)
limpia `quickFlow`/`quickData` al cambiar de tab, para que tocar Dashboard/
Stock/Vendidos durante un flujo en progreso lo abandone en vez de dejar la
UI de la tab activa desincronizada del contenido mostrado.

### 3. Flujo de Fotos

**Paso 0 — elegir auto:** buscador + lista filtrable sobre `Object.values(CARS)`
(ya en memoria, sin query nueva), mostrando patente/marca/modelo + badge
Stock/Vendido. El filtro actualiza solo el contenedor de la lista (no la
lista completa ni el input) para no perder el foco mientras se tipea — mismo
problema que resuelve `carga.html`'s `onComboInput`/`renderComboList`
(`carga.html:709-739`) con un div de resultados separado del input.

**Paso 1 — subir fotos:** `<input type="file" accept="image/*" multiple>`
sin `capture` (deja elegir cámara o carrete, igual que
`carga.html:1265`). Al tocar "Subir fotos": reutiliza **verbatim**
`uploadFotosParaAuto(autoId, files)` y `readFileWithRetry` (`carga.html:1035-
1062`) para subir a Storage + insertar en `auto_fotos`.

- Después de subir, refrescar solo las fotos de ese auto (`auto_fotos` por
  `auto_id`, no un `loadData()` completo) y actualizar `CARS[patente].fotos`
  en memoria, para no perder fotos que otro socio haya subido al mismo auto
  desde otro dispositivo momentos antes.
- Si hay fallos parciales (mismo caso que `carga.html:1046-1062`: archivos
  que no terminaron de sincronizarse desde iCloud), mostrar cuáles fallaron
  y dejar reintentar desde el mismo paso, en vez de avanzar automáticamente.
- Si todo sale bien: salir del flujo (`quickFlow=null`) y abrir el detalle
  del auto (`openDetail(patente)`) para que el socio vea el carrusel
  actualizado al toque.

### 4. QA antes de producción

Escribe filas reales en Supabase (a diferencia de la feature de fotos
anterior, acá no hay "datos de prueba cargados aparte" — el flujo mismo es
el que sube). Mismo procedimiento de siempre:
1. Implementar en el working tree local, sin pushear.
2. Servir `index.html` localmente (`python3 -m http.server`, sin `--bind`) y
   abrir desde el celular por la IP local de la notebook.
3. Probar el flujo completo: tocar "+", ver el menú (Fotos activo, Compra/
   Gastos "Pronto"), elegir un auto, subir 1-2 fotos reales, confirmar que
   aterriza en el detalle con el carrusel actualizado.
4. Confirmar que Dashboard/Stock/Vendidos y el resto de la navegación
   siguen funcionando igual que antes (tabs, drill-downs, back button).
5. Con el ok explícito de Ariel, commit + push a `main`.

## Testing

No hay test suite (archivo único sin build tools). Validación manual según
la sección de QA arriba, más `node --check` sobre el `<script>` extraído
para pescar errores de sintaxis antes de probar en el navegador.
