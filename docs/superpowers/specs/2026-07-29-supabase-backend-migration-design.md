# Migración de Google Sheets a Supabase — Backend

## Contexto

Embusteros SRL hoy usa un Google Sheet ("Movimientos") + Apps Script (`Code.gs`, `doGet`) como fuente de datos de solo lectura para la PWA. El plan de más largo plazo es dejar de depender de Sheets: agregar un formulario de carga en la app, subida de fotos de autos, y carga de datos por voz usando una AI. Esas tres cosas requieren un backend real (base de datos + storage + posibilidad de lógica server-side), algo que Sheets/Apps Script no da cómodamente.

Este documento es el diseño del **primer sub-proyecto**: migrar la fuente de datos de Google Sheets a Supabase, sin tocar todavía la UI/UX ni agregar capacidad de escritura desde la app. Es la base de la que dependen los sub-proyectos siguientes:

1. **Backend (este documento)** — reemplazar Sheets por Supabase.
2. Formulario web de carga (Compra/Venta/Gasto/Retiro/Auto) contra Supabase.
3. Carga de fotos de auto (Supabase Storage).
4. Carga por voz con AI (transcripción → formulario).

## Objetivo de este sub-proyecto

Reemplazar Google Sheets como fuente de datos de la app por Supabase (Postgres), preservando exactamente el comportamiento actual de la app: mismas pantallas, mismo PIN, mismos cálculos, mismo diseño. El usuario final no debe notar ninguna diferencia funcional.

## No-objetivos (fuera de alcance)

- Formulario de carga de movimientos — sub-proyecto 2.
- Subida/gestión de fotos — sub-proyecto 3.
- Carga por voz / AI — sub-proyecto 4.
- Login individual por socio — se mantiene el PIN compartido `10500`.
- Autenticación server-side de las escrituras — mismo nivel de seguridad que hoy (el PIN es un chequeo de UI, no criptográfico; la `anon key` de Supabase queda pública en el JS, igual que la URL de Apps Script lo está hoy).

## Arquitectura

- Supabase (Postgres) reemplaza al Sheet + `Code.gs` como fuente de datos.
- El frontend sigue siendo estático (`index.html` en GitHub Pages, sin build tools). Se agrega el cliente `supabase-js` vía `<script>` CDN.
- Se usa la `anon key` pública de Supabase directamente desde el JS del cliente.
- Row Level Security (RLS) habilitado en ambas tablas, con policies abiertas de `select` e `insert` para el rol `anon` — mismo nivel de exposición que tiene hoy el endpoint de Apps Script (sin autenticación real del lado del servidor).

## Modelo de datos

Normalizado en dos tablas (en vez de la única fila plana que usa hoy el Sheet), incluyendo solo las columnas que la app realmente lee hoy:

```sql
create table autos (
  id      bigint generated always as identity primary key,
  patente text unique not null,
  marca   text,
  modelo  text
);

create table movimientos (
  id          bigint generated always as identity primary key,
  auto_id     bigint references autos(id),
  tipo        text not null,        -- Compra | Venta | Gasto | Retiro de Socio
  fecha       timestamptz not null,
  valor       numeric not null,
  pagado_por  text,
  descripcion text
);
```

Columnas del Sheet que la app no usa hoy (`Origen`, `Moneda`, `Monto`, `Tasa USD/ARS`, `Equiv. ARS`, `Fondo ARS`, `Fondo`) **no se migran**. Si un sub-proyecto futuro las necesita (ej. el form o la carga por voz), se agregan con `ALTER TABLE` en ese momento.

## Cambios en el frontend

Cambio acotado a la función `loadData()` en `index.html`:

- Reemplaza `fetch(SHEET_URL)` por un query a Supabase (`movimientos` con join a `autos`).
- Reconstruye el mismo array `movimientos` con la forma actual `{fecha, tipo, patente, marca, modelo, pagado, desc, valor}`.
- `formatFecha()` sigue aplicando el mismo formato UTC sobre el valor `fecha` que devuelve Supabase (timestamptz), sin cambios en su lógica.

Todo lo demás (`buildCars`, `calcIndicadores`, `getRetirosPorMes`, `render*`, PIN, navegación, CSS) **no se modifica**.

## Migración de datos históricos

Script Node one-off, fuera del archivo único de la app (carpeta `/migration`, no se despliega):

1. Lee todos los movimientos actuales desde el mismo endpoint de Apps Script que usa hoy la app.
2. Agrupa por `Patente` para poblar `autos` (una fila por patente única, con su marca/modelo).
3. Inserta cada movimiento en `movimientos` con su `auto_id` correspondiente.
4. Corre una validación automática al final: compara cantidad de autos, cantidad de vendidos/en stock, ganancia total e invertido total entre lo que devuelve el Sheet actual y lo que quedó en Supabase. Si no coinciden, el script reporta el diff y no se considera la migración válida.

## Plan de QA antes del corte (crítico)

No se toca el flujo actual de producción hasta validar el nuevo camino de punta a punta. Concretamente:

1. El schema y la migración se corren contra un proyecto Supabase, y se corre el script de validación (paso 4 arriba) hasta que los totales coincidan exactamente con los del dashboard actual.
2. Se arma una copia de prueba de `index.html` (ej. `index.test.html`, no enlazada desde `manifest.json`/`sw.js`, no parte del flujo de usuarios) con `loadData()` apuntando a Supabase. Se abre esa copia directamente y se compara pantalla por pantalla contra la app actual: Dashboard (las 6 métricas + gráfico de retiros), Stock, Vendidos, y el detalle de al menos un auto vendido y uno en stock.
3. Solo cuando la copia de prueba coincide 1:1 con la producción actual, se aplica el cambio de `loadData()` al `index.html` real, se commitea y se pushea a `main`.
4. El Sheet queda de solo archivo histórico — no se le vuelve a cargar nada a mano después del corte.

## Rollback

Si algo falla después del corte, `git revert` del commit que cambió `loadData()` vuelve a apuntar a `SHEET_URL` de inmediato — el Sheet y `Code.gs` no se tocan ni se dan de baja durante este sub-proyecto, quedan intactos como red de seguridad.
