# Fotos de auto en index.html Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show car photos (already uploaded via `carga.html` to Supabase Storage) in the read-only `index.html` app: a thumbnail on car-cards (Stock/Vendidos) and a horizontal-scroll carousel in the car detail view.

**Architecture:** `loadData()` gains a second Supabase query against `auto_fotos`, joined to `CARS` by `auto_id` (captured via the existing `movimientos → autos` join). `carCard()` and `renderDetail()` conditionally render an `<img>`/carousel when `c.fotos.length > 0`, with zero layout change when a car has no photos. No new libraries — carousel uses native CSS scroll-snap.

**Tech Stack:** Vanilla JS, Supabase JS client (already loaded), no build step, single file (`index.html`).

## Global Constraints

- Single file `index.html`, HTML+CSS+JS inline, no frameworks/build tools (per project CLAUDE.md).
- Follow the existing UTC-safe date handling pattern if any date logic is touched (not expected in this plan).
- No automated test suite exists — verification is manual, via a local server and browser devtools, per the design spec's QA section.
- Do not push to `origin/main` until Ariel has QA'd locally (see Task 5).
- RLS on Supabase: `select` is public, so no auth changes needed to read `auto_fotos`.

---

## Task 1: Fetch auto_id and auto_fotos, attach `c.fotos` to CARS

**Files:**
- Modify: `index.html:244` (movimientos query `.select(...)`)
- Modify: `index.html:246-254` (row mapping in `loadData()`)
- Modify: `index.html:199-216` (`buildCars()`)
- Modify: `index.html:237-268` (`loadData()` — add `auto_fotos` query + attach `fotos`)

