# Carga Rápida — Fotos (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "+" entry point to `index.html` (next to Dashboard/Stock/Vendidos) that opens a "Carga rápida" menu with 3 options; only "Fotos" is functional in this phase — pick an existing car and upload photos to it directly from the app, writing to the same `auto-fotos` Storage bucket + `auto_fotos` table that `carga.html` already uses.

**Architecture:** New state variables (`quickMenuOpen`, `quickFlow`, `quickStep`, `quickData`) extend the existing `currentTab`/`drillView`/`detailCar` state machine — `render()` gains a guard, `goBack()`/`updateBackBtn()`/`showTab()` gain branches. The Fotos flow is a 2-step wizard rendered into `#main-content` (same technique as `detailCar`): pick an auto (search list built from the already-loaded `CARS` object) then upload photos (verbatim port of `carga.html`'s `uploadFotosParaAuto`/`readFileWithRetry`). No new libraries, no backend changes, no AI — this phase only prepares the "+" menu shell that Fases 2/3 (Compra, Gastos — planned separately) will reuse.

**Tech Stack:** Vanilla JS, Supabase JS client (already loaded), no build step, single file (`index.html`).

## Global Constraints

- Single file `index.html`, HTML+CSS+JS inline, no frameworks/build tools (per project CLAUDE.md).
- No automated test suite exists — verification is manual, via `node --check` for syntax and a local server + real device for behavior.
- Do not push to `origin/main` until Ariel has QA'd locally on his phone (see Task 4).
- RLS on Supabase already allows public insert on `auto_fotos` and public upload to the `auto-fotos` Storage bucket (confirmed working today via `carga.html` using the same anon key) — no RLS changes needed.
- Compra and Gastos (Fases 2/3) are out of scope for this plan — the menu shows them as inert "Pronto" items only.

---

## Task 1: "+" button, quick-menu overlay, and state-machine wiring

**Files:**
- Modify: `index.html:34-36` (CSS — `.tab-bar`/`.tab` rules, add `.tab-plus`)
- Modify: `index.html:74-78` area (CSS — add `#quick-menu` overlay rules near the existing `#photo-peek` rules)
- Modify: `index.html:151-155` (tab-bar HTML — add the "+" button)
- Modify: `index.html:299-301` (state vars)
- Modify: `index.html:303-310` (`updateBackBtn()`/`goBack()`)
- Modify: `index.html:312-318` (`showTab()`)
- Modify: `index.html:364-371` (`render()`)

**Interfaces:**
- Produces: `quickFlow` (`null | 'fotos'`), `quickStep` (number), `quickData` (object) — read by Task 2/3. `renderQuickFlow()` — dispatcher called from `render()`, returns `''` for now (Task 2 makes it return real markup for `quickFlow==='fotos'`).

- [ ] **Step 1: Add CSS for the "+" button and the quick-menu overlay**

Right after `.tab.active{...}` (`index.html:36`), add:

```css
.tab-plus{flex:0 0 44px;margin:6px 0 6px 6px;height:36px;align-self:center;font-size:26px;font-weight:600;color:var(--blue);background:var(--blue-bg);border:none;border-radius:10px;cursor:pointer}
```

Right after the `.photo-peek-hints span{...}` rule (`index.html:78`), add:

```css
#quick-menu{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;align-items:flex-end;justify-content:center;z-index:150}
#quick-menu.show{display:flex}
.quick-menu-sheet{background:var(--bg1);width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px))}
.quick-menu-title{font-size:24px;color:var(--text2);margin-bottom:14px}
.quick-menu-item{display:flex;align-items:center;justify-content:space-between;padding:16px 4px;font-size:24px;color:var(--text1);border-bottom:0.5px solid var(--border);cursor:pointer}
.quick-menu-item:last-child{border-bottom:none}
.quick-menu-item.disabled{color:var(--text3);cursor:default}
.quick-menu-tag{font-size:16px;color:var(--text3);background:var(--bg2);padding:3px 10px;border-radius:8px}
```

- [ ] **Step 2: Add the "+" button to the tab bar**

Current (`index.html:151-155`):

```html
  <div class="tab-bar">
    <button class="tab active" onclick="showTab('dashboard')">Dashboard</button>
    <button class="tab" onclick="showTab('stock')">Stock</button>
    <button class="tab" onclick="showTab('vendidos')">Vendidos</button>
  </div>
```

Change to:

```html
  <div class="tab-bar">
    <button class="tab active" onclick="showTab('dashboard')">Dashboard</button>
    <button class="tab" onclick="showTab('stock')">Stock</button>
    <button class="tab" onclick="showTab('vendidos')">Vendidos</button>
    <button class="tab-plus" onclick="toggleQuickMenu()">+</button>
  </div>
```

- [ ] **Step 3: Add quick-flow state variables**

Right after `let detailCar  = null;` (`index.html:301`), add:

```javascript
let quickMenuOpen = false;  // "+" overlay menu shown
let quickFlow = null;       // null | 'fotos'
let quickStep = 0;          // step index within the active flow
let quickData = {};         // working data for the active flow
```

- [ ] **Step 4: Add the menu overlay functions and the flow dispatcher**

Right after the new state variables from Step 3, add:

```javascript
function toggleQuickMenu() {
  quickMenuOpen = !quickMenuOpen;
  renderQuickMenu();
}
function closeQuickMenu() {
  quickMenuOpen = false;
  renderQuickMenu();
}
function renderQuickMenu() {
  let overlay = document.getElementById('quick-menu');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'quick-menu';
    overlay.onclick = (e) => { if (e.target === overlay) closeQuickMenu(); };
    document.body.appendChild(overlay);
  }
  overlay.classList.toggle('show', quickMenuOpen);
  overlay.innerHTML = `<div class="quick-menu-sheet">
    <div class="quick-menu-title">Carga rápida</div>
    <div class="quick-menu-item" onclick="startQuickFlow('fotos')"><span>📷 Fotos</span></div>
    <div class="quick-menu-item disabled"><span>🛒 Compra</span><span class="quick-menu-tag">Pronto</span></div>
    <div class="quick-menu-item disabled"><span>🎙️ Gastos</span><span class="quick-menu-tag">Pronto</span></div>
  </div>`;
}
function startQuickFlow(flow) {
  quickMenuOpen = false;
  renderQuickMenu();
  quickFlow = flow;
  quickStep = 0;
  quickData = {};
  updateBackBtn();
  render();
}
function exitQuickFlow() {
  quickFlow = null;
  quickStep = 0;
  quickData = {};
}
function renderQuickFlow() {
  if (quickFlow === 'fotos') return renderQuickFotos();
  return '';
}
function renderQuickFotos() {
  return `<div class="empty">Elegí un auto (próximo paso).</div>`;
}
```

- [ ] **Step 5: Wire `render()`, `updateBackBtn()`/`goBack()`, and `showTab()`**

Current `render()` (`index.html:364-371`):

```javascript
function render() {
  const el = document.getElementById('main-content');
  if (detailCar) { el.innerHTML = renderDetail(detailCar); return; }
  if (drillView) { el.innerHTML = renderDrill(drillView);  return; }
  if (currentTab === 'dashboard') el.innerHTML = renderDashboard();
  else if (currentTab === 'stock') el.innerHTML = renderStock();
  else el.innerHTML = renderVendidos();
}
```

Change to:

```javascript
function render() {
  const el = document.getElementById('main-content');
  if (quickFlow) { el.innerHTML = renderQuickFlow(); return; }
  if (detailCar) { el.innerHTML = renderDetail(detailCar); return; }
  if (drillView) { el.innerHTML = renderDrill(drillView);  return; }
  if (currentTab === 'dashboard') el.innerHTML = renderDashboard();
  else if (currentTab === 'stock') el.innerHTML = renderStock();
  else el.innerHTML = renderVendidos();
}
```

Current `updateBackBtn()`/`goBack()` (`index.html:303-310`):

```javascript
function updateBackBtn() {
  document.getElementById('header-back').style.display = (drillView || detailCar) ? 'inline' : 'none';
}

function goBack() {
  if (detailCar) { closeDetail(); return; }
  if (drillView) { drillView = null; document.getElementById('header-sub').textContent = 'Resumen general'; updateBackBtn(); render(); }
}
```

Change to:

```javascript
function updateBackBtn() {
  document.getElementById('header-back').style.display = (quickFlow || drillView || detailCar) ? 'inline' : 'none';
}

function goBack() {
  if (quickFlow) {
    if (quickStep > 0) { quickStep--; } else { exitQuickFlow(); }
    updateBackBtn(); render();
    return;
  }
  if (detailCar) { closeDetail(); return; }
  if (drillView) { drillView = null; document.getElementById('header-sub').textContent = 'Resumen general'; updateBackBtn(); render(); }
}
```

Current `showTab()` (`index.html:312-318`):

```javascript
function showTab(tab) {
  currentTab = tab; drillView = null; detailCar = null;
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['dashboard','stock','vendidos'][i] === tab));
  const subs = {dashboard:'Resumen general', stock:'Autos en stock', vendidos:'Autos vendidos'};
  document.getElementById('header-sub').textContent = subs[tab];
  updateBackBtn(); render();
}
```

Change to (adds `exitQuickFlow()` so switching tabs mid-flow doesn't leave the tab bar out of sync with the content shown):

```javascript
function showTab(tab) {
  currentTab = tab; drillView = null; detailCar = null; exitQuickFlow();
  document.querySelectorAll('.tab').forEach((t,i) => t.classList.toggle('active', ['dashboard','stock','vendidos'][i] === tab));
  const subs = {dashboard:'Resumen general', stock:'Autos en stock', vendidos:'Autos vendidos'};
  document.getElementById('header-sub').textContent = subs[tab];
  updateBackBtn(); render();
}
```

- [ ] **Step 6: Verify manually**

Run: `node --check` on the extracted `<script>` block (or open the file directly) to confirm no syntax errors. Then serve locally: `python3 -m http.server 8080` from the project root, open `http://localhost:8080/index.html`, log in with PIN `10500`.

Expected:
- A blue "+" button appears to the right of "Vendidos", not stretched like the other 3 tabs.
- Tapping it slides up a sheet titled "Carga rápida" with "📷 Fotos" (normal color), "🛒 Compra" and "🎙️ Gastos" (greyed out, "Pronto" tag, no reaction to tapping).
- Tapping outside the sheet (the dark overlay) closes it.
- Tapping "📷 Fotos" closes the sheet, shows the "← Atrás" back button in the header, and `#main-content` shows "Elegí un auto (próximo paso)."
- Tapping "← Atrás" exits the flow: back button disappears, content returns to whatever tab was active before.
- Switching tabs (Dashboard/Stock/Vendidos) while the placeholder is showing correctly abandons it and shows the tapped tab's content.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add Carga Rapida quick-menu shell with Fotos entry point"
```

---

## Task 2: Auto picker (step 0 of the Fotos flow)

**Files:**
- Modify: `index.html` (CSS — add rules near `.car-card`/`.badge-stock`, `index.html:49-57`)
- Modify: `index.html` (`renderQuickFotos()`, added in Task 1)

**Interfaces:**
- Consumes: `CARS` (`index.html:209`, already populated by `loadData()`), `quickData`/`quickStep` (Task 1).
- Produces: `quickData.patente` (string) and `quickData.autoId` (number), set when the user picks an auto — consumed by Task 3.

- [ ] **Step 1: Add CSS for the search box and auto list**

Right after `.car-thumb{...}` (`index.html:55`), add:

```css
.quick-step{padding:16px}
.quick-step-title{font-size:24px;color:var(--text2);margin-bottom:12px}
.quick-search{width:100%;box-sizing:border-box;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-size:22px;color:var(--text1);margin-bottom:12px}
.quick-auto-item{display:flex;justify-content:space-between;align-items:center;background:var(--bg2);border:0.5px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:8px;cursor:pointer}
.quick-plate{font-weight:600;margin-right:6px}
```

- [ ] **Step 2: Replace the `renderQuickFotos()` placeholder with the auto picker**

Current (from Task 1):

```javascript
function renderQuickFotos() {
  return `<div class="empty">Elegí un auto (próximo paso).</div>`;
}
```

Change to:

```javascript
function renderQuickFotos() {
  if (quickStep === 0) return renderQuickFotosPicker();
  return `<div class="empty">Subí las fotos (próximo paso).</div>`;
}
function renderQuickFotosPicker() {
  return `<div class="quick-step">
    <div class="quick-step-title">Elegí un auto</div>
    <input class="quick-search" id="quick-auto-search" type="text" placeholder="Buscar por patente, marca o modelo" oninput="quickFilterAutos(this.value)" autocomplete="off">
    <div class="quick-auto-list" id="quick-auto-list">${quickAutoListHtml('')}</div>
  </div>`;
}
function quickAutoListHtml(query) {
  const q = query.trim().toLowerCase();
  const items = Object.values(CARS)
    .filter(c => !q || `${c.patente} ${c.marca} ${c.modelo}`.toLowerCase().includes(q))
    .sort((a,b) => a.patente.localeCompare(b.patente));
  if (!items.length) return '<div class="empty">Sin resultados.</div>';
  return items.map(c => `<div class="quick-auto-item" onclick="quickSelectAuto('${c.patente}')">
    <span><span class="quick-plate">${c.patente}</span>${c.marca} ${c.modelo}</span>
    <span class="badge ${c.vendido?'badge-vendido':'badge-stock'}">${c.vendido?'Vendido':'En stock'}</span>
  </div>`).join('');
}
function quickFilterAutos(query) {
  document.getElementById('quick-auto-list').innerHTML = quickAutoListHtml(query);
}
function quickSelectAuto(patente) {
  quickData.patente = patente;
  quickData.autoId = CARS[patente].autoId;
  quickStep = 1;
  updateBackBtn();
  render();
}
```

Note: `quickFilterAutos` updates only the `#quick-auto-list` div's `innerHTML`, not the whole step — replacing the search `<input>` itself on every keystroke would steal focus after each character typed (same reason `carga.html`'s combobox at `carga.html:709-739` keeps its input static and only re-renders the results list).

- [ ] **Step 3: Verify manually**

Reload `http://localhost:8080/index.html` (hard refresh), tap "+" → "Fotos".

Expected: a search box and a list of every car (patente in bold, marca/modelo, Stock/Vendido badge), sorted by patente. Typing in the search box narrows the list live without losing keyboard focus (you can keep typing without tapping the input again). Tapping any car advances to `#main-content` showing "Subí las fotos (próximo paso)." with the back button now returning to the picker (not exiting the flow) — confirm by tapping "← Atrás" once (back to the search list) and again (exits to the previous tab).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add auto picker for Carga Rapida Fotos flow"
```

---

## Task 3: Photo upload (step 1 of the Fotos flow)

**Files:**
- Modify: `index.html` (CSS — add `.quick-file-input`/`.quick-submit-btn` near the Task 2 rules)
- Modify: `index.html` (`renderQuickFotos()`, from Task 2 — replace the step-1 placeholder)
- Add: `uploadFotosParaAuto`, `readFileWithRetry`, `quickRefreshFotos`, `quickUploadFotos` functions

**Interfaces:**
- Consumes: `quickData.patente`/`quickData.autoId` (Task 2).
- Produces: uploaded rows in Supabase Storage (`auto-fotos` bucket) + `auto_fotos` table; updates `CARS[patente].fotos` in place so the detail view's carousel (`renderDetail`, existing code) shows the new photos immediately.

- [ ] **Step 1: Add CSS for the file input and submit button**

Right after the Task 2 CSS block, add:

```css
.quick-file-input{width:100%;margin-bottom:12px;font-size:18px;color:var(--text2)}
.quick-submit-btn{width:100%;background:var(--blue-bg);color:var(--blue);border:none;border-radius:var(--radius);padding:14px;font-size:22px;font-weight:500;cursor:pointer}
```

- [ ] **Step 2: Port `readFileWithRetry` and `uploadFotosParaAuto` verbatim from `carga.html`**

Add these two functions (copied from `carga.html:1035-1062`, unchanged — they have no dependency on anything `carga.html`-specific):

```javascript
// Algunos archivos (ej. fotos de iCloud no descargadas del todo) reportan un tamaño
// correcto pero todavía no tienen contenido real disponible. Reintenta leerlos antes
// de subir, dándole tiempo al sistema operativo a terminar de bajarlos.
async function readFileWithRetry(file, attempts = 5, delayMs = 1000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const buf = await file.arrayBuffer();
      if (buf && buf.byteLength > 0) return buf;
    } catch (e) { /* reintenta */ }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// Sube las fotos que puede; las que fallan (ej. no terminaron de descargarse) se omiten
// sin cortar el resto. Devuelve los nombres de las que no se pudieron subir.
async function uploadFotosParaAuto(autoId, files) {
  const fallidas = [];
  for (const file of Array.from(files)) {
    if (!file) continue;
    const buf = await readFileWithRetry(file);
    if (!buf) { fallidas.push(file.name); continue; }
    const path = `${autoId}/${Date.now()}-${file.name}`;
    const { error: eUp } = await supabaseClient.storage.from('auto-fotos').upload(path, buf, { contentType: file.type || 'image/jpeg' });
    if (eUp) { fallidas.push(file.name); continue; }
    const { data: pub } = supabaseClient.storage.from('auto-fotos').getPublicUrl(path);
    const { error: eIns } = await supabaseClient.from('auto_fotos').insert({ auto_id: autoId, url: pub.publicUrl });
    if (eIns) fallidas.push(file.name);
  }
  return fallidas;
}
```

- [ ] **Step 3: Replace the step-1 placeholder and add the upload functions**

Current `renderQuickFotos()` (from Task 2):

```javascript
function renderQuickFotos() {
  if (quickStep === 0) return renderQuickFotosPicker();
  return `<div class="empty">Subí las fotos (próximo paso).</div>`;
}
```

Change to:

```javascript
function renderQuickFotos() {
  if (quickStep === 0) return renderQuickFotosPicker();
  return renderQuickFotosUpload();
}
function renderQuickFotosUpload() {
  const c = CARS[quickData.patente];
  return `<div class="quick-step">
    <div class="quick-step-title">${c.marca} ${c.modelo} · ${c.patente}</div>
    <input type="file" accept="image/*" multiple id="quick-foto-input" class="quick-file-input">
    <button class="quick-submit-btn" onclick="quickUploadFotos()">Subir fotos</button>
    <div id="quick-foto-msg" style="margin-top:12px;font-size:20px;color:var(--text2)"></div>
  </div>`;
}
async function quickRefreshFotos(autoId) {
  const { data, error } = await supabaseClient
    .from('auto_fotos')
    .select('url')
    .eq('auto_id', autoId)
    .order('created_at', { ascending: true });
  if (!error) {
    const c = Object.values(CARS).find(c => c.autoId === autoId);
    if (c) c.fotos = (data || []).map(f => f.url);
  }
}
async function quickUploadFotos() {
  const input = document.getElementById('quick-foto-input');
  const msgEl = document.getElementById('quick-foto-msg');
  if (!input.files || !input.files.length) { msgEl.textContent = 'Elegí al menos una foto.'; return; }
  msgEl.textContent = 'Subiendo…';
  const fallidas = await uploadFotosParaAuto(quickData.autoId, input.files);
  await quickRefreshFotos(quickData.autoId);
  if (fallidas.length) {
    document.getElementById('quick-foto-msg').textContent = `No se pudieron subir ${fallidas.length} foto(s): ${fallidas.join(', ')}. Podés reintentar desde acá.`;
    return;
  }
  const patente = quickData.patente;
  exitQuickFlow();
  openDetail(patente);
}
```

Note: `quickRefreshFotos` re-queries only this auto's `auto_fotos` rows and updates `CARS[...].fotos` in place, instead of calling the full `loadData()` — `loadData()` ends by calling `render()` itself (`index.html:289`), which would tear down and rebuild this very upload screen (including the file input and the in-flight message) while `quickUploadFotos` is still using it. A scoped re-fetch avoids that.

- [ ] **Step 4: Verify manually**

Reload, tap "+" → "Fotos", pick an existing car, select 1-2 real photos from the file picker (confirm Safari/browser offers both camera and photo library, since there's no `capture` attribute), tap "Subir fotos".

Expected: "Subiendo…" appears, then the app lands on that car's detail view with the new photos visible in the carousel (existing carousel code from the prior fotos-en-index feature, untouched by this plan). Reopen the same car from Stock/Vendidos — thumbnail also reflects the upload. Tapping "+" → "Fotos" again and picking a car with no photos, then tapping "Subir fotos" with no file selected shows "Elegí al menos una foto." without navigating away.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Upload photos to existing car from Carga Rapida Fotos flow"
```

---

## Task 4: Device QA and push to production

**Files:** none (verification + git push only)

- [ ] **Step 1: Find the local machine's LAN IP**

Run: `ipconfig getifaddr en0` (or `en1` if on Wi-Fi via a different interface).

- [ ] **Step 2: Serve and open on phone**

With `python3 -m http.server 8080` (no `--bind`) running from the project root, open `http://<that-ip>:8080/index.html` on a phone on the same Wi-Fi. Log in with the PIN and check:
- The "+" button and menu look right (not cramped, "Pronto" items clearly inert) on a real screen size.
- Full Fotos flow end-to-end: pick a real auto, take a real photo with the camera (confirm the camera/library choice sheet appears), upload it, land on the detail view with the carousel showing it.
- Dashboard, Stock, Vendidos, drill-downs, existing photo carousel/peek, and the back button all still work exactly as before — this plan only adds new state branches, it shouldn't change any existing behavior.

- [ ] **Step 3: Ask Ariel to confirm QA passed**

Wait for explicit go-ahead before proceeding — do not push automatically.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

GitHub Pages redeploys automatically (~1 minute). Confirm on the deployed URL after it finishes.

---

## Self-Review Notes

- **Spec coverage:** the design's 4 sections (entry point, state, Fotos flow, QA) map to Tasks 1 (entry point + state wiring), 2 (picker), 3 (upload), 4 (QA + push) 1:1.
- **No placeholders left unresolved:** Task 1's stub text ("próximo paso") is fully replaced by Task 2 and Task 3 — by the end of Task 3 there is no placeholder copy left in the shipped code.
- **Type/name consistency:** `quickFlow`/`quickStep`/`quickData` (Task 1), `quickData.patente`/`quickData.autoId` (Task 2), `CARS[...].fotos` (pre-existing, updated in place by Task 3) — same names used everywhere they're referenced across tasks.
- **Concurrent-write safety:** Task 3 deliberately re-fetches only the affected auto's photos rather than trusting an in-memory append, so a photo uploaded from a second device moments earlier isn't dropped.
- **No push until QA'd:** enforced structurally — Task 4 is the only task touching `origin/main`, gated on explicit confirmation from Ariel (Step 3).
- **Fases 2/3 not started:** the menu deliberately ships with "Compra"/"Gastos" inert and tagged "Pronto" — no Edge Function, OpenAI integration, or new Supabase infrastructure is touched by this plan, per the approved phased architecture.
