# Migración de Google Sheets a Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar Google Sheets como fuente de datos de la PWA Embusteros por Supabase (Postgres), sin cambiar en nada el comportamiento visible de la app.

**Architecture:** Dos tablas nuevas en Supabase (`autos`, `movimientos`) reemplazan al Sheet. Un script Node one-off migra los datos históricos. El frontend (`index.html`) sigue siendo un archivo único estático sin build tools; solo se le agrega el cliente `supabase-js` vía CDN y se reemplaza la función `loadData()` para leer de Supabase en vez de Apps Script.

**Tech Stack:** Supabase (Postgres + `supabase-js` v2), Node.js (script de migración, ESM), HTML/CSS/JS vanilla (frontend, sin cambios de stack).

## Global Constraints

- No modificar el comportamiento visible de la app: mismas pantallas, mismo PIN, mismos cálculos (`buildCars`, `calcIndicadores`, `getRetirosPorMes`), mismo diseño.
- No tocar `SHEET_URL`/`Code.gs`/el Google Sheet hasta el corte final del Task 5 — quedan como rollback.
- Seguridad de escrituras = mismo nivel que hoy: `anon key` pública en el JS del cliente, sin validación server-side del PIN.
- Frontend sin frameworks ni build tools — `supabase-js` se agrega solo como `<script>` CDN, nada de npm/bundlers en `index.html`.
- Este proyecto no tiene test runner (es HTML/JS vanilla de archivo único). La verificación de cada task es manual/por consola, no automatizada — se documenta explícitamente qué correr y qué resultado esperar en cada paso.
- No se crea ningún archivo de más allá de lo que cada task necesita (nada de abstracciones o helpers no usados).

---

### Task 1: Provisionar el proyecto Supabase (schema + RLS)

**Files:** Ninguno en el repo — este task se hace en el dashboard de Supabase (supabase.com). No requiere Claude Code, lo ejecuta Ariel directamente.

**Interfaces:**
- Produces: un proyecto Supabase con `SUPABASE_URL` y `SUPABASE_ANON_KEY`, y las tablas `autos`/`movimientos` con RLS habilitado — que los Tasks 2-5 van a consumir.

- [ ] **Step 1: Crear proyecto en Supabase**

Ir a https://supabase.com/dashboard, crear una cuenta si no existe, y crear un nuevo proyecto (nombre sugerido: `embusteros`). Elegir la región más cercana (ej. South America). Guardar la contraseña de la base que pide al crear el proyecto (no hace falta para lo que sigue, pero conviene guardarla).

- [ ] **Step 2: Crear el schema**

En el dashboard, ir a **SQL Editor** → **New query**, pegar y ejecutar (Run):

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
  tipo        text not null,
  fecha       timestamptz not null,
  valor       numeric not null,
  pagado_por  text,
  descripcion text
);
```

Expected: "Success. No rows returned" y ambas tablas visibles en **Table Editor**.

- [ ] **Step 3: Habilitar RLS y policies**

En el mismo **SQL Editor**, correr:

```sql
alter table autos enable row level security;
alter table movimientos enable row level security;

create policy "anon_select_autos" on autos for select to anon using (true);
create policy "anon_insert_autos" on autos for insert to anon with check (true);
create policy "anon_select_movimientos" on movimientos for select to anon using (true);
create policy "anon_insert_movimientos" on movimientos for insert to anon with check (true);
```

Expected: "Success. No rows returned". Verificar en **Authentication → Policies** que las 4 policies aparecen listadas.

- [ ] **Step 4: Copiar credenciales**

Ir a **Project Settings → API**. Copiar:
- **Project URL** (`https://xxxxx.supabase.co`)
- **anon public** key (la clave larga, no la `service_role`)

Guardarlos en un lugar temporal (van a usarse en los Tasks 2 y 4/5). No commitear estos valores todavía a ningún archivo del repo salvo donde el plan lo indique explícitamente.

---

### Task 2: Escribir el script de migración (dry-run)

**Files:**
- Create: `migration/package.json`
- Create: `migration/migrate.js`
- Create: `migration/.env.example`
- Create: `migration/.gitignore`

**Interfaces:**
- Consumes: `SHEET_URL` (mismo endpoint de Apps Script que usa hoy `index.html`), `SUPABASE_URL`/`SUPABASE_ANON_KEY` del Task 1.
- Produces: comando `node migrate.js` (dry-run, no escribe) y `node migrate.js --write` (Task 3 lo usa para migrar de verdad).

- [ ] **Step 1: Crear `migration/package.json`**

```json
{
  "name": "embusteros-migration",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Step 2: Crear `migration/.env.example`**

```
SHEET_URL=https://script.google.com/macros/s/AKfycbyLElerFX73_c4y5lfmqE0XDxMCLccoOXQBZB5puSYjapA2UPyZrs2uyAqM2ZuEYNHQ/exec
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
```

- [ ] **Step 3: Crear `migration/.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 4: Crear `migration/migrate.js`**

