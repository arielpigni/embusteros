# Backoffice de carga (`carga.html`) — Implementation Plan

**Goal:** Reemplazar la carga manual del Sheet por un formulario web (`carga.html`) que escribe directo a Supabase: movimientos (Compra/Venta/Gasto/Retiro) y ficha extendida + fotos de auto.

**Architecture:** Archivo nuevo y aislado (`carga.html`), mismo patrón sin build que `index.html`: HTML/CSS/JS inline, `supabase-js` vía CDN, PIN `10500`. Dos tabs: Movimientos (alta + listado/edición/borrado) y Autos (ficha + galería de fotos vía Supabase Storage). No modifica `index.html`, `Code.gs` ni el Sheet.

**Tech Stack:** Supabase (Postgres + Storage + `supabase-js` v2), HTML/CSS/JS vanilla, sin frameworks ni build tools.

## Global Constraints

- Nada de esto se pushea a `origin/main` hasta completar la QA con datos de prueba (Task 4) y recibir aprobación explícita de Ariel.
- `index.html` no se modifica en este plan — mostrar fotos/año/color/km ahí es un paso siguiente, aparte.
- Seguridad = mismo nivel que el resto del proyecto: `anon key` pública, RLS abierta a `anon`, PIN como chequeo de UI únicamente.
- Sin test runner — verificación manual en el navegador, documentada en cada task.
- Cambios de schema/RLS/Storage en Supabase los ejecuta Ariel manualmente (Claude no tiene credenciales del proyecto).

---

### Task 1: Provisionar schema, RLS y Storage en Supabase

**Files:** Ninguno en el repo — se ejecuta en el dashboard de Supabase.

**Interfaces:**
- Produces: columnas nuevas en `autos`, tabla `auto_fotos`, policies de insert/update/delete en `autos`/`movimientos`, bucket de Storage `auto-fotos` — que los Tasks 2 y 3 van a consumir.

- [ ] **Step 1: Verificar policies existentes**

En **Authentication → Policies**, revisar qué policies ya existen sobre `autos`/`movimientos` (se crearon algunas en el sub-proyecto 1, Task 1: `anon_select_autos`, `anon_select_movimientos`; el insert se había cerrado después de la migración). No duplicar las que ya estén.

- [ ] **Step 2: Correr el SQL de schema + policies**

En **SQL Editor**, ejecutar (documentado también en el spec, `docs/superpowers/specs/2026-07-30-carga-backoffice-design.md`):

```sql
alter table autos add column anio int;
alter table autos add column color text;
alter table autos add column kilometraje numeric;

create table auto_fotos (
  id bigint generated always as identity primary key,
  auto_id bigint references autos(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);
alter table auto_fotos enable row level security;
create policy "anon_select_auto_fotos" on auto_fotos for select to anon using (true);
create policy "anon_insert_auto_fotos" on auto_fotos for insert to anon with check (true);
create policy "anon_delete_auto_fotos" on auto_fotos for delete to anon using (true);

create policy "anon_insert_autos" on autos for insert to anon with check (true);
create policy "anon_update_autos" on autos for update to anon using (true);
create policy "anon_insert_movimientos" on movimientos for insert to anon with check (true);
create policy "anon_update_movimientos" on movimientos for update to anon using (true);
create policy "anon_delete_movimientos" on movimientos for delete to anon using (true);
```

Expected: "Success", columnas nuevas visibles en **Table Editor → autos**, tabla `auto_fotos` creada, y todas las policies listadas en **Authentication → Policies**.

- [ ] **Step 3: Crear el bucket de Storage**

En **Storage**, crear un bucket nuevo llamado `auto-fotos`, marcado como **público**. En sus policies (Storage usa RLS sobre `storage.objects`), agregar policies que permitan `select`/`insert`/`delete` públicos para ese bucket específico (mismo criterio que las tablas: sin autenticación server-side real).

- [ ] **Step 4: Confirmar credenciales**

Confirmar que `SUPABASE_URL`/`SUPABASE_ANON_KEY` son las mismas que ya usa `index.html` (mismo proyecto) — no hace falta generar nada nuevo.

---

### Task 2: `carga.html` — esqueleto + tab Movimientos

**Files:**
- Create: `carga.html`

**Interfaces:**
- Consumes: `SUPABASE_URL`/`SUPABASE_ANON_KEY` (mismas que `index.html`), tablas `autos`/`movimientos`.
- Produces: alta de Compra/Venta/Gasto/Retiro, listado con filtro por patente, edición y borrado de movimientos.

- [ ] **Step 1: Esqueleto del archivo**