**Interfaces:**
- Produces: `CARS[patente].fotos` — `string[]` of public image URLs, ordered oldest-first, empty array when the car has no photos. `CARS[patente].autoId` — number, the Supabase `autos.id` (internal, not used outside this task and Task 4's QA).

- [ ] **Step 1: Add `id` to the autos join and capture `autoId` per movimiento**

In `index.html`, change the query select string (currently `'tipo, fecha, valor, pagado_por, descripcion, autos(patente, marca, modelo)'`) to include `id`:

```javascript
    const { data: rows, error } = await supabaseClient
      .from('movimientos')
      .select('tipo, fecha, valor, pagado_por, descripcion, autos(id, patente, marca, modelo)')
      .order('id', { ascending: true });
```

Then in the `.map(r => ({...}))` mapping right below, add `autoId` alongside the existing fields:

```javascript
    movimientos = rows
      .filter(r => r.autos && r.autos.patente && r.tipo)
      .map(r => ({
        fecha:   formatFecha(r.fecha)  || '',
        tipo:    r.tipo        || '',
        patente: r.autos.patente     || '',
        marca:   r.autos.marca       || '',
        modelo:  r.autos.modelo      || '',
        pagado:  r.pagado_por  || '',
        desc:    r.descripcion || '',
        valor:   parseFloat(r.valor) || 0,
        autoId:  r.autos.id,
      }));
```

- [ ] **Step 2: Capture `autoId` on each car in `buildCars()`**

In `buildCars()`, when a new car entry is created, also set `autoId` from the movimiento (every movimiento for a given patente carries the same `autoId`, so setting it once on creation is enough):

```javascript
function buildCars(movs) {
  const cars = {};
  movs.forEach(m => {
    const k = m.patente;
    if (!cars[k]) cars[k] = {patente:k, marca:m.marca, modelo:m.modelo, autoId:m.autoId, movs:[], compra:0, gastos:0, venta:0, retiros:0, fechaCompra:null, fechaVenta:null};
    cars[k].movs.push(m);
```

(Only the object literal on the `if (!cars[k])` line changes — add `autoId:m.autoId,` after `modelo:m.modelo,`. The rest of the function is unchanged.)

- [ ] **Step 3: Query `auto_fotos` and attach `fotos` to each car**

In `loadData()`, right after `CARS = buildCars(movimientos);` (currently followed by the `console.log('Retiros fechas:'...)` line), add a photos query and attach it:

```javascript
    CARS = buildCars(movimientos);
    const { data: fotosRows, error: fotosError } = await supabaseClient
      .from('auto_fotos')
      .select('auto_id, url, created_at')
      .order('created_at', { ascending: true });
    if (fotosError) throw fotosError;
    const fotosByAutoId = {};
    (fotosRows || []).forEach(f => {
      (fotosByAutoId[f.auto_id] ||= []).push(f.url);
    });
    Object.values(CARS).forEach(c => { c.fotos = fotosByAutoId[c.autoId] || []; });
    console.log('Retiros fechas:', movimientos.filter(m=>m.tipo==='Retiro de Socio').map(m=>m.fecha));
```

- [ ] **Step 4: Verify manually via local server + devtools**

Run: `python3 -m http.server 8080` from the project root, open `http://localhost:8080/index.html` in a browser, enter the PIN (`10500`).

Open devtools console and run:

```javascript
Object.values(CARS)[0]
```

Expected: the logged car object has an `autoId` (a number) and a `fotos` key equal to `[]` (no photos uploaded yet — that's expected and correct at this point). No errors in the console, and the app still renders normally (dashboard, Stock, Vendidos, detail views all unchanged, since nothing consumes `fotos` yet).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Fetch auto_fotos and attach photo URLs to CARS"
```

---

## Task 2: Upload test photos via carga.html (QA fixture)

**Files:** none (data-only step against the real Supabase backend, using the existing `carga.html` tool)

**Interfaces:**
- Consumes: `carga.html`'s existing photo upload UI (bucket `auto-fotos`, table `auto_fotos`) — no code changes.
- Produces: 2-3 real photo rows in `auto_fotos` for one existing auto, and zero photos for at least one other auto — both states needed to verify Tasks 3 and 4's fallback behavior.

- [ ] **Step 1: Open carga.html locally and pick a test auto**

Serve the same local server from Task 1 (`http://localhost:8080/carga.html`), go to the "Autos" tab, and open any one auto in stock for editing.

- [ ] **Step 2: Upload 2-3 photos to that auto**

Use the existing file picker in the auto edit view to upload 2-3 arbitrary photos (any JPG/PNG). Confirm they appear in the `photo-grid` inside `carga.html` itself before moving on — that confirms the upload succeeded server-side.

- [ ] **Step 3: Note the patente used, for Tasks 3-4 verification**

Write down the patente of the auto you just added photos to, and pick a second patente that has zero photos (any other existing auto) — both are needed for Task 3/4 verification steps.

No commit for this task — it's a data change against Supabase, not a code change.

---

## Task 3: Thumbnail on car-card (Stock/Vendidos)

**Files:**
- Modify: `index.html:49-63` (CSS — add `.car-thumb` rule near the other `.car-*` rules)
- Modify: `index.html:440-461` (`carCard()`)

**Interfaces:**
- Consumes: `c.fotos` (`string[]`) from Task 1.

- [ ] **Step 1: Add the thumbnail CSS**

In the CSS block, right after the `.car-plate` rule (`index.html:54`), add:

```css
.car-thumb{width:64px;height:64px;border-radius:var(--radius);object-fit:cover;flex-shrink:0;margin-left:12px}
```

- [ ] **Step 2: Render the thumbnail in `carCard()`**

Current `carCard()` header markup:

```javascript
  return `<div class="car-card" onclick="openDetail('${c.patente}')">
    <div class="car-header">
      <div>
        <div class="car-model">${c.marca}</div>
        <div class="car-brand">${c.modelo}</div>
        <div class="car-plate">${c.patente}</div>
      </div>
      <span class="badge ${isVendido?'badge-vendido':'badge-stock'}">${isVendido?'Vendido':'En stock'}</span>
    </div>
```

Change it to wrap the plate block and badge together, and add the thumbnail conditionally right after the marca/modelo/patente block:

```javascript
  const thumb = c.fotos.length ? `<img class="car-thumb" src="${c.fotos[0]}" loading="lazy">` : '';
  return `<div class="car-card" onclick="openDetail('${c.patente}')">
    <div class="car-header">
      <div>
        <div class="car-model">${c.marca}</div>
        <div class="car-brand">${c.modelo}</div>
        <div class="car-plate">${c.patente}</div>
      </div>
      <div style="display:flex;align-items:center">
        <span class="badge ${isVendido?'badge-vendido':'badge-stock'}">${isVendido?'Vendido':'En stock'}</span>
        ${thumb}
      </div>
    </div>
```

(Only the header's inner markup changes — the `${fechas}` / `${nums}` lines below are untouched.)

- [ ] **Step 3: Verify manually**

Reload `http://localhost:8080/index.html` (hard refresh to bypass any cache), log in, go to Stock or Vendidos.

Expected: the car whose patente you noted in Task 2 shows a 64px square thumbnail next to its badge, using the first uploaded photo. Every other car (no photos) shows no thumbnail and no empty gap — badge sits where it always did.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Show car photo thumbnail on car-card"
```

---

## Task 4: Carousel in car detail view

**Files:**
- Modify: `index.html:64-70` (CSS — add carousel rules near `.detail-header`)
- Modify: `index.html:496-526` (`renderDetail()`)

**Interfaces:**
- Consumes: `c.fotos` (`string[]`) from Task 1.

- [ ] **Step 1: Add the carousel CSS**

Right after the `.detail-plate` rule (`index.html:66`), add:

```css
.photo-carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:8px;margin-bottom:14px;border-radius:var(--radius)}
.photo-carousel img{width:100%;height:220px;object-fit:cover;flex:0 0 100%;scroll-snap-align:start;border-radius:var(--radius)}
```

- [ ] **Step 2: Render the carousel in `renderDetail()`**

Current start of `renderDetail()`:

```javascript
function renderDetail(patente) {
  const c = CARS[patente];
  const gastos = [...c.movs]
    .filter(m => m.tipo === 'Gasto')
    .sort((a,b) => parseDate(a.fecha) - parseDate(b.fecha));
  return `
    <div class="detail-header">
```

Change to build the carousel markup and inject it before `.detail-header`:

```javascript
function renderDetail(patente) {
  const c = CARS[patente];
  const gastos = [...c.movs]
    .filter(m => m.tipo === 'Gasto')
    .sort((a,b) => parseDate(a.fecha) - parseDate(b.fecha));
  const carousel = c.fotos.length
    ? `<div class="photo-carousel">${c.fotos.map(url => `<img src="${url}" loading="lazy">`).join('')}</div>`
    : '';
  return `
    ${carousel}
    <div class="detail-header">
```

(The rest of `renderDetail()` — financial block and `gastos.map(movCard)` — is unchanged.)

- [ ] **Step 3: Verify manually**

Reload `http://localhost:8080/index.html`, open the detail view of the car with test photos.

Expected: a row of photos above the financial summary, swipeable horizontally (mouse-drag scroll or trackpad/touch swipe), each photo filling the width at ~220px height. Open the detail view of a car with no photos — expected: no carousel, no gap, detail view identical to before this change.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Show photo carousel in car detail view"
```

---

## Task 5: Device QA and push to production

**Files:** none (verification + git push only)

- [ ] **Step 1: Find the local machine's LAN IP**

Run: `ipconfig getifaddr en0` (or `en1` if on Wi-Fi via a different interface) to get the notebook's local IP, e.g. `192.168.1.23`.

- [ ] **Step 2: Serve and open on phone**

With `python3 -m http.server 8080` still running from the project root, open `http://<that-ip>:8080/index.html` on a phone connected to the same Wi-Fi network. Log in with the PIN and check:
- Stock/Vendidos car-cards show the thumbnail for the test car, no layout shift for others.
- The detail view carousel swipes correctly with touch.
- Dashboard and all other existing functionality (retiros chart, drill-downs, back button) still work as before.

- [ ] **Step 3: Ask Ariel to confirm QA passed**

Wait for explicit go-ahead before proceeding to Step 4 — do not push automatically.

- [ ] **Step 4: Optionally remove the test photos**

If Ariel wants the test photos gone before shipping, delete them via `carga.html`'s existing delete-photo button (the ✕ on each thumbnail in the Autos tab) for the test auto. This is optional — leaving them is also fine since they're real photos of a real auto.

- [ ] **Step 5: Push to main**

```bash
git push origin main
```

GitHub Pages redeploys automatically (~1 minute). Confirm on the deployed URL after it finishes.

---

## Self-Review Notes

- **Spec coverage:** all four design sections (data layer, thumbnail, carousel, QA-before-push) map 1:1 to Tasks 1, 3, 4, 5, with Task 2 added as a prerequisite fixture (the spec's QA section assumed test photos would exist but didn't assign a task to creating them — added here so Tasks 3-4 have something to verify against).
- **No-photo fallback:** explicitly verified in both Task 3 Step 3 and Task 4 Step 3, per the design's requirement that cars without photos get zero layout change.
- **Type/name consistency:** `c.fotos` (array of URL strings) and `c.autoId` (number) are defined once in Task 1 and consumed with the same names in Tasks 3-4 — no renaming across tasks.
- **No push until QA'd:** enforced structurally — Task 5 is the only task touching `origin/main`, and it's last, gated on explicit user confirmation (Step 3).