```js
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SHEET_URL          = process.env.SHEET_URL;
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY;
const WRITE              = process.argv.includes('--write');

if (!SHEET_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Faltan variables de entorno. Copiá migration/.env.example a migration/.env y completá los valores.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function buildCarsMini(movs) {
  const cars = {};
  movs.forEach(m => {
    const k = m.patente;
    if (!cars[k]) cars[k] = { patente: k, marca: m.marca, modelo: m.modelo, compra: 0, gastos: 0, venta: 0 };
    if      (m.tipo === 'Compra') cars[k].compra += m.valor;
    else if (m.tipo === 'Gasto')  cars[k].gastos += m.valor;
    else if (m.tipo === 'Venta')  cars[k].venta  += m.valor;
  });
  Object.values(cars).forEach(c => {
    c.vendido   = c.venta > 0;
    c.inversion = c.compra + c.gastos;
    c.ganancia  = c.vendido ? (c.venta - c.inversion) : null;
  });
  return cars;
}

function summarize(cars) {
  const list     = Object.values(cars);
  const vendidos = list.filter(c => c.vendido);
  const enStock  = list.filter(c => !c.vendido);
  return {
    totalAutos:     list.length,
    vendidos:       vendidos.length,
    enStock:        enStock.length,
    gananciaTotal:  Math.round(vendidos.reduce((s, c) => s + c.ganancia, 0)),
    inversionStock: Math.round(enStock.reduce((s, c) => s + c.inversion, 0)),
  };
}

async function main() {
  console.log(`Modo: ${WRITE ? 'WRITE (inserta en Supabase)' : 'DRY-RUN (solo lee y muestra resumen)'}`);

  const res  = await fetch(SHEET_URL);
  const rows = await res.json();
  const movs = rows
    .filter(r => r['Patente'] && r['Tipo'])
    .map(r => ({
      fecha:   r['Fecha'],
      tipo:    r['Tipo']        || '',
      patente: r['Patente']     || '',
      marca:   r['Marca']       || '',
      modelo:  r['Modelo']      || '',
      pagado:  r['Pagado por']  || '',
      desc:    r['Descripcion'] || '',
      valor:   parseFloat(r['Valor']) || 0,
    }));

  const sourceTotals = summarize(buildCarsMini(movs));
  console.log('Totales en el Sheet:', sourceTotals);

  if (!WRITE) {
    console.log('Dry-run: no se insertó nada. Corré con --write para migrar de verdad.');
    return;
  }

  const { count: autosExistentes } = await supabase.from('autos').select('*', { count: 'exact', head: true });
  const { count: movsExistentes }  = await supabase.from('movimientos').select('*', { count: 'exact', head: true });
  if ((autosExistentes ?? 0) > 0 || (movsExistentes ?? 0) > 0) {
    console.error('Las tablas ya tienen datos. Abortando para evitar duplicados. Vaciá autos/movimientos en Supabase si querés re-migrar.');
    process.exit(1);
  }

  const autosMap = new Map();
  movs.forEach(m => {
    if (!autosMap.has(m.patente)) autosMap.set(m.patente, { patente: m.patente, marca: m.marca, modelo: m.modelo });
  });

  const { data: autosInsertados, error: errAutos } = await supabase
    .from('autos')
    .insert(Array.from(autosMap.values()))
    .select('id, patente');
  if (errAutos) { console.error('Error insertando autos:', errAutos); process.exit(1); }

  const idPorPatente = new Map(autosInsertados.map(a => [a.patente, a.id]));

  const movsParaInsertar = movs.map(m => ({
    auto_id:     idPorPatente.get(m.patente),
    tipo:        m.tipo,
    fecha:       m.fecha,
    valor:       m.valor,
    pagado_por:  m.pagado,
    descripcion: m.desc,
  }));

  const { error: errMovs } = await supabase.from('movimientos').insert(movsParaInsertar);
  if (errMovs) { console.error('Error insertando movimientos:', errMovs); process.exit(1); }

  console.log(`Insertados ${autosInsertados.length} autos y ${movsParaInsertar.length} movimientos.`);

  const { data: verifRows, error: errVerif } = await supabase
    .from('movimientos')
    .select('tipo, valor, autos(patente, marca, modelo)');
  if (errVerif) { console.error('Error verificando:', errVerif); process.exit(1); }

  const verifMovs    = verifRows.map(r => ({ tipo: r.tipo, valor: r.valor, patente: r.autos.patente, marca: r.autos.marca, modelo: r.autos.modelo }));
  const targetTotals = summarize(buildCarsMini(verifMovs));
  console.log('Totales en Supabase:', targetTotals);

  const coinciden = JSON.stringify(sourceTotals) === JSON.stringify(targetTotals);
  console.log(coinciden ? '✅ VALIDACIÓN OK: los totales coinciden.' : '❌ VALIDACIÓN FALLÓ: los totales no coinciden.');
  if (!coinciden) process.exit(1);
}

main();
```

