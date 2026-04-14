// ── Query description bar ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const descBar = document.getElementById('query-desc-bar');
  if (!descBar) return;
  document.querySelectorAll('.q-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      const tip = btn.dataset.tip;
      if (tip) { descBar.textContent = tip; descBar.style.display = 'block'; }
    });
    btn.addEventListener('mouseleave', () => {
      descBar.style.display = 'none';
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════
const STATE = {
  mapAnag: null,
  mapMonitor: null,
  monitorMarkers: [],
  anagMarkers: [],
  selectedMarker: null,       // marker dedicato per il traliccio in modifica
  geoCircle: null,
  geoResultMarkers: [],
  formMode: null,
  editingId: null,
  pickingCoords: false,
  tempMarker: null,
  searchTimer: null,
  // Paginazione CRUD
  crudPage: 1,
  crudQuery: '',
  crudTotalPages: 1,
  crudTotal: 0,
  _geoParams: null
};

const COLORS = {
  attivo: '#22c55e',
  in_manutenzione: '#f97316',
  fuori_servizio: '#ef4444'
};

// ═══════════════════════════════════════════════════════════════
//  TAB MANAGEMENT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => switchTab('admin'));

function switchTab(tab) {
  ['admin', 'anagrafica', 'monitor'].forEach(t => {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`btn-${t}`).classList.toggle('active', t === tab);
  });

  if (tab === 'anagrafica') {
    setTimeout(() => {
      if (!STATE.mapAnag) initMapAnag();
      else STATE.mapAnag.invalidateSize();
    }, 50);
  }
  if (tab === 'monitor') {
    setTimeout(() => {
      if (!STATE.mapMonitor) initMapMonitor();
      else STATE.mapMonitor.invalidateSize();
      runQuery('kpi');
    }, 50);
  }
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN — SEED
// ═══════════════════════════════════════════════════════════════
async function seedDB() {
  const btn = document.getElementById('seed-btn');
  const div = document.getElementById('seed-result');
  btn.disabled = true;
  btn.textContent = 'Generazione in corso…';
  div.innerHTML = `<div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:14px; font-size:13px; color:#1d4ed8;">
    Generazione embedding template + insert 10.000 record…<br>
    <span style="font-size:11px; color:#60a5fa;">Attendi 60–120 secondi</span>
  </div>`;

  try {
    const res = await fetch('/api/seed', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    div.innerHTML = `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:16px;">
        <div style="font-weight:700; color:#15803d; margin-bottom:12px;">✓ Database inizializzato — ${data.elapsed_sec}s</div>
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; text-align:center;">
          ${[['Tralicci',data.counts.tralicci,'#1d4ed8'],['IoT Box',data.counts.iot_boxes,'#16a34a'],
             ['DigiC Box',data.counts.digic_boxes,'#7c3aed'],['DigiL Box',data.counts.digil_boxes,'#ea580c']]
            .map(([l,v,c]) => `<div style="background:#fff; border-radius:8px; padding:10px; border:1px solid #e2e8f0;">
              <div style="font-size:22px; font-weight:900; color:${c};">${v.toLocaleString()}</div>
              <div style="font-size:11px; color:#94a3b8;">${l}</div>
            </div>`).join('')}
        </div>
        <div style="font-size:11px; color:#94a3b8; margin-top:10px;">Indici Atlas Search in costruzione — query E/F disponibili tra ~30s</div>
      </div>`;

    if (STATE.mapAnag)    reloadAnagMarkers();
    if (STATE.mapMonitor) reloadMonitorMarkers();
  } catch (e) {
    div.innerHTML = `<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:14px; color:#dc2626; font-size:13px;">Errore: ${e.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = 'Inizializza Database';
}

// ═══════════════════════════════════════════════════════════════
//  ANAGRAFICA — MAP
// ═══════════════════════════════════════════════════════════════
function initMapAnag() {
  STATE.mapAnag = L.map('map-anag').setView([42.5, 13.0], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(STATE.mapAnag);

  STATE.mapAnag.on('click', e => {
    if (!STATE.pickingCoords) return;
    const { lat, lng } = e.latlng;
    document.getElementById('f-lat').value = lat.toFixed(6);
    document.getElementById('f-lng').value = lng.toFixed(6);
    if (STATE.tempMarker) STATE.mapAnag.removeLayer(STATE.tempMarker);
    STATE.tempMarker = L.circleMarker([lat, lng], {
      radius: 10, fillColor: '#3b82f6', color: '#fff', weight: 3, fillOpacity: 1
    }).addTo(STATE.mapAnag).bindPopup('Nuova posizione').openPopup();
  });

  reloadAnagMarkers();
}

async function reloadAnagMarkers() {
  STATE.anagMarkers.forEach(m => STATE.mapAnag.removeLayer(m));
  STATE.anagMarkers = [];
  try {
    const tralicci = await (await fetch('/api/tralicci')).json();
    tralicci.forEach(t => {
      const [lng, lat] = t.gis_location.coordinates;
      const m = L.circleMarker([lat, lng], {
        radius: 6, fillColor: COLORS[t.stato_operativo] || '#94a3b8',
        color: '#fff', weight: 1.5, fillOpacity: 0.85
      }).addTo(STATE.mapAnag);
      m.on('click', () => openForm('edit', t));
      m._trlData = t;
      STATE.anagMarkers.push(m);
    });
  } catch (e) { console.error('Errore caricamento mappa anagrafica:', e); }
}

// ═══════════════════════════════════════════════════════════════
//  ANAGRAFICA — CRUD LIST + PAGINAZIONE
// ═══════════════════════════════════════════════════════════════
function searchTralicci(q) {
  clearTimeout(STATE.searchTimer);
  STATE.searchTimer = setTimeout(() => {
    STATE.crudQuery = q;
    STATE.crudPage  = 1;
    loadCrudList();
  }, 300);
}

async function loadCrudList(page) {
  if (page !== undefined) STATE.crudPage = page;
  try {
    const params = new URLSearchParams({
      limit: 50,
      page:  STATE.crudPage,
      ...(STATE.crudQuery ? { q: STATE.crudQuery } : {})
    });
    const res  = await fetch(`/api/tralicci/search?${params}`);
    const json = await res.json();
    STATE.crudTotalPages = json.pages;
    STATE.crudTotal      = json.total;
    renderCrudList(json.data);
    renderPagination();
  } catch (e) { console.error(e); }
}

function renderCrudList(tralicci) {
  const div = document.getElementById('crud-list');
  if (!tralicci.length) {
    div.innerHTML = '<div style="padding:20px; text-align:center; color:#94a3b8; font-size:13px;">Nessun risultato</div>';
    return;
  }
  div.innerHTML = tralicci.map(t => {
    const color = COLORS[t.stato_operativo] || '#94a3b8';
    const isSelected = t._id === STATE.editingId;
    return `<div class="crud-row${isSelected ? ' selected' : ''}" id="row-${t._id}">
      <span class="crud-dot" style="background:${color};"></span>
      <div class="crud-row-info">
        <div class="crud-row-code">${t.codice}</div>
        <div class="crud-row-sub">${t.tipologia} · ${t.regione} · ${t.tensione_kv}kV</div>
      </div>
      <div class="crud-row-actions">
        <button class="btn-ghost" onclick="openFormById('${t._id}')">✎</button>
        <button class="btn-ghost" style="color:#dc2626; border-color:#fecaca;" onclick="deleteTraliccio('${t._id}','${t.codice}')">✕</button>
      </div>
    </div>`;
  }).join('');
}

function renderPagination() {
  const div = document.getElementById('crud-pagination');
  const { crudPage: p, crudTotalPages: tot, crudTotal: total } = STATE;
  const from = (p - 1) * 50 + 1;
  const to   = Math.min(p * 50, total);
  div.innerHTML = `
    <button class="pag-btn" onclick="loadCrudList(1)"        ${p <= 1 ? 'disabled' : ''}>«</button>
    <button class="pag-btn" onclick="loadCrudList(${p - 1})" ${p <= 1 ? 'disabled' : ''}>‹</button>
    <div class="pag-info">
      <span style="font-weight:700; color:#1e293b;">${from}–${to}</span>
      <span> di </span>
      <span style="font-weight:700; color:#1e293b;">${total.toLocaleString()}</span>
      <br>
      <span>pag. </span>
      <input class="pag-input" type="number" min="1" max="${tot}" value="${p}"
        onchange="loadCrudList(Math.max(1,Math.min(${tot},parseInt(this.value)||1)))">
      <span> / ${tot}</span>
    </div>
    <button class="pag-btn" onclick="loadCrudList(${p + 1})" ${p >= tot ? 'disabled' : ''}>›</button>
    <button class="pag-btn" onclick="loadCrudList(${tot})"   ${p >= tot ? 'disabled' : ''}>»</button>`;
}

// ═══════════════════════════════════════════════════════════════
//  ANAGRAFICA — MARKER SELEZIONATO (dedicato, sempre visibile)
// ═══════════════════════════════════════════════════════════════
function placeSelectedMarker(data) {
  // Rimuovi il marker precedente se esiste
  if (STATE.selectedMarker) {
    STATE.mapAnag.removeLayer(STATE.selectedMarker);
    STATE.selectedMarker = null;
  }
  if (!data?.gis_location) return;

  const [lng, lat] = data.gis_location.coordinates;
  const color = COLORS[data.stato_operativo] || '#94a3b8';

  // Cerchio esterno (alone)
  const outer = L.circleMarker([lat, lng], {
    radius: 22, fillColor: 'transparent',
    color: '#3b82f6', weight: 3, fillOpacity: 0,
    opacity: 0.7
  }).addTo(STATE.mapAnag);

  // Cerchio interno (marker vero)
  const inner = L.circleMarker([lat, lng], {
    radius: 14, fillColor: color,
    color: '#ffffff', weight: 3, fillOpacity: 1
  }).addTo(STATE.mapAnag);

  inner.bindPopup(`<b>${data.codice}</b><br><i>In modifica…</i>`).openPopup();
  inner.bringToFront();

  // Salviamo entrambi come array così li rimuoviamo insieme
  STATE.selectedMarker = { _layers: [outer, inner] };

  // Zoom sul traliccio
  STATE.mapAnag.setView([lat, lng], 13);
}

function removeSelectedMarker() {
  if (!STATE.selectedMarker) return;
  STATE.selectedMarker._layers.forEach(l => STATE.mapAnag.removeLayer(l));
  STATE.selectedMarker = null;
}

// ═══════════════════════════════════════════════════════════════
//  ANAGRAFICA — FORM
// ═══════════════════════════════════════════════════════════════
function openForm(mode, data = null) {
  STATE.formMode = mode;
  STATE.editingId = data?._id || null;

  document.getElementById('form-title').textContent = mode === 'new' ? 'Nuovo Traliccio' : 'Modifica Traliccio';
  document.getElementById('crud-list-view').style.display = 'none';
  document.getElementById('crud-form').style.display = 'flex';

  // Pannello apparati: carica in edit, nasconde in new
  const detPanel = document.getElementById('trl-details');
  if (detPanel) {
    if (mode === 'edit' && data?._id) {
      loadTraliccioDetails(data._id);
    } else {
      detPanel.style.display = 'none';
      detPanel.innerHTML = '';
    }
  }

  // Reset / populate
  document.getElementById('f-id').value          = data?._id || '';
  document.getElementById('f-codice').value      = data?.codice || '';
  document.getElementById('f-nome').value        = data?.nome || '';
  document.getElementById('f-anno').value        = data?.anno_installazione || '';
  document.getElementById('f-tipologia').value   = data?.tipologia || 'Monostelo';
  document.getElementById('f-tensione').value    = data?.tensione_kv || '380';
  document.getElementById('f-regione').value     = data?.regione || 'Lazio';
  document.getElementById('f-stato').value       = data?.stato_operativo || 'attivo';
  document.getElementById('f-descrizione').value = data?.descrizione || '';

  const latEl = document.getElementById('f-lat');
  const lngEl = document.getElementById('f-lng');

  if (mode === 'edit' && data?.gis_location) {
    // EDIT: coordinate readonly, marker dedicato sulla mappa
    latEl.value    = data.gis_location.coordinates[1];
    lngEl.value    = data.gis_location.coordinates[0];
    latEl.readOnly = true;
    lngEl.readOnly = true;
    latEl.style.background = '#f1f5f9';
    lngEl.style.background = '#f1f5f9';
    document.querySelector('.coord-hint').textContent = 'Le coordinate non sono modificabili';
    document.querySelector('.coord-hint').style.color = '#94a3b8';
    STATE.pickingCoords = false;
    document.getElementById('map-click-hint').style.display = 'none';
    placeSelectedMarker(data);
  } else {
    // NEW: coordinate vuote, click sulla mappa per impostarle
    latEl.value    = '';
    lngEl.value    = '';
    latEl.readOnly = true;   // readonly ma compilate dal click mappa
    lngEl.readOnly = true;
    latEl.style.background = '#fff';
    lngEl.style.background = '#fff';
    document.querySelector('.coord-hint').textContent = '↑ clicca sulla mappa per impostare';
    document.querySelector('.coord-hint').style.color = '#3b82f6';
    STATE.pickingCoords = true;
    document.getElementById('map-click-hint').style.display = 'block';
    if (STATE.mapAnag) STATE.mapAnag.getContainer().style.cursor = 'crosshair';
  }
}

async function openFormById(id) {
  try {
    const t = await (await fetch(`/api/tralicci/${id}`)).json();
    openForm('edit', t);
  } catch (e) { alert('Errore caricamento traliccio'); }
}

function closeForm() {
  document.getElementById('crud-list-view').style.display = 'flex';
  document.getElementById('crud-form').style.display = 'none';
  STATE.formMode  = null;
  STATE.editingId = null;
  STATE.pickingCoords = false;
  document.getElementById('map-click-hint').style.display = 'none';
  if (STATE.mapAnag) STATE.mapAnag.getContainer().style.cursor = '';
  if (STATE.tempMarker) { STATE.mapAnag.removeLayer(STATE.tempMarker); STATE.tempMarker = null; }
  removeSelectedMarker();
  const detPanel = document.getElementById('trl-details');
  if (detPanel) { detPanel.style.display = 'none'; detPanel.innerHTML = ''; }
}

async function saveTraliccio() {
  const lat = document.getElementById('f-lat').value;
  const lng = document.getElementById('f-lng').value;
  if (!lat || !lng) { alert('Clicca sulla mappa per impostare le coordinate'); return; }

  const body = {
    codice:             document.getElementById('f-codice').value,
    nome:               document.getElementById('f-nome').value,
    tipologia:          document.getElementById('f-tipologia').value,
    tensione_kv:        document.getElementById('f-tensione').value,
    regione:            document.getElementById('f-regione').value,
    stato_operativo:    document.getElementById('f-stato').value,
    anno_installazione: document.getElementById('f-anno').value,
    descrizione:        document.getElementById('f-descrizione').value.trim(),
    lat, lng
  };

  try {
    const url = STATE.formMode === 'new' ? '/api/tralicci' : `/api/tralicci/${STATE.editingId}`;
    const method = STATE.formMode === 'new' ? 'POST' : 'PUT';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    closeForm();
    loadCrudList();
    reloadAnagMarkers();
  } catch (e) { alert('Errore salvataggio: ' + e.message); }
}

async function deleteTraliccio(id, codice) {
  if (!confirm(`Eliminare ${codice}?`)) return;
  try {
    await fetch(`/api/tralicci/${id}`, { method: 'DELETE' });
    loadCrudList();
    reloadAnagMarkers();
  } catch (e) { alert('Errore eliminazione'); }
}

// ═══════════════════════════════════════════════════════════════
//  ANAGRAFICA — PANNELLO DETTAGLI APPARATI COLLEGATI
// ═══════════════════════════════════════════════════════════════
async function loadTraliccioDetails(id) {
  const panel = document.getElementById('trl-details');
  panel.style.display = 'block';
  panel.innerHTML = '<div style="color:#94a3b8; font-size:12px; padding:10px 0;">Caricamento apparati…</div>';
  try {
    const res  = await fetch(`/api/tralicci/${id}/details`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    renderTraliccioDetails(data);
  } catch (e) {
    panel.innerHTML = `<div style="color:#f87171; font-size:12px; padding:10px 0;">Errore caricamento: ${e.message}</div>`;
  }
}

function renderTraliccioDetails({ iot, tratte, linea }) {
  const panel = document.getElementById('trl-details');

  let html = '<div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.06em; margin-bottom:12px;">Apparati collegati</div>';

  // ── IoT Box ─────────────────────────────────────────────────
  if (iot) {
    const batt  = iot.livello_batteria ?? 0;
    const col   = batt < 20 ? '#ef4444' : batt < 50 ? '#f97316' : '#22c55e';
    const alr   = iot.allarmi_attivi || [];
    html += `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:11px 12px; margin-bottom:9px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:10px; font-weight:700; color:#7c3aed; text-transform:uppercase; letter-spacing:.05em;">IoT Box</span>
        <span style="font-family:monospace; font-size:11px; color:#64748b;">${iot.codice}</span>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:7px;">
        <span style="font-size:11px; color:#64748b; width:60px;">Batteria</span>
        <div class="batt-bar" style="flex:1;"><div class="batt-fill" style="width:${batt}%; background:${col};"></div></div>
        <span class="batt-num" style="color:${col};">${batt}%</span>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-bottom:7px; font-size:11px; text-align:center;">
        <div style="background:#f8fafc; border-radius:5px; padding:5px;">
          <div style="font-weight:700; color:#1e293b;">${iot.telemetria?.temperatura_celsius?.toFixed(1) ?? '—'}°C</div>
          <div style="color:#94a3b8; font-size:10px;">Temp</div>
        </div>
        <div style="background:#f8fafc; border-radius:5px; padding:5px;">
          <div style="font-weight:700; color:#1e293b;">${iot.telemetria?.umidita_percentuale?.toFixed(0) ?? '—'}%</div>
          <div style="color:#94a3b8; font-size:10px;">Umidità</div>
        </div>
        <div style="background:#f8fafc; border-radius:5px; padding:5px;">
          <div style="font-weight:700; color:#1e293b;">${iot.telemetria?.vibrazione_hz?.toFixed(1) ?? '—'} Hz</div>
          <div style="color:#94a3b8; font-size:10px;">Vibraz.</div>
        </div>
      </div>
      ${alr.length
        ? `<div style="display:flex; flex-wrap:wrap; gap:4px;">${alr.map(a => `<span class="badge-alarm">${a}</span>`).join('')}</div>`
        : '<div style="font-size:11px; color:#16a34a;">✓ Nessun allarme</div>'}
    </div>`;
  } else {
    html += '<div style="color:#94a3b8; font-size:12px; margin-bottom:9px;">Nessun IoT Box collegato</div>';
  }

  // ── Tratte DigiC ────────────────────────────────────────────
  if (tratte && tratte.length) {
    html += `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:11px 12px; margin-bottom:9px;">
      <div style="font-size:10px; font-weight:700; color:#1d4ed8; text-transform:uppercase; letter-spacing:.05em; margin-bottom:8px;">
        Tratte cavo (${tratte.length})
      </div>
      ${tratte.map(t => {
        const c = t.stato === 'guasto' ? '#ef4444' : t.stato === 'sovraccarico' ? '#f97316' : '#22c55e';
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid #f1f5f9; font-size:11px; gap:6px;">
          <span style="font-family:monospace; font-weight:600; flex-shrink:0;">${t.codice}</span>
          <span style="color:#64748b; font-family:monospace;">${t.lunghezza_km?.toFixed(1) ?? '—'} km · ${t.temperatura_cavo_celsius?.toFixed(1) ?? '—'}°C</span>
          <span style="background:${c}18; color:${c}; padding:1px 6px; border-radius:4px; font-weight:600; flex-shrink:0;">${t.stato}</span>
        </div>`;
      }).join('')}
    </div>`;
  } else {
    html += '<div style="color:#94a3b8; font-size:12px; margin-bottom:9px;">Nessuna tratta cavo trovata</div>';
  }

  // ── Linea DigiL ─────────────────────────────────────────────
  if (linea) {
    html += `<div style="background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:11px 12px;">
      <div style="font-size:10px; font-weight:700; color:#ea580c; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px;">Linea elettrica</div>
      <div style="font-size:12px; font-weight:700; color:#1e293b; margin-bottom:3px;">${linea.nome_linea}</div>
      <div style="font-size:11px; color:#64748b;">${linea.codice} · ${linea.potenza_mw ?? '—'} MW · ${linea.disponibilita_percentuale ?? '—'}% disponibilità</div>
    </div>`;
  }

  panel.innerHTML = html;
}

// Carica la lista quando si apre il tab Anagrafica
const _origSwitch = switchTab;
// Override: carica lista CRUD quando si attiva il tab anagrafica
document.getElementById('btn-anagrafica').addEventListener('click', () => {
  setTimeout(loadCrudList, 100);
});

// ═══════════════════════════════════════════════════════════════
//  MONITOR — MAP
// ═══════════════════════════════════════════════════════════════
function initMapMonitor() {
  STATE.mapMonitor = L.map('map-monitor', { zoomControl: true }).setView([42.0, 13.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(STATE.mapMonitor);
  reloadMonitorMarkers();
}

async function reloadMonitorMarkers() {
  STATE.monitorMarkers.forEach(m => STATE.mapMonitor.removeLayer(m));
  STATE.monitorMarkers = [];
  if (STATE.geoCircle) { STATE.mapMonitor.removeLayer(STATE.geoCircle); STATE.geoCircle = null; }
  try {
    const tralicci = await (await fetch('/api/tralicci')).json();
    tralicci.forEach(t => {
      const [lng, lat] = t.gis_location.coordinates;
      const m = L.circleMarker([lat, lng], {
        radius: 5, fillColor: COLORS[t.stato_operativo] || '#64748b',
        color: 'transparent', weight: 0, fillOpacity: 0.75
      }).addTo(STATE.mapMonitor);
      m.bindPopup(`<b>${t.codice}</b><br>${t.tipologia}<br>${t.regione}<br>
        <span style="color:${COLORS[t.stato_operativo]}">${t.stato_operativo.replace(/_/g,' ')}</span>`);
      m.on('click', () => {
        const inp = document.getElementById('q-grafo-input');
        if (inp) inp.value = t.codice;
      });
      m._trlData = t;
      STATE.monitorMarkers.push(m);
    });
  } catch (e) { console.error(e); }
}

// Sostituisce i marker del campione con marker dedicati per i risultati query
// Usato da geo, search, semantic per garantire che mappa e tabella siano in sync
function showResultMarkers(rows) {
  if (!STATE.mapMonitor) return;
  // Nascondi tutti i marker del campione
  STATE.monitorMarkers.forEach(m => m.setStyle({ fillOpacity: 0, opacity: 0 }));
  // Rimuovi eventuali marker risultato precedenti
  STATE.geoResultMarkers.forEach(m => STATE.mapMonitor.removeLayer(m));
  STATE.geoResultMarkers = [];
  // Aggiungi marker per ogni risultato che ha coordinate
  rows.forEach(t => {
    if (!t.gis_location?.coordinates) return;
    const [lng, lat] = t.gis_location.coordinates;
    const color = COLORS[t.stato_operativo] || '#64748b';
    const m = L.circleMarker([lat, lng], {
      radius: 8, fillColor: color, color: '#ffffff', weight: 2, fillOpacity: 0.95
    }).addTo(STATE.mapMonitor);
    m.bindPopup(`<b>${t.codice}</b><br>${t.tipologia || ''}<br>${t.regione}<br>
      <span style="color:${color}">${(t.stato_operativo||'').replace(/_/g,' ')}</span>`);
    STATE.geoResultMarkers.push(m);
  });
  // Centra la mappa sui risultati
  if (STATE.geoResultMarkers.length > 0) {
    const group = L.featureGroup(STATE.geoResultMarkers);
    STATE.mapMonitor.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 13 });
  }
}

function highlightMonitor(ids, hideOthers = false) {
  const set = new Set(ids.map(String));
  STATE.monitorMarkers.forEach(m => {
    const hit = set.has(String(m._trlData._id));
    if (hideOthers && !hit) {
      m.setStyle({ fillOpacity: 0, opacity: 0, radius: 5 });
    } else {
      m.setStyle({
        fillOpacity: hit ? 1 : 0.15,
        opacity: 1,
        radius: hit ? 10 : 4,
        fillColor: hit ? COLORS[m._trlData.stato_operativo] : '#64748b'
      });
      if (hit) m.bringToFront();
    }
  });
}

function resetMonitorMap() {
  // Rimuovi marker geo dedicati
  STATE.geoResultMarkers.forEach(m => STATE.mapMonitor.removeLayer(m));
  STATE.geoResultMarkers = [];
  // Ripristina marker del campione
  STATE.monitorMarkers.forEach(m => {
    m.setStyle({ fillOpacity: 0.75, opacity: 1, radius: 5, fillColor: COLORS[m._trlData.stato_operativo] || '#64748b' });
  });
  if (STATE.geoCircle) { STATE.mapMonitor.removeLayer(STATE.geoCircle); STATE.geoCircle = null; }
  document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active-query'));
  document.getElementById('monitor-results').innerHTML =
    '<div id="results-placeholder">Seleziona una query per visualizzare i risultati</div>';
}

// ═══════════════════════════════════════════════════════════════
//  MONITOR — QUERIES
// ═══════════════════════════════════════════════════════════════
function toggleGeoPanel() {
  const panel = document.getElementById('geo-panel');
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen) document.getElementById('geo-city').focus();
}

async function runQuery(type) {
  document.querySelectorAll('.q-btn').forEach(b => b.classList.remove('active-query'));
  document.getElementById(`qbtn-${type}`)?.classList.add('active-query');

  const resultsDiv = document.getElementById('monitor-results');
  resultsDiv.innerHTML = '<div style="color:#475569; font-size:13px; padding:8px;">Esecuzione query…</div>';

  // Reset mappa highlights
  STATE.geoResultMarkers.forEach(m => STATE.mapMonitor?.removeLayer(m));
  STATE.geoResultMarkers = [];
  STATE.monitorMarkers.forEach(m => {
    m.setStyle({ fillOpacity: 0.75, opacity: 1, radius: 5, fillColor: COLORS[m._trlData.stato_operativo] || '#64748b' });
  });
  if (STATE.geoCircle) { STATE.mapMonitor.removeLayer(STATE.geoCircle); STATE.geoCircle = null; }

  let url = `/api/query/${type}`;
  let opts = {};

  if (type === 'geo') {
    const city = document.getElementById('geo-city').value.trim();
    const dist = parseInt(document.getElementById('geo-dist').value) || 80;
    if (!city) { resultsDiv.innerHTML = '<div style="color:#f97316; padding:8px;">Inserisci una città</div>'; return; }
    resultsDiv.innerHTML = '<div style="color:#475569; font-size:13px; padding:8px;">Ricerca coordinate per "' + city + '"…</div>';
    try {
      const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
        headers: { 'Accept-Language': 'it' }
      });
      const geoData = await geoRes.json();
      if (!geoData.length) { resultsDiv.innerHTML = '<div style="color:#f87171; padding:8px;">Città non trovata</div>'; return; }
      const lat = parseFloat(geoData[0].lat);
      const lng = parseFloat(geoData[0].lon);
      url += `?lat=${lat}&lng=${lng}&distance=${dist * 1000}`;
      // Store for circle drawing
      STATE._geoParams = { lat, lng, dist, city };
    } catch (e) {
      resultsDiv.innerHTML = `<div style="color:#f87171; padding:8px;">Geocoding fallito: ${e.message}</div>`;
      return;
    }
    resultsDiv.innerHTML = '<div style="color:#475569; font-size:13px; padding:8px;">Esecuzione query…</div>';
  }
  if (type === 'search') {
    const q = document.getElementById('q-search-input').value.trim();
    if (!q) { resultsDiv.innerHTML = '<div style="color:#f97316; padding:8px;">Inserisci testo da cercare</div>'; return; }
    url += `?q=${encodeURIComponent(q)}`;
  }
  if (type === 'semantic') {
    const t = document.getElementById('q-vector-input').value.trim();
    if (!t) { resultsDiv.innerHTML = '<div style="color:#f97316; padding:8px;">Inserisci una descrizione</div>'; return; }
    opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) };
    resultsDiv.innerHTML = `<div style="color:#475569; font-size:13px; padding:8px; display:flex; align-items:center; gap:8px;">
      <span style="display:inline-block; width:14px; height:14px; border:2px solid #3b82f6; border-top-color:transparent; border-radius:50%; animation:spin .7s linear infinite;"></span>
      Ricerca semantica + generazione risposta AI in corso…
    </div>`;
  }
  if (type === 'grafo') {
    const codice = document.getElementById('q-grafo-input').value.trim();
    const hops   = parseInt(document.getElementById('q-grafo-hops').value) || 5;
    if (!codice) {
      resultsDiv.innerHTML = '<div style="color:#f97316; padding:8px;">Clicca un traliccio sulla mappa oppure inserisci il codice</div>';
      return;
    }
    url += `?codice=${encodeURIComponent(codice)}&hops=${hops}`;
  }

  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(data, type, resultsDiv);
  } catch (e) {
    resultsDiv.innerHTML = `<div style="color:#f87171; padding:8px;">Errore: ${e.message}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  MONITOR — RENDER RESULTS
// ═══════════════════════════════════════════════════════════════
function renderResults(data, type, container) {
  // Geo query returns {results, meta} — unwrap it
  if (type === 'geo' && data && data.results) {
    data = data.results;
  }
  if (!data || (Array.isArray(data) && !data.length)) {
    container.innerHTML = '<div style="color:#475569; padding:8px; font-size:13px;">Nessun risultato</div>';
    return;
  }

  const ops = {
    kpi:              { label: 'KPI Dashboard globale',                                    op: 'A · $facet' },
    geo:              { label: STATE._geoParams ? `Manutenzione entro ${STATE._geoParams.dist}km da ${STATE._geoParams.city}` : 'Manutenzione vicino a…', op: 'B · $near · 2dsphere' },
    allarmi:          { label: 'Asset con allarmi IoT attivi o batteria < 20%',            op: 'C · $lookup · $unwind · $match' },
    'stats-cavi':     { label: 'Temperatura media cavi per regione',                       op: 'D · $group · $avg · $cond' },
    'doppio-rischio': { label: 'Tralicci con stato critico e tratta cavo critica',         op: 'E · $lookup pipeline · $match' },
    'salute-linee':   { label: 'Salute completa di ogni linea elettrica',                  op: 'F · DigiL → DigiC + Tralicci' },
    'stress-regione': { label: 'Indice di stress infrastrutturale per regione',            op: 'G · $group cross-collection' },
    'iot-estrema':    { label: 'IoT fuori soglia con correlazione cavo adiacente',         op: 'H · telemetria IoT + DigiC' },
    search:           { label: 'Risultati ricerca full-text',                              op: 'I · Search · lucene.italian · fuzzy' },
    semantic:         { label: 'Risultati ricerca semantica',                              op: 'J · $vectorSearch · cosine · Ollama' },
    grafo:            { label: 'Catena elettrica ($graphLookup)',                          op: 'K · $graphLookup · graph traversal' }
  };
  const meta = ops[type] || { label: '', op: '' };

  let html = `<div class="results-title">
    ${meta.label}
    <span class="badge-op">${meta.op}</span>
  </div>`;

  switch (type) {
    case 'geo':
      showResultMarkers(data);
      // Disegna cerchio e adatta vista (showResultMarkers fa già il fitBounds sui marker)
      if (STATE.mapMonitor && STATE._geoParams) {
        const { lat, lng, dist } = STATE._geoParams;
        STATE.geoCircle = L.circle([lat, lng], {
          radius: dist * 1000, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.07, weight: 1.5
        }).addTo(STATE.mapMonitor);
      }
      html += tableGeo(data);
      break;
    case 'allarmi':
      highlightMonitor(data.map(d => d._id));
      html += tableAllarmi(data);
      break;
    case 'stats-cavi':
      html += tableStatsCavi(data);
      break;
    case 'kpi':
      html += renderKpi(data[0]);
      break;
    case 'doppio-rischio':
      showResultMarkers(data);
      html += tableDobbioRischio(data);
      break;
    case 'salute-linee':
      html += tableSaluteLinee(data);
      break;
    case 'stress-regione':
      html += tableStressRegione(data);
      break;
    case 'iot-estrema':
      showResultMarkers(data.map(r => ({ ...r, gis_location: r.gis_location })));
      html += tableIotEstrema(data);
      break;
    case 'search':
      showResultMarkers(data);
      html += tableSearch(data);
      break;
    case 'grafo': {
      const allTrl = [data, ...(data.tralicci_catena || [])].filter(t => t.gis_location);
      showResultMarkers(allTrl);
      drawGrafoPolyline(data);
      html += tableGrafo(data);
      break;
    }
    case 'semantic': {
      const rows = data.results || data;
      const summary = data.summary || null;
      const llmError = data.llmError || null;
      showResultMarkers(rows);

      if (summary) {
        // Risposta AI protagonista
        html += `
          <div style="background:linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%); border:1px solid #7dd3fc; border-radius:10px; padding:16px 18px; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
              <span style="font-size:18px;">🤖</span>
              <span style="font-weight:700; font-size:13px; color:#0369a1; letter-spacing:.03em;">COMPANY ASSISTANT — SEMANTIC ANALYSIS</span>
            </div>
            <p style="margin:0; font-size:13.5px; line-height:1.75; color:#0c4a6e;">${summary}</p>
          </div>
          <details style="margin-bottom:8px;">
            <summary style="cursor:pointer; font-size:12px; color:#64748b; font-weight:600; padding:6px 0; user-select:none;">
              Dettagli tecnici — ${rows.length} asset individuati ▾
            </summary>
            <div style="margin-top:6px;">${tableSearch(rows)}</div>
          </details>`;
      } else {
        // Nessun modello LLM disponibile — mostra solo la lista con avviso
        if (llmError) {
          html += `<div style="background:#fef9c3; border:1px solid #fde047; border-radius:8px; padding:10px 14px; margin-bottom:10px; font-size:12px; color:#713f12;">
            ⚠️ Risposta AI non disponibile: <em>${llmError}</em>
          </div>`;
        }
        html += tableSearch(rows);
      }
      break;
    }
  }

  container.innerHTML = html;
}

// ── Table helpers ──────────────────────────────────────────────
function statoB(s) {
  return `<span class="badge-stato s-${s}">${(s||'').replace(/_/g,' ')}</span>`;
}

function battCell(v) {
  const pct = Math.min(100, Math.max(0, v));
  const color = pct < 20 ? '#ef4444' : pct < 50 ? '#f97316' : '#22c55e';
  return `<div class="batt-wrap">
    <div class="batt-bar"><div class="batt-fill" style="width:${pct}%; background:${color};"></div></div>
    <span class="batt-num" style="color:${color};">${pct}%</span>
  </div>`;
}

function scoreCell(v) {
  const pct = Math.min(100, Math.round((v || 0) * 100));
  return `<div class="score-wrap">
    <div class="score-bar"><div class="score-fill" style="width:${pct}%;"></div></div>
    <span class="score-num">${typeof v === 'number' ? v.toFixed(3) : v}</span>
  </div>`;
}

function tableGeo(rows) {
  return `<table class="res-table">
    <thead><tr><th>Codice</th><th>Nome</th><th>Regione</th><th>Tensione</th><th>Anno</th><th>Stato</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-family:monospace; font-weight:700;">${r.codice}</td>
      <td style="color:#94a3b8;">${r.nome || '—'}</td>
      <td>${r.regione}</td>
      <td>${r.tensione_kv} kV</td>
      <td>${r.anno_installazione || '—'}</td>
      <td>${statoB(r.stato_operativo)}</td>
    </tr>`).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} risultati${rows.length === 100 ? ' (limite 100)' : ''} · entro ${STATE._geoParams?.dist ?? 80}km da ${STATE._geoParams?.city ?? 'Roma'} · stato: in_manutenzione</div>`;
}

function tableAllarmi(rows) {
  return `<table class="res-table">
    <thead><tr><th>Traliccio</th><th>Regione</th><th>Stato</th><th>Batteria</th><th>Allarmi Attivi</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-family:monospace; font-weight:700;">${r.codice}</td>
      <td>${r.regione}</td>
      <td>${statoB(r.stato_operativo)}</td>
      <td>${battCell(r.iot?.livello_batteria ?? 0)}</td>
      <td>${(r.iot?.allarmi_attivi || []).map(a => `<span class="badge-alarm">${a}</span>`).join('') || '<span style="color:#475569">nessuno</span>'}</td>
    </tr>`).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} asset con problemi</div>`;
}

function tableStatsCavi(rows) {
  const maxTemp = Math.max(...rows.map(r => r.temp_media));
  return `<table class="res-table">
    <thead><tr><th>Regione</th><th>Temp Media (°C)</th><th>Corrente Media (A)</th><th>N° Tratte</th><th>In Sovraccarico</th></tr></thead>
    <tbody>${rows.map(r => {
      const pct = Math.round((r.temp_media / maxTemp) * 100);
      const color = r.temp_media > 70 ? '#ef4444' : r.temp_media > 55 ? '#f97316' : '#22c55e';
      return `<tr>
        <td style="font-weight:700;">${r.regione}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="width:70px; height:8px; background:#1e293b; border-radius:4px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:${color}; border-radius:4px;"></div>
            </div>
            <span style="color:${color}; font-weight:700;">${r.temp_media}°C</span>
          </div>
        </td>
        <td>${r.corrente_media} A</td>
        <td>${r.num_tratte}</td>
        <td><span style="color:${r.tratte_in_sovraccarico > 0 ? '#f97316' : '#22c55e'}; font-weight:700;">${r.tratte_in_sovraccarico}</span></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderKpi(d) {
  if (!d) return '';
  const totale = d.totale?.[0]?.n ?? 0;

  const card = (title, items) => `
    <div class="kpi-card">
      <div class="kpi-card-title">${title}</div>
      ${items.map(i => `<div class="kpi-item">
        <span class="kpi-item-label">${(i._id || '—').replace(/_/g,' ')}</span>
        <span class="kpi-item-val">${i.count.toLocaleString()}</span>
      </div>`).join('')}
    </div>`;

  return `<div class="kpi-grid">
    <div class="kpi-card kpi-total-card">
      <div class="kpi-total-num">${totale.toLocaleString()}</div>
      <div class="kpi-total-label">Tralicci totali</div>
    </div>
    ${card('Per Stato', d.per_stato || [])}
    ${card('Per Regione', d.per_regione || [])}
    ${card('Per Tipologia', d.per_tipologia || [])}
  </div>`;
}

function tableSearch(rows) {
  return `<table class="res-table">
    <thead><tr><th>Codice</th><th>Tipologia</th><th>Regione</th><th>Installazione</th><th>Stato</th><th>Score</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <td style="font-family:monospace; font-weight:700;">${r.codice}</td>
        <td>${r.tipologia}</td>
        <td>${r.regione}</td>
        <td style="font-family:monospace; color:#475569;">${r.anno_installazione || '—'}</td>
        <td>${statoB(r.stato_operativo)}</td>
        <td>${scoreCell(r.score)}</td>
      </tr>
      ${r.descrizione ? `<tr><td colspan="6" style="color:#64748b; font-size:11px; padding:2px 8px 8px; border-bottom:1px solid #f1f5f9; line-height:1.5;">${r.descrizione.length > 200 ? r.descrizione.slice(0, 200) + '…' : r.descrizione}</td></tr>` : ''}
    `).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} risultati</div>`;
}

// ── E: Tralicci a doppio rischio ──────────────────────────────────────────────
function tableDobbioRischio(rows) {
  const statoTratta = s => {
    const c = s === 'guasto' ? '#ef4444' : '#f97316';
    return `<span style="background:${c}18; color:${c}; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600;">${s}</span>`;
  };
  return `<table class="res-table">
    <thead><tr><th>Traliccio</th><th>Regione</th><th>Stato torre</th><th>Tratte critiche</th><th>Max T° cavo</th></tr></thead>
    <tbody>${rows.map(r => {
      const maxTemp = Math.max(...(r.tratte_critiche || []).map(t => t.temperatura_cavo_celsius || 0));
      const tratteBadge = (r.tratte_critiche || []).map(t => statoTratta(t.stato)).join(' ');
      return `<tr>
        <td style="font-family:monospace; font-weight:700;">${r.codice}</td>
        <td>${r.regione}</td>
        <td>${statoB(r.stato_operativo)}</td>
        <td>${tratteBadge}</td>
        <td style="font-weight:700; color:${maxTemp > 80 ? '#ef4444' : '#f97316'};">${maxTemp > 0 ? maxTemp.toFixed(1) + ' °C' : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} asset con doppia criticità (struttura + cavo)</div>`;
}

// ── F: Salute linee complete ───────────────────────────────────────────────────
function tableSaluteLinee(rows) {
  const dispColor = v => v >= 98 ? '#16a34a' : v >= 94 ? '#d97706' : '#dc2626';
  return `<table class="res-table">
    <thead><tr><th>Linea</th><th>Stato</th><th>Disponibilità</th><th>Potenza MW</th><th>Tratte sovraccrico/guasto</th><th>Torri non attive</th><th>T° media cavi</th></tr></thead>
    <tbody>${rows.map(r => {
      const disp = r.disponibilita_percentuale || 0;
      const cavi = r.cavi || {};
      const torri = r.torri || {};
      const critiche = (cavi.sovraccarico || 0) + (cavi.guasto || 0);
      return `<tr>
        <td style="font-weight:700; font-size:12px;">${r.nome_linea}</td>
        <td>${statoB(r.stato)}</td>
        <td style="font-weight:700; color:${dispColor(disp)};">${disp}%</td>
        <td style="font-family:monospace;">${r.potenza_mw || '—'}</td>
        <td style="font-weight:700; color:${critiche > 0 ? '#ef4444' : '#22c55e'};">${critiche} / ${cavi.tratte_totali || 0}</td>
        <td style="color:${(torri.in_manutenzione + torri.fuori_servizio) > 0 ? '#f97316' : '#64748b'};">${(torri.in_manutenzione || 0) + (torri.fuori_servizio || 0)} / ${torri.totale || 0}</td>
        <td style="font-family:monospace;">${cavi.temp_media ? cavi.temp_media.toFixed(1) + ' °C' : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} linee · ordinate per disponibilità crescente</div>`;
}

// ── G: Stress per regione ──────────────────────────────────────────────────────
function tableStressRegione(rows) {
  const stressColor = (temp, pct) => {
    const score = (temp / 90) * 0.5 + (pct / 30) * 0.5;
    return score > 0.7 ? '#dc2626' : score > 0.4 ? '#d97706' : '#16a34a';
  };
  return `<table class="res-table">
    <thead><tr><th>Regione</th><th>T° media cavi</th><th>Corrente media</th><th>Tratte critiche</th><th>Torri non attive</th><th>% non attive</th></tr></thead>
    <tbody>${rows.map(r => {
      const col = stressColor(r.temp_media, r.pct_non_attivi);
      return `<tr>
        <td style="font-weight:700;">${r.regione}</td>
        <td style="font-family:monospace; font-weight:700; color:${r.temp_media > 75 ? '#ef4444' : '#475569'};">${r.temp_media} °C</td>
        <td style="font-family:monospace;">${r.corrente_media} A</td>
        <td style="color:${r.tratte_critiche > 0 ? '#ef4444' : '#64748b'}; font-weight:${r.tratte_critiche > 0 ? 700 : 400};">${r.tratte_critiche} / ${r.tratte_totali}</td>
        <td>${r.tralicci_non_attivi || 0} / ${r.tralicci_totali || 0}</td>
        <td style="font-weight:700; color:${col};">${r.pct_non_attivi || 0}%</td>
      </tr>`;
    }).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} regioni · ordinate per temperatura decrescente</div>`;
}

// ── K: Catena elettrica $graphLookup ──────────────────────────────────────────
function drawGrafoPolyline(data) {
  if (!STATE.mapMonitor || !data.gis_location) return;
  const byId = {};
  (data.tralicci_catena || []).forEach(t => { byId[String(t._id)] = t; });
  const catena = (data.catena || []).slice().sort((a, b) => a.hop - b.hop);
  const pts = [[data.gis_location.coordinates[1], data.gis_location.coordinates[0]]];
  catena.forEach(c => {
    const t = byId[String(c.traliccio_a_id)];
    if (t?.gis_location) pts.push([t.gis_location.coordinates[1], t.gis_location.coordinates[0]]);
  });
  if (pts.length > 1) {
    const line = L.polyline(pts, { color: '#3b82f6', weight: 3, opacity: 0.85, dashArray: null }).addTo(STATE.mapMonitor);
    STATE.geoResultMarkers.push(line);
  }
}

function tableGrafo(data) {
  const catena = (data.catena || []).slice().sort((a, b) => a.hop - b.hop);
  const byId   = {};
  (data.tralicci_catena || []).forEach(t => { byId[String(t._id)] = t; });

  const totKm  = catena.reduce((s, c) => s + (c.lunghezza_km || 0), 0);
  const critici = catena.filter(c => c.stato_cavo !== 'normale').length;

  let html = `
    <div style="display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
      <div style="background:#eff6ff; border-radius:8px; padding:10px 14px; border:1px solid #bfdbfe; text-align:center; min-width:80px;">
        <div style="font-size:22px; font-weight:900; color:#1d4ed8;">${catena.length}</div>
        <div style="font-size:11px; color:#64748b;">segmenti</div>
      </div>
      <div style="background:#f0fdf4; border-radius:8px; padding:10px 14px; border:1px solid #bbf7d0; text-align:center; min-width:80px;">
        <div style="font-size:22px; font-weight:900; color:#16a34a;">${totKm.toFixed(1)}</div>
        <div style="font-size:11px; color:#64748b;">km totali</div>
      </div>
      ${critici > 0 ? `<div style="background:#fef2f2; border-radius:8px; padding:10px 14px; border:1px solid #fecaca; text-align:center; min-width:80px;">
        <div style="font-size:22px; font-weight:900; color:#dc2626;">${critici}</div>
        <div style="font-size:11px; color:#64748b;">critici</div>
      </div>` : ''}
    </div>
    <div style="font-size:12px; color:#475569; margin-bottom:10px;">
      Partenza: <strong>${data.codice}</strong> · ${data.tipologia} · ${data.regione} · ${statoB(data.stato_operativo)}
    </div>`;

  if (!catena.length) {
    return html + '<div style="color:#94a3b8; font-size:12px; padding:8px;">Nessuna tratta in avanti trovata — questo traliccio potrebbe essere al termine della linea</div>';
  }

  html += `<table class="res-table">
    <thead><tr><th>Hop</th><th>Tratta</th><th>Stato cavo</th><th>T° cavo</th><th>Km</th><th>Traliccio dest.</th><th>Stato dest.</th></tr></thead>
    <tbody>${catena.map(c => {
      const dest = byId[String(c.traliccio_a_id)];
      const cc   = c.stato_cavo === 'guasto' ? '#ef4444' : c.stato_cavo === 'sovraccarico' ? '#f97316' : '#22c55e';
      return `<tr>
        <td style="font-family:monospace; font-weight:700; color:#3b82f6;">${c.hop}</td>
        <td style="font-family:monospace; font-size:11px;">${c.digic_codice}</td>
        <td><span style="background:${cc}18; color:${cc}; padding:2px 7px; border-radius:4px; font-size:11px; font-weight:600;">${c.stato_cavo}</span></td>
        <td style="font-family:monospace;">${c.temp_cavo?.toFixed(1) ?? '—'} °C</td>
        <td style="font-family:monospace;">${c.lunghezza_km?.toFixed(1) ?? '—'}</td>
        <td style="font-family:monospace; font-weight:700; font-size:11px;">${dest?.codice ?? '—'}</td>
        <td>${dest ? statoB(dest.stato_operativo) : '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  <div class="text-muted" style="margin-top:8px;">${catena.length} segmenti cavo · ${totKm.toFixed(1)}km · traversal in avanti con $graphLookup</div>`;

  return html;
}

// ── H: IoT fuori soglia + cavo adiacente ──────────────────────────────────────
function tableIotEstrema(rows) {
  const alarmBadge = a => `<span style="background:#fef2f2; color:#dc2626; padding:1px 5px; border-radius:3px; font-size:10px; font-weight:700; margin-right:2px;">${a}</span>`;
  return `<table class="res-table">
    <thead><tr><th>IoT</th><th>Traliccio</th><th>Regione</th><th>Vibraz. Hz</th><th>T° IoT</th><th>Allarmi</th><th>Cavo adiac.</th><th>T° cavo</th></tr></thead>
    <tbody>${rows.map(r => `<tr>
      <td style="font-family:monospace; font-size:11px;">${r.iot_codice}</td>
      <td style="font-family:monospace; font-weight:700;">${r.trl_codice || '—'}</td>
      <td>${r.trl_regione || '—'}</td>
      <td style="font-weight:700; color:${(r.vibrazione_hz||0) > 40 ? '#ef4444' : '#f97316'};">${r.vibrazione_hz?.toFixed(1) || '—'}</td>
      <td style="font-family:monospace;">${r.temp_iot?.toFixed(1) || '—'} °C</td>
      <td>${(r.allarmi_attivi || []).map(alarmBadge).join('') || '<span style="color:#94a3b8">—</span>'}</td>
      <td style="font-size:11px; color:#64748b;">${r.cavo?.codice || '—'} ${r.cavo ? statoB(r.cavo.stato) : ''}</td>
      <td style="font-family:monospace; color:${(r.cavo?.temperatura_cavo_celsius||0) > 80 ? '#ef4444' : '#475569'};">${r.cavo?.temperatura_cavo_celsius?.toFixed(1) || '—'} ${r.cavo ? '°C' : ''}</td>
    </tr>`).join('')}</tbody>
  </table><div class="text-muted" style="margin-top:8px;">${rows.length} sensori fuori soglia · ordinati per vibrazione decrescente</div>`;
}
