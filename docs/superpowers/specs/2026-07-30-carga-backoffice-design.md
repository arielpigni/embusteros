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

**Revisión (2026-07-30):** el diseño original era mobile-first (tabs arriba, formularios apilados). Ariel pidió reorientarlo a desktop, con una identidad visual propia en vez de heredar el theme de `index.html`. Diseño validado con mockups (ver artifact de la sesión): sidebar fija a la izquierda (Movimientos / Autos, con lugar para sumar secciones futuras como "Carga por voz") + panel lateral (640px) para alta/edición, sin tapar la tabla de fondo. Paleta dark propia con soporte de tema claro (toggle en el header, persistido en `localStorage`), tipografía de sistema para todo lo editable y monoespaciada solo para cifras de solo lectura (tabla, resúmenes). Campos de un mismo formulario van en filas de a dos/tres para que Compra y Venta entren sin scroll en el panel.

### Tab "Movimientos"

Tabla real (no cards) con columnas Tipo/Auto/Fecha/Pagado por/Valor, filtro por patente y chips de tipo. "+ Nuevo movimiento" y click en una fila abren el panel lateral con selector de tipo → Compra / Venta / Gasto / Retiro de Socio:

- **Compra:** patente, marca, modelo, año, color, kilometraje, fecha, valor (ARS), pagado por — todo en un solo paso (a diferencia del diseño original, año/color/km ya no quedan relegados a la tab Autos). Al guardar: upsert en `autos` por `patente` (crea la fila si no existe) + insert en `movimientos`.
- **Venta:** buscador de auto (autos en stock) que al seleccionarlo muestra Compra + Gastos + Inversión + **Ganancia calculada en vivo** (`valor de venta − inversión`, recalculada en cada tecleo) + fecha + valor + pagado por.
- **Gasto:** buscador de auto (todos) + descripción + fecha + valor + pagado por.
- **Retiro de Socio:** selector de socio, y un dropdown que solo lista **autos vendidos con reparto pendiente para ese socio** (un auto puede estar retirado para uno y pendiente para los otros dos — el retiro se trackea por auto + socio, no por auto en general). Al elegir un auto se ve su ganancia total y el estado de los 3 socios (pills "retirado"/"pendiente"), y el monto sugerido es `ganancia ÷ 3`, editable. No tiene campo "pagado por" — el socio ya lo identifica el selector de arriba.
- **Pagado por (Compra/Venta/Gasto):** arranca siempre en **Fondo** (destacado, con check), con un link secundario "¿Pagó un socio en su lugar?" que despliega Ariel/Miguel/Martin solo si hace falta — refleja que la gran mayoría de los movimientos los paga el fondo común, no un socio directamente.

**Edición/borrado:** click en una fila de la tabla abre el mismo panel precargado, con "Guardar cambios" y "Eliminar".

**Borrado de Compra:** si se borra el movimiento de Compra de un auto, la fila en `autos` no se borra en cascada — evita perder ficha/fotos por error. Queda huérfana hasta que se le cargue una Compra nueva o se gestione a mano.

### Tab "Autos"

Lista de autos (patente + marca/modelo). Tocar uno abre su ficha:

- Campos editables: año, color, kilometraje (ya se completan típicamente al cargar la Compra, pero quedan editables acá también).
- Galería de fotos: subir nuevas (múltiples), ver miniaturas, borrar individualmente.

No se borra el auto en sí desde acá.

## Rollback

`carga.html` es un archivo nuevo y aislado — no modifica `index.html` ni ningún archivo existente. Si algo sale mal, se elimina o se deja de linkear sin ningún impacto en la app de lectura. Los cambios de schema/RLS en Supabase (nuevas columnas, `auto_fotos`, policies) son aditivos y no rompen las queries que ya hace `index.html`.