- [ ] **Step 5: Instalar dependencias**

Run: `cd migration && npm install`
Expected: se crea `migration/node_modules` y `migration/package-lock.json` sin errores.

- [ ] **Step 6: Crear `migration/.env` local con las credenciales del Task 1**

Copiar `migration/.env.example` a `migration/.env` (este archivo NO se commitea, está en `.gitignore`) y completar `SUPABASE_URL`/`SUPABASE_ANON_KEY` con los valores reales copiados en el Task 1, Step 4. `SHEET_URL` ya viene con el valor correcto en el ejemplo.

- [ ] **Step 7: Correr dry-run**

Run: `cd migration && node migrate.js`
Expected: imprime `Modo: DRY-RUN...`, después `Totales en el Sheet: { totalAutos: N, vendidos: N, enStock: N, gananciaTotal: N, inversionStock: N }` con números (no errores), y termina con "Dry-run: no se insertó nada.".

- [ ] **Step 8: Comparar los totales del dry-run contra el dashboard actual**

Abrir la app actual (producción, apuntando todavía al Sheet) y anotar: cantidad "En stock", cantidad "Vendidos", "Ganancia" (redondeando el valor de `fmtK` a un número entero), "Invertido". Confirmar que coinciden con `Totales en el Sheet` del Step 7. Si no coinciden, no seguir — revisar el mapeo del script contra `buildCars()` en `index.html` antes de continuar.

- [ ] **Step 9: Commit**

```bash
git add migration/package.json migration/migrate.js migration/.env.example migration/.gitignore
git commit -m "Add one-off migration script from Google Sheets to Supabase"
```

---

### Task 3: Ejecutar la migración real y validar

**Files:** Ninguno nuevo — usa `migration/migrate.js` del Task 2 y el proyecto Supabase del Task 1.

**Interfaces:**
- Consumes: `node migrate.js --write` (Task 2).
- Produces: tablas `autos`/`movimientos` en Supabase pobladas con los datos históricos — que el Task 4 va a leer.

- [ ] **Step 1: Correr la migración real**

Run: `cd migration && node migrate.js --write`
Expected: imprime `Modo: WRITE...`, `Totales en el Sheet: {...}`, luego `Insertados N autos y M movimientos.`, `Totales en Supabase: {...}` y finalmente `✅ VALIDACIÓN OK: los totales coinciden.`

- [ ] **Step 2: Si falla la validación**

Si imprime `❌ VALIDACIÓN FALLÓ`, no continuar al Task 4. En el **Table Editor** de Supabase, vaciar `movimientos` y `autos` (en ese orden, por la foreign key) y volver a correr desde el Step 1 después de corregir el script.

- [ ] **Step 3: Confirmación visual en Supabase**

En **Table Editor → autos**, confirmar que la cantidad de filas coincide con la cantidad de patentes únicas del Sheet. En **movimientos**, confirmar que la cantidad de filas coincide con la cantidad total de movimientos con Patente+Tipo del Sheet.

No hay commit en este task — es solo ejecución contra Supabase, no cambia archivos del repo.

---

### Task 4: Armar y validar `index.test.html` contra Supabase (local, sin commitear)

**Files:**
- Create (temporal, no se commitea): `index.test.html`

**Interfaces:**
- Consumes: `SUPABASE_URL`/`SUPABASE_ANON_KEY` (Task 1), tablas pobladas (Task 3).
- Produces: confirmación manual de que el nuevo `loadData()` reproduce exactamente la app actual — el Task 5 aplica el mismo cambio a `index.html`.

- [ ] **Step 1: Copiar `index.html` a `index.test.html`**

Run: `cp index.html index.test.html`

- [ ] **Step 2: Agregar el script CDN de supabase-js**

En `index.test.html`, antes de la línea `<script>` que abre el bloque de JS de la app (justo después de `<link rel="apple-touch-icon" href="icon-192.png">` y antes de `</head>` o al inicio de `<body>` — en la práctica alcanza con ponerlo inmediatamente antes del `<script>` existente), agregar:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

- [ ] **Step 3: Reemplazar el bloque CONFIG**

Buscar en `index.test.html`:

```js
const PIN = '10500';
// Pegá acá la URL de tu Web App de Apps Script después de publicarla:
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyLElerFX73_c4y5lfmqE0XDxMCLccoOXQBZB5puSYjapA2UPyZrs2uyAqM2ZuEYNHQ/exec';
```

