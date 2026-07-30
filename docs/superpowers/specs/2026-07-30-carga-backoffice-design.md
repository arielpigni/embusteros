# Backoffice de carga — `carga.html`

## Contexto

Con el backend ya migrado a Supabase (sub-proyecto 1, listo en `main` local pero sin pushear a `origin/main`), la carga de movimientos sigue dependiendo del Sheet a mano — y deja de tener sentido en cuanto `index.html` lea de Supabase en producción. Este documento es el diseño del **segundo sub-proyecto**: un formulario web simple y rápido para que Ariel, Miguel y Martin carguen Compra/Venta/Gasto/Retiro directamente contra Supabase.

Durante el diseño se amplió el alcance para incluir también ficha extendida del auto (año/color/kilometraje) y galería de fotos. Estaba planeado como sub-proyecto 3 aparte usando Cloudinary, pero como ya existe la infraestructura de Supabase (incluyendo Storage), se resuelve acá en el mismo formulario en vez de sumar un proveedor externo nuevo.

1. Backend — sub-proyecto 1, hecho.
2. **Formulario/backoffice de carga (este documento)** — reemplaza la carga manual del Sheet, incluye ficha extendida de auto y fotos.
3. ~~Fotos de auto (Cloudinary)~~ — absorbido por este sub-proyecto (ver arriba), usando Supabase Storage en vez de Cloudinary.
4. Carga por voz con AI — depende de este formulario, no arrancado.

## Objetivo de este sub-proyecto

Una herramienta de escritura contra Supabase, separada de la app de lectura, para cargar y mantener movimientos y datos de autos sin tocar el Sheet.

## No-objetivos (fuera de alcance)

- Mostrar fotos/año/color/kilometraje en `index.html` — paso siguiente, acotado y validado aparte.
- Carga por voz / AI — sub-proyecto 4.
- Login individual por socio — se mantiene el PIN compartido `10500`.
- Borrado de un auto en sí (para no generar movimientos huérfanos) — solo se edita su ficha y fotos.
- Ambiente de test separado — se prueba con datos descartables en el mismo proyecto Supabase (ver Plan de QA en el plan de implementación).

## Arquitectura

- Archivo nuevo y separado, `carga.html`, mismo patrón que `index.html`: HTML + CSS + JS inline, sin build tools, cliente `supabase-js` vía CDN, mismo PIN `10500` como gate de acceso.
- No se toca `index.html`, `Code.gs` ni el Sheet.
- Mismo nivel de exposición de seguridad que el resto del proyecto: `anon key` pública en el JS, RLS abierta, el PIN es un chequeo de UI (no criptográfico) — documentado también en el spec del sub-proyecto 1.

## Modelo de datos — cambios en Supabase

```sql
-- Nuevas columnas en autos
alter table autos add column anio int;
alter table autos add column color text;
alter table autos add column kilometraje numeric;

-- Galería de fotos
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

-- Reabrir insert en autos/movimientos (se había cerrado tras la migración) + agregar update/delete
create policy "anon_insert_autos" on autos for insert to anon with check (true);
create policy "anon_update_autos" on autos for update to anon using (true);
create policy "anon_insert_movimientos" on movimientos for insert to anon with check (true);
create policy "anon_update_movimientos" on movimientos for update to anon using (true);
create policy "anon_delete_movimientos" on movimientos for delete to anon using (true);
```

Más un bucket de Supabase Storage público (ej. `auto-fotos`) con policies que permitan `insert`/`select`/`delete` públicos.

Este SQL y la creación del bucket los corre Ariel manualmente en el SQL editor / dashboard de Supabase — Claude no tiene credenciales del proyecto. Antes de crear las policies de `autos`/`movimientos` hay que verificar cuáles ya existen (se crearon algunas en el Task 1 del sub-proyecto 1) para no duplicar.

## Navegación y UI

Dos tabs (reemplazan Dashboard/Stock/Vendidos de `index.html`): **Movimientos** y **Autos**. Reutiliza el theme dark y variables CSS de `index.html` (`--bg0/1/2/3`, `--blue`, etc.), con controles de formulario (inputs, selects, date picker, file input) en vez de tarjetas de dashboard. Mismo ancho ~430px centrado.

### Tab "Movimientos"

**Alta** — selector de tipo → Compra / Venta / Gasto / Retiro de Socio:

- **Compra:** patente, marca, modelo, fecha, valor (ARS), pagado por. Al guardar: upsert en `autos` por `patente` (crea la fila si no existe) + insert en `movimientos`. Año/color/kilometraje/fotos **no** se piden acá — se cargan después en la tab Autos, para mantener el alta rápida.
- **Venta:** dropdown de autos en stock (sin movimiento Venta todavía) + fecha + valor + pagado por.
- **Gasto:** dropdown de todos los autos + fecha + valor + descripción + pagado por.
- **Retiro de Socio:** sin auto asociado — fecha, valor, pagado por (socio).
- Campo común "pagado por": dropdown Ariel/Miguel/Martin.

**Listado + edición/borrado:** lista de últimos movimientos (más reciente primero) con filtro de texto por patente. Tocar un item abre el mismo form precargado en modo edición, con "Guardar cambios" y "Eliminar".

**Borrado de Compra:** si se borra el movimiento de Compra de un auto, la fila en `autos` no se borra en cascada — evita perder ficha/fotos por error. Queda huérfana hasta que se le cargue una Compra nueva o se gestione a mano.

### Tab "Autos"

Lista de autos (patente + marca/modelo). Tocar uno abre su ficha:

- Campos editables: año, color, kilometraje.
- Galería de fotos: subir nuevas (múltiples), ver miniaturas, borrar individualmente.

No se borra el auto en sí desde acá.

## Rollback

`carga.html` es un archivo nuevo y aislado — no modifica `index.html` ni ningún archivo existente. Si algo sale mal, se elimina o se deja de linkear sin ningún impacto en la app de lectura. Los cambios de schema/RLS en Supabase (nuevas columnas, `auto_fotos`, policies) son aditivos y no rompen las queries que ya hace `index.html`.