Partir de la estructura de `index.html`: mismo `<head>` (CSS vars, PIN screen, CDN de `supabase-js`), mismo bloque CONFIG (`PIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `supabaseClient`) y misma lógica de PIN (`pinPress`, `updateDots`). Reemplazar la tab-bar de 3 tabs por 2: **Movimientos** / **Autos**.

- [ ] **Step 2: Form de alta con selector de tipo**

Selector (tabs o `<select>`) para Compra/Venta/Gasto/Retiro de Socio, que muestra el subform correspondiente:
- Compra: patente, marca, modelo, fecha, valor, pagado por.
- Venta: dropdown de autos en stock (query a `autos` filtrando los que no tengan movimiento tipo Venta), fecha, valor, pagado por.
- Gasto: dropdown de todos los autos, fecha, valor, descripción, pagado por.
- Retiro de Socio: fecha, valor, pagado por (sin auto).

Al guardar Compra: `upsert` en `autos` por `patente` (`onConflict: 'patente'`), luego `insert` en `movimientos` con el `auto_id` resultante. Los demás tipos: `insert` directo en `movimientos` con el `auto_id` elegido (o `null` para Retiro).

- [ ] **Step 3: Listado + filtro + edición/borrado**

Debajo del form, lista de movimientos (`select` con join a `autos`, orden por `id` descendente), con input de texto que filtra client-side por patente. Tocar un item completa el form de arriba en modo edición (mismo subform según `tipo`, con los valores precargados) con botones "Guardar cambios" (`update` por `id`) y "Eliminar" (`delete` por `id`, con confirmación).

- [ ] **Step 4: Prueba manual básica**

Run: `open carga.html`
Expected: pantalla de PIN, ingresar `10500`, ver el form de Movimientos. No hacer submits reales todavía (Task 1 tiene que estar completo primero) — solo confirmar que la UI carga sin errores de JS en la consola.

---

### Task 3: `carga.html` — tab Autos (ficha + fotos)

**Files:**
- Modify: `carga.html`

**Interfaces:**
- Consumes: tabla `autos` (columnas `anio`/`color`/`kilometraje`), tabla `auto_fotos`, bucket `auto-fotos` (Task 1).
- Produces: edición de ficha de auto y galería de fotos.

- [ ] **Step 1: Lista de autos**

Tab Autos: lista simple (patente + marca/modelo) desde `autos`. Tocar uno abre su ficha.

- [ ] **Step 2: Ficha editable**

Inputs para `anio`, `color`, `kilometraje` (precargados con los valores actuales). "Guardar" hace `update` en `autos` por `id`.

- [ ] **Step 3: Galería de fotos**

- Listar miniaturas desde `auto_fotos` (`select` filtrado por `auto_id`), usando la `url` pública del bucket.
- Input de archivo (`multiple`) para subir: por cada archivo, `supabaseClient.storage.from('auto-fotos').upload(...)` con un path único (ej. `${auto_id}/${Date.now()}-${filename}`), después `insert` en `auto_fotos` con la URL pública (`getPublicUrl`).
- Botón de borrar por miniatura: `storage.from('auto-fotos').remove([path])` + `delete` en `auto_fotos` por `id`.

- [ ] **Step 4: Prueba manual básica**

Run: `open carga.html` (o recargar si ya estaba abierto)
Expected: tab Autos carga sin errores de consola. Sin datos todavía porque Task 1 recién se completó — se prueba de punta a punta en el Task 4.

---

### Task 4: QA con datos de prueba (sin pushear)

**Files:** Ninguno — solo interacción manual con `carga.html` local contra el Supabase real.

**Interfaces:**
- Consumes: `carga.html` completo (Tasks 2-3), Supabase provisionado (Task 1).
- Produces: confirmación de que todos los flujos funcionan y no rompen los datos/cálculos reales de `index.html` — habilita el Task 5.

- [ ] **Step 1: Cargar un auto de prueba**

En `carga.html`, cargar una Compra con patente `TEST123`, marca/modelo inventados, fecha y valor cualquiera.
Expected: aparece en el listado de Movimientos y en la tab Autos.

- [ ] **Step 2: Recorrer los 4 tipos de movimiento**

Cargar una Venta, un Gasto y un Retiro de Socio (el Retiro no necesita estar asociado a `TEST123`).
Expected: los 4 aparecen en el listado, con los montos correctos.

- [ ] **Step 3: Editar y borrar un movimiento**

Editar el Gasto cargado (cambiar el valor) y confirmar que se actualiza en el listado. Borrar el Retiro de prueba y confirmar que desaparece.

- [ ] **Step 4: Ficha y fotos**

En la tab Autos, abrir `TEST123`, completar año/color/kilometraje y guardar. Subir 2 fotos, confirmar que aparecen las miniaturas, borrar una y confirmar que desaparece.

- [ ] **Step 5: Verificar que no rompe `index.html`**

Abrir `index.html` (local, apuntando al mismo Supabase) y confirmar que el auto `TEST123` aparece en Stock o Vendidos según corresponda, con los montos esperados, y que el resto de los autos reales no cambió.

- [ ] **Step 6: Limpiar los datos de prueba**

Desde `carga.html`, borrar todos los movimientos de `TEST123` y el Gasto/Venta/Retiro de prueba cargados en el Step 2 (usando el flujo de edición/borrado del Task 2, Step 3). El auto `TEST123` puede quedar huérfano en `autos` (por diseño, no se borra en cascada) — si se quiere prolijo, borrarlo a mano desde el Table Editor de Supabase (no hay borrado de auto desde `carga.html`, es una decisión de diseño).

- [ ] **Step 7: Confirmar que `index.html` vuelve a los números originales**

Recargar `index.html` y confirmar: 14 autos, 5 vendidos, 9 en stock, misma ganancia y capital que antes de empezar la QA (mismo criterio de validación usado en la migración del sub-proyecto 1).

---

### Task 5: Commit y push (solo tras aprobación de Ariel)

**Files:**
- Add: `carga.html`

**Interfaces:**
- Consumes: QA aprobada (Task 4).
- Produces: `carga.html` disponible en producción (GitHub Pages).

- [ ] **Step 1: Confirmación explícita de Ariel**

No avanzar a los siguientes steps sin que Ariel confirme que la QA del Task 4 salió bien.

- [ ] **Step 2: Commit**

```bash
git add carga.html docs/superpowers/specs/2026-07-30-carga-backoffice-design.md docs/superpowers/plans/2026-07-30-carga-backoffice-plan.md
git commit -m "Add carga.html backoffice for loading movimientos and auto data"
```

- [ ] **Step 3: Push**

Solo con aprobación explícita adicional para pushear (no asumida por el commit) — mismo criterio que el resto del proyecto para acciones que afectan producción.