Reemplazar por (con los valores reales del Task 1, Step 4):

```js
const PIN = '10500';
const SUPABASE_URL = 'https://tu-proyecto.supabase.co';
const SUPABASE_ANON_KEY = 'tu-anon-key';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- [ ] **Step 4: Reemplazar `loadData()`**

Buscar el bloque:

```js
    const res  = await fetch(SHEET_URL);
    const rows = await res.json();
    movimientos = rows
      .filter(r => r['Patente'] && r['Tipo'])
      .map(r => ({
        fecha:   formatFecha(r['Fecha'])  || '',
        tipo:    r['Tipo']        || '',
        patente: r['Patente']     || '',
        marca:   r['Marca']       || '',
        modelo:  r['Modelo']      || '',
        pagado:  r['Pagado por']  || '',
        desc:    r['Descripcion'] || '',
        valor:   parseFloat(r['Valor']) || 0,
      }));
```

Reemplazar por:

```js
    const { data: rows, error } = await supabaseClient
      .from('movimientos')
      .select('tipo, fecha, valor, pagado_por, descripcion, autos(patente, marca, modelo)');
    if (error) throw error;
    movimientos = rows
      .filter(r => r.autos && r.autos.patente && r.tipo)
      .map(r => ({
        fecha:   formatFecha(r.fecha) || '',
        tipo:    r.tipo               || '',
        patente: r.autos.patente      || '',
        marca:   r.autos.marca        || '',
        modelo:  r.autos.modelo       || '',
        pagado:  r.pagado_por         || '',
        desc:    r.descripcion        || '',
        valor:   parseFloat(r.valor)  || 0,
      }));
```

El resto de `loadData()` (manejo de `CARS`, `console.log`, `render()`, el `catch`) queda igual, sin tocar.

- [ ] **Step 5: Abrir `index.test.html` en el navegador**

Run: `open index.test.html` (macOS) o doble-click en Finder.
Expected: pantalla de PIN. Ingresar `10500` y ver el Dashboard cargar sin error "No se pudieron cargar los datos.".

- [ ] **Step 6: Comparar pantalla por pantalla contra la app de producción**

Con la app de producción (GitHub Pages, apuntando todavía al Sheet) abierta en otra pestaña, comparar en `index.test.html`:
- Dashboard: las 6 métricas (En stock, Vendidos, Ganancia, Invertido, Días prom., Margen prom.) — mismos números.
- Gráfico "retiros mensuales por socio" — mismo acumulado y mismas barras por mes.
- Tab Stock — misma lista de autos, mismos montos por tarjeta.
- Tab Vendidos — misma lista, mismos montos.
- Detalle de un auto vendido y uno en stock — mismos datos y misma lista de gastos en el mismo orden.

Si algo no coincide, no avanzar al Task 5 — diagnosticar contra el Step 4 de este task (el mapeo de campos) o contra el Task 3 (los datos migrados).

- [ ] **Step 7: Borrar el archivo de prueba**

Run: `rm index.test.html`

Es un archivo temporal de QA local — no se commitea nunca al repo.

---

### Task 5: Cortar producción a Supabase

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: el mismo cambio validado manualmente en el Task 4.
- Produces: la app en producción (GitHub Pages) leyendo de Supabase.

- [ ] **Step 1: Aplicar en `index.html` los mismos 3 cambios validados en el Task 4** (CDN script tag, bloque CONFIG, `loadData()`), usando los valores reales de `SUPABASE_URL`/`SUPABASE_ANON_KEY`.

- [ ] **Step 2: Verificar visualmente que no quedan referencias a `SHEET_URL` en `index.html`**

Run: `grep -n "SHEET_URL" index.html`
Expected: sin resultados (no output).

- [ ] **Step 3: Probar localmente una vez más**

Run: `open index.html`
Expected: mismo comportamiento verificado en el Task 4, Step 6, ahora sobre el archivo real.

- [ ] **Step 4: Commit y push**

```bash
git add index.html
git commit -m "Switch data source from Google Sheets to Supabase"
git push
```

- [ ] **Step 5: Verificar el deploy en GitHub Pages**

Esperar ~1 minuto, abrir la URL de producción (`https://arielpigni.github.io/embusteros/`), forzar recarga, ingresar el PIN y repetir la comparación del Task 4 Step 6 contra lo que se veía antes del cambio.

- [ ] **Step 6: Confirmación final**

Recargar la app en el celular (o tocar ↻ en el header) y confirmar que carga bien. A partir de acá, el Google Sheet queda como archivo histórico — no se le vuelve a cargar nada a mano.

No hay rollback automatizado: si algo falla en producción, `git revert` del commit del Step 4 restaura `SHEET_URL` de inmediato (el Sheet y `Code.gs` no se tocaron en ningún momento de este plan).
