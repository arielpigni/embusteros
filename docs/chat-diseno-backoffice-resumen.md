# Resumen del chat "Diseñar backoffice para carga de datos"

Chat original de VS Code (30/07/2026 → 16/09/2026). Transcripción completa: `~/.claude/projects/-Users-arielpigni-Projects-Claude-Projects-EmbusterosSRL/875c207a-1cc4-44ba-b191-b835140c7523.jsonl`.
Specs/plan relacionados: `docs/superpowers/specs/2026-07-30-carga-backoffice-design.md`, `docs/superpowers/plans/2026-07-30-carga-backoffice-plan.md`.

## Qué se hizo
Sub-proyecto 2 de la migración a Supabase: `carga.html`, backoffice desktop-first para cargar Compra/Venta/Gasto/Retiro de Socio, datos de auto (año/color/km) y fotos. Mismo PIN `10500`, anon key pública, RLS como único control real. Publicado en `https://arielpigni.github.io/embusteros/carga.html`.

## Decisiones de diseño
- **Layout:** opción A elegida sobre mockup (sidebar + panel lateral de 640px, tabla de movimientos, dark/light con toggle). Campos en filas de 2–3 para que Compra y Venta no scrolleen. Una sola tipografía en inputs; mono solo para cifras de solo lectura. Montos completos (sin K/M) para evitar confusión en plata.
- **Pagado por:** `Fondo` por defecto y destacado; socios son excepción, multi-selección (1 a 3). Se guarda en la columna `pagado_por` como `Fondo` o nombres separados por coma (sin cambio de schema). En Venta el campo pasó a "Destino del dinero".
- **Venta:** muestra compra/gastos/inversión y calcula ganancia en vivo; indica con quién se compró; thumbnail/foto del auto. Solo autos en stock (más el actual al editar).
- **Gasto:** combobox propio con todos los autos y badge Stock/Vendido.
- **Retiro de Socio:** atado a `auto_id` + socio. Solo autos vendidos con reparto pendiente; monto sugerido ganancia÷3, editable; permite confirmar 1, 2 o 3 socios a la vez (un movimiento por socio). Editar un retiro es de a uno.
- **Tabs de tipo** con el color de su movimiento (Compra azul, Venta verde, Gasto rojo, Retiro ámbar).
- **Autos:** filtro Todos/Stock/Vendidos; tarjetas con badge de ancho fijo, días en stock a la izquierda (apagado si ya vendido), Venta+Ganancia o solo Invertido a la derecha. Orden: Vendidos por fecha de venta asc, Stock/Todos por fecha de compra asc. Ficha en dos columnas: izquierda info (patente estilo placa, stats, ficha editable, fotos), derecha gastos con scroll (Compra siempre primero) y botón "+ Nuevo movimiento" con el auto precargado.
- **UX:** miles con puntos mientras se escribe; botones con estado "Guardando…"; toast no bloqueante (`showToast`) y `confirmDialog` propio en vez de `alert`/`confirm`; el panel ya no se cierra al clickear afuera.
- **Fotos:** Supabase Storage (bucket `auto-fotos`), no Cloudinary. Se suben después de guardar la Compra; si una falla, no corta el guardado. `readFileWithRetry` (5 intentos, 1s) porque las fotos de iCloud devolvían "No content provided". Al editar una Compra solo se informa cuántas fotos tiene; agregar/borrar es desde la tab Autos.

## Supabase (SQL corrido a mano por Ariel)
- `autos`: columnas `anio`, `color`, `kilometraje`. Tabla `auto_fotos`. Policies `anon` de insert/update en `autos`, insert/update/delete en `movimientos`, select/insert/delete en `auto_fotos`.
- Storage: policies sobre `storage.objects` para `auto-fotos` (marcar el bucket público solo da lectura).
- `autos` **sin** policy de delete a propósito; borrar autos se hace por SQL.

## Cutover (31/07/2026)
- QA de los 4 tipos validada por Ariel. Datos de prueba limpiados con `truncate table auto_fotos, movimientos, autos restart identity cascade;` y re-migración con `migration/migrate.js --write` desde el Sheet congelado.
- Resultado validado: 14 autos, 7 vendidos, 7 en stock, ganancia $17.890.000, inversión en stock $99.653.800.
- Push a `origin/main` de `index.html` (ya leía de Supabase) y `carga.html`. Desde ahí el Sheet es solo respaldo histórico; toda carga va por `carga.html`.

## Bugs resueltos después del push
- **App no reflejaba movimientos (01/08):** `sw.js` servía `index.html` cache-first y nunca revalidaba. Fix: red primero con cache de respaldo, cache v2, recarga automática al detectar SW nuevo y revisión al volver a primer plano. Un celular ya trabado se destraba con `index.html?fix=1`; una instancia abierta requiere cerrarla y reabrirla una vez.
- **Venta no se podía marcar desde la ficha (16/09):** con `presetAutoId` y alta nueva, el código leía `editing.valor` con `editing = null` (TypeError). Corregido y pusheado (commit `dbb6cb9`).

## Pendientes / notas
- `TEST123` y demás datos de prueba se eliminaron con el truncate del cutover.
- `index.html` todavía no muestra todos los campos nuevos que carga el backoffice (el CLAUDE.md indica qué ya se ve: fotos, año y kilometraje).
- Carga por voz con AI (sub-proyecto 4) sigue sin arrancar; el backoffice se pensó para dejar lugar en el sidebar.
