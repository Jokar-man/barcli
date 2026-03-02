mapboxgl.accessToken = "pk.eyJ1IjoibGFrc2htaS1kYmYxNSIsImEiOiJjbWdnYWM4cTYwZ2czMmtzY3k0cHlrZTA0In0.AwWDdoOtmRZNAXz1s4yQxw";

const CENTER = [2.1734, 41.3851];
let points       = null;
let activeFields = [];
let stats        = {};
let cadastralData = null;
let centerFocusKm = 5;

// Second map instance for impact comparison
let mapImpact = null;

// AI impact state
let impactData = null;
const ALPHA = 0.6;   // local vs citywide blend  (SCIENTIFIC_WORKFLOW α)
const BETA  = 0.5;   // policy strength scaling   (SCIENTIFIC_WORKFLOW β)
const AI_API_URL = "https://jokar-man-urban-climate-model.hf.space";

// Compare divider drag state
let dividerX   = 0;
let isDragging = false;

/* ================================================
   COLOUR EXPRESSIONS  (identical on both maps)
   Same scale as original: 0=dark-blue → 1=red
   ================================================ */
const HALO_COLOR = [
  "interpolate", ["linear"], ["get", "_value"],
  0,   "rgba(0,120,255,0)",
  0.1, "rgba(0,120,255,0.12)",
  0.5, "rgba(0,255,180,0.18)",
  0.8, "rgba(255,220,0,0.24)",
  1,   "rgba(255,0,80,0.32)"
];

const CORE_COLOR = [
  "interpolate", ["linear"], ["get", "_value"],
  0.0, "rgba(50,50,50,0)",
  0.2, "rgb(0,120,255)",
  0.5, "rgb(0,255,180)",
  0.8, "rgb(255,220,0)",
  1.0, "rgb(255,0,80)"
];

/* ================================================
   HELPERS: add shared layers to a map instance
   ================================================ */
function removeSymbolLayers(m) {
  m.getStyle().layers.forEach(layer => {
    if (layer.type === "symbol") {
      try { m.removeLayer(layer.id); } catch (e) { /* ignore */ }
    }
  });
}

function addBuildingLayers(m, data, prefix) {
  // Use "waterway-label" as insert-before anchor only if it still exists
  const beforeLayer = m.getLayer("waterway-label") ? "waterway-label" : undefined;

  if (data) {
    m.addSource(`cadastral-${prefix}`, { type: "geojson", data });
    m.addLayer({
      id: `3d-cadastral-${prefix}`,
      type: "fill-extrusion",
      source: `cadastral-${prefix}`,
      paint: {
        "fill-extrusion-color":   "#00eaff",
        "fill-extrusion-height":  ["*", ["get", "numberOfFloorsAboveGround"], 3.5],
        "fill-extrusion-base":    0,
        "fill-extrusion-opacity": 0.28
      }
    }, beforeLayer);
  }

  m.addLayer({
    id: `3d-default-${prefix}`,
    source: "composite",
    "source-layer": "building",
    filter: ["all", ["has", "height"], ["has", "min_height"]],
    type: "fill-extrusion",
    minzoom: 13,
    paint: {
      "fill-extrusion-color":   "#00eaff",
      "fill-extrusion-height":  ["get", "height"],
      "fill-extrusion-base":    ["get", "min_height"],
      "fill-extrusion-opacity": 0.1
    }
  }, beforeLayer);
}

function addGlowLayers(m, sourceId, prefix) {
  m.addLayer({
    id: `glow-halo-${prefix}`,
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 5, 16, 25],
      "circle-color":  HALO_COLOR,
      "circle-blur":   0.8,
      "circle-opacity": 1
    }
  });

  m.addLayer({
    id: `glow-core-${prefix}`,
    type: "circle",
    source: sourceId,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2, 16, 8],
      "circle-color":  CORE_COLOR,
      "circle-opacity": 0.7
    }
  });
}

/* ================================================
   MAP INITIALISATION
   ================================================ */
const map = new mapboxgl.Map({
  container: "map",
  style:     "mapbox://styles/mapbox/dark-v11",
  center:    CENTER,
  zoom:      13.5,
  pitch:     0,
  bearing:   0,
  maxPitch:  0,
  antialias: true,
  minZoom:   10,
  maxZoom:   18
});
map.dragRotate.disable();
map.touchZoomRotate.disableRotation();

map.on("load", async () => {

  // ── Load cadastral buildings ──────────────────
  try {
    cadastralData = await fetch("data/barcelona_buildings.geojson").then(r => r.json());
  } catch (err) {
    console.error("Could not load cadastral buildings:", err);
  }

  // Buildings must be added BEFORE symbol layers are removed,
  // because "waterway-label" (the insert-before anchor) is itself a symbol layer.
  addBuildingLayers(map, cadastralData, "main");
  removeSymbolLayers(map);

  // ── Load vulnerability points ─────────────────
  try {
    const resp = await fetch("data/data.geojson");
    points = JSON.parse(await resp.text());
  } catch (err) {
    alert("ERROR: data/data.geojson not found.");
    return;
  }

  computeStats();

  // ── Main map: original data source + glow layers ──
  map.addSource("points-main", { type: "geojson", data: points });
  addGlowLayers(map, "points-main", "main");

  // ── Initialise impact map ─────────────────────
  mapImpact = new mapboxgl.Map({
    container:   "map-impact",
    style:       "mapbox://styles/mapbox/dark-v11",
    center:      CENTER,
    zoom:        13.5,
    pitch:       0,
    bearing:     0,
    maxPitch:    0,
    antialias:   true,
    interactive: false    // user interacts only with the main map
  });

  await new Promise(res => mapImpact.once("load", res));

  addBuildingLayers(mapImpact, cadastralData, "impact");
  removeSymbolLayers(mapImpact);

  // Impact data source starts empty; populated after AI analysis
  mapImpact.addSource("points-impact", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });
  addGlowLayers(mapImpact, "points-impact", "impact");

  // ── Camera sync: main → impact ────────────────
  // Using 'move' covers pan, zoom, rotate, pitch in one event
  map.on("move", () => {
    mapImpact.jumpTo({
      center:  map.getCenter(),
      zoom:    map.getZoom(),
      bearing: map.getBearing(),
      pitch:   map.getPitch()
    });
  });

  // ── Misc map events ───────────────────────────
  map.on("mouseenter", "glow-core-main", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "glow-core-main", () => map.getCanvas().style.cursor = "");

  // ── UI setup ──────────────────────────────────
  setupButtons();
  setupRadiusControl();
  setupInfoModal();
  setupDivider();
  updateVisualization();
});

/* ================================================
   STATS + NORMALISATION
   ================================================ */
function computeStats() {
  // Sub-field stats for urban health components
  const subData = { immigrant1: [], income1: [], pop_sex3: [] };
  points.features.forEach(f => {
    const p = f.properties;
    subData.immigrant1.push(+p.immigrant1 || 0);
    subData.income1.push(  +p.income1    || 0);
    subData.pop_sex3.push( +p.pop_sex3   || 0);
  });

  const subStats = {};
  Object.keys(subData).forEach(k => {
    const s = subData[k].filter(isFinite).sort((a, b) => a - b);
    const n = s.length;
    const mn = s[Math.floor(n * 0.05)] || 0;
    const mx = s[Math.floor(n * 0.95)] || 1;
    subStats[k] = { min: mn, max: mx, range: Math.max(1e-6, mx - mn) };
  });

  // Pre-compute _urban_health on each feature:
  //   immigrants (direct) + income (inverted → lower income = higher vuln) + population (direct)
  points.features.forEach(f => {
    const p = f.properties;
    const nImm = Math.min(1, Math.max(0, ((+p.immigrant1 || 0) - subStats.immigrant1.min) / subStats.immigrant1.range));
    const nInc = Math.min(1, Math.max(0, ((+p.income1   || 0) - subStats.income1.min)    / subStats.income1.range));
    const nPop = Math.min(1, Math.max(0, ((+p.pop_sex3  || 0) - subStats.pop_sex3.min)   / subStats.pop_sex3.range));
    p._urban_health = (nImm + (1 - nInc) + nPop) / 3;
  });

  // Field-level stats (5th–95th percentile stretch)
  const fields = { heat: [], SPEI: [], urban_health: [] };
  points.features.forEach(f => {
    const p = f.properties;
    fields.heat.push(computeRaw(p, "heat"));
    fields.SPEI.push(computeRaw(p, "SPEI"));
    fields.urban_health.push(p._urban_health);
  });

  Object.keys(fields).forEach(k => {
    const a = fields[k].filter(x => x != null && isFinite(x)).sort((x, y) => x - y);
    const n = a.length;
    if (n === 0) { stats[k] = { min: 0, max: 1, range: 1 }; return; }
    stats[k] = {
      min:   a[Math.floor(n * 0.05)] || 0,
      max:   a[Math.floor(n * 0.95)] || 1
    };
    stats[k].range = Math.max(1e-6, stats[k].max - stats[k].min);
  });

  console.log("Stats computed:", stats);
}

function normalize(raw, f) {
  const s = stats[f];
  if (!s || s.range === 0) return 0;
  return Math.min(1, Math.max(0, (raw - s.min) / s.range));
}

function computeRaw(p, f) {
  if (f === "heat")         return ((+p.LST1 || 0) + (+p.uhi2 || 0)) / 2;
  if (f === "urban_health") return p._urban_health || 0;
  return +p[f] || 0;
}

/* ================================================
   UI – BUTTONS, RADIUS, INFO MODAL
   ================================================ */
function setupButtons() {
  document.querySelectorAll("#panel button[data-field]").forEach(btn => {
    btn.onclick = () => {
      const f = btn.dataset.field;
      if (activeFields.includes(f)) {
        activeFields = activeFields.filter(x => x !== f);
        btn.classList.remove("active");
      } else {
        activeFields.push(f);
        btn.classList.add("active");
      }
      updateVisualization();
    };
  });
}

function setupRadiusControl() {
  const slider = document.getElementById("radius-slider");
  const label  = document.getElementById("radius-val");
  slider.oninput = () => {
    centerFocusKm = Number(slider.value);
    label.textContent = `${centerFocusKm.toFixed(1)} km`;
    updateVisualization();
  };
}

function setupInfoModal() {
  const icon  = document.getElementById("info-icon");
  const modal = document.getElementById("info-modal");
  icon.onclick  = () => { modal.style.display = "block"; };
  window.onclick = e => { if (e.target === modal) modal.style.display = "none"; };
}

/* ================================================
   COMPARE DIVIDER
   ================================================ */
function setupDivider() {
  const el = document.getElementById("compare-divider");

  // Mouse
  el.addEventListener("mousedown", e => { isDragging = true; e.preventDefault(); });
  document.addEventListener("mousemove", e => { if (isDragging) moveDivider(e.clientX); });
  document.addEventListener("mouseup",   () => { isDragging = false; });

  // Touch
  el.addEventListener("touchstart",  e => { isDragging = true; e.preventDefault(); }, { passive: false });
  document.addEventListener("touchmove",  e => { if (isDragging) moveDivider(e.touches[0].clientX); }, { passive: false });
  document.addEventListener("touchend",   () => { isDragging = false; });
}

function moveDivider(x) {
  // Keep inside the map area (clear of left panel ~240 px and right chat ~380 px)
  const minX = 240;
  const maxX = window.innerWidth - 380;
  dividerX = Math.max(minX, Math.min(maxX, x));

  document.getElementById("compare-divider").style.left = dividerX + "px";
  // Show only the portion of the impact map to the RIGHT of the divider line
  document.getElementById("map-impact").style.clipPath  = `inset(0 0 0 ${dividerX}px)`;
}

function showCompare() {
  // Default position: centre of the usable map area
  if (dividerX === 0) {
    dividerX = (window.innerWidth - 370) / 2;
  }

  const impactEl   = document.getElementById("map-impact");
  const dividerEl  = document.getElementById("compare-divider");

  impactEl.style.clipPath   = `inset(0 0 0 ${dividerX}px)`;
  dividerEl.style.display   = "flex";
  dividerEl.style.left      = dividerX + "px";

  // Trigger canvas resize if first reveal
  if (mapImpact) mapImpact.resize();
}

function hideCompare() {
  document.getElementById("map-impact").style.clipPath      = "inset(0 0 0 100%)";
  document.getElementById("compare-divider").style.display  = "none";
}

/* ================================================
   VISUALISATION
   ================================================ */
function updateVisualization() {
  // Update _value and _inFocus on every original feature
  points.features.forEach(f => {
    const p    = f.properties;
    p._inFocus = getDistance(CENTER, f.geometry.coordinates) <= centerFocusKm;

    if (activeFields.length === 0) { p._value = 0; return; }

    let sum = 0;
    activeFields.forEach(k => sum += normalize(computeRaw(p, k), k));
    p._value = sum / activeFields.length;
  });

  map.getSource("points-main").setData(points);

  if (impactData && activeFields.length > 0) {
    updateImpactSource();
    showCompare();
  } else {
    hideCompare();
  }
}

/* ================================================
   IMPACT SOURCE UPDATE
   Scientific formula (SCIENTIFIC_WORKFLOW.md):
   ─────────────────────────────────────────────
   I_local  = δ_local × c_local × (w_H×H + w_D×D + w_P×P)
   I_city   = δ_city  × c_city  × (w_H×H + w_D×D + w_P×P)
   I_final  = α × I_local + (1−α) × I_city
            = blend × (w_H×H + w_D×D + w_P×P)
     where blend = α×δ_local×c_local + (1−α)×δ_city×c_city

   For dimension-specific display (e.g. "Heat" button active):
     I_dim   = blend × w_dim × V_baseline_dim
     V_new   = clip(V_baseline_dim + β × I_dim, 0, 1)
             = clip(V_baseline_dim × (1 + β × blend × w_dim), 0, 1)

   V_new uses the same [0,1] range → same colour scale as baseline.
   ================================================ */
function updateImpactSource() {
  if (!mapImpact) return;

  const local      = impactData.neighborhood_level;
  const city       = impactData.city_level;
  const isCitywide = impactData.is_citywide || false;
  const targetBarri = (impactData.analyzed_neighborhood || "").toLowerCase().trim();

  const δ_local = local.direction === "Aggravation" ? 1 : -1;
  const δ_city  = city.direction  === "Aggravation" ? 1 : -1;

  // Macro-impact weights per level (city falls back to local if not provided)
  const lMacro = local.macro_impact || {};
  const cMacro = city.macro_impact  || lMacro;

  const localWeightOf = {
    heat:         lMacro["Heat risk"]    || 0,
    SPEI:         lMacro["Drought risk"] || 0,
    urban_health: lMacro["Urban health"] || 0
  };
  const cityWeightOf = {
    heat:         cMacro["Heat risk"]    || 0,
    SPEI:         cMacro["Drought risk"] || 0,
    urban_health: cMacro["Urban health"] || 0
  };

  const impactFeatures = points.features.map(f => {
    const p = f.properties;

    // Match this point's neighborhood against the AI-detected target
    const barriName = (p.N_Barri || "").toLowerCase().trim();
    const isInNeighborhood = isCitywide
      || targetBarri === ""
      || barriName.includes(targetBarri)
      || targetBarri.includes(barriName);

    let V_sum = 0;
    let count = 0;

    activeFields.forEach(k => {
      const V_base = normalize(computeRaw(p, k), k);

      let V_new;
      if (isInNeighborhood) {
        // Full α-blend of local and city effects for the target neighbourhood
        const I_local = δ_local * local.confidence * localWeightOf[k];
        const I_city  = δ_city  * city.confidence  * cityWeightOf[k];
        const I_dim   = ALPHA * I_local + (1 - ALPHA) * I_city;
        V_new = Math.min(1, Math.max(0, V_base + BETA * I_dim * V_base));
      } else {
        // City-level spillover only for points outside the target neighbourhood
        const I_city = δ_city * city.confidence * cityWeightOf[k];
        V_new = Math.min(1, Math.max(0, V_base + BETA * I_city * V_base));
      }

      V_sum += V_new;
      count++;
    });

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        // All points visible on impact map — no circular radius clip
        _value:   count > 0 ? V_sum / count : 0,
        _inFocus: p._inFocus
      }
    };
  });

  mapImpact.getSource("points-impact").setData({
    type: "FeatureCollection",
    features: impactFeatures
  });
}

/* ================================================
   POLICY ANALYSIS  (chat UI + AI call)
   ================================================ */
async function analysePolicy() {
  const inputEl  = document.getElementById("policy-input");
  const btn      = document.getElementById("analyse-btn");
  const messages = document.getElementById("chat-messages");

  const policyText = inputEl.value.trim();
  if (!policyText) {
    inputEl.classList.add("input-error");
    setTimeout(() => inputEl.classList.remove("input-error"), 1200);
    return;
  }

  // User message bubble
  const userBubble = document.createElement("div");
  userBubble.className   = "chat-user-msg";
  userBubble.textContent = policyText;
  messages.appendChild(userBubble);

  // Thinking indicator
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-thinking";
  thinkingEl.innerHTML  = "<span></span><span></span><span></span>";
  messages.appendChild(thinkingEl);
  messages.scrollTop = messages.scrollHeight;

  btn.disabled    = true;
  btn.textContent = "Analysing...";
  inputEl.value   = "";

  try {
    const response = await fetch(`${AI_API_URL}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sentence: policyText, year: 2024 })
    });

    if (!response.ok) throw new Error(`API status ${response.status}`);

    const aiResult = await response.json();
    thinkingEl.remove();

    impactData = aiResult;
    renderChatResult(aiResult);

    // If a layer is already active, show the comparison immediately
    if (activeFields.length > 0) {
      updateImpactSource();
      showCompare();
    }

  } catch (err) {
    thinkingEl.remove();
    const errEl = document.createElement("div");
    errEl.className   = "chat-error";
    errEl.textContent = `Analysis failed: ${err.message}`;
    messages.appendChild(errEl);
    console.error("analysePolicy:", err);
  }

  btn.disabled    = false;
  btn.textContent = "Analyse";
  messages.scrollTop = messages.scrollHeight;
}

function renderChatResult(aiResult) {
  const messages = document.getElementById("chat-messages");

  const local        = aiResult.neighborhood_level;
  const city         = aiResult.city_level;
  const isMitigation = local.direction === "Mitigation";
  const confPct      = Math.round(local.confidence * 100);
  const neighborhood = aiResult.analyzed_neighborhood || "Barcelona";
  const isCitywide   = aiResult.is_citywide || false;

  const macro      = local.macro_impact || {};
  const heatPct    = Math.round((macro["Heat risk"]    || 0) * 100);
  const droughtPct = Math.round((macro["Drought risk"] || 0) * 100);
  const urbanPct   = Math.round((macro["Urban health"] || 0) * 100);

  // Top 4 drivers by magnitude
  const drivers    = local.drivers || {};
  const topDrivers = Object.entries(drivers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  const driversHtml = topDrivers.map(([name, val]) => {
    const pct = Math.round(val * 100);
    return `
      <div class="driver-row">
        <span class="driver-label">${name}</span>
        <div class="driver-bar-track">
          <div class="driver-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="driver-pct">${pct}%</span>
      </div>`;
  }).join("");

  const cityDir   = city.direction === "Mitigation" ? "↓ Mitigation" : "↑ Aggravation";
  const cityConf  = Math.round(city.confidence * 100);
  const cityColor = city.direction === "Mitigation" ? "#00cc66" : "#ff4466";

  const card = document.createElement("div");
  card.className = "result-card";
  card.innerHTML = `
    <div class="result-meta">
      <span class="result-neighborhood">📍 ${neighborhood}</span>
      ${isCitywide ? '<span class="citywide-tag">Citywide</span>' : ""}
    </div>

    <div class="result-direction ${isMitigation ? "mitigation" : "aggravation"}">
      ${isMitigation ? "↓ MITIGATION" : "↑ AGGRAVATION"}
      <span class="confidence-badge">${confPct}% confidence</span>
    </div>

    <div class="result-section">
      <div class="section-label">Impact Weights</div>
      <div class="weight-row">
        <span class="weight-label">Heat Risk</span>
        <div class="weight-bar-track"><div class="weight-bar-fill heat-w" style="width:${heatPct}%"></div></div>
        <span class="weight-pct">${heatPct}%</span>
      </div>
      <div class="weight-row">
        <span class="weight-label">Drought Risk</span>
        <div class="weight-bar-track"><div class="weight-bar-fill drought-w" style="width:${droughtPct}%"></div></div>
        <span class="weight-pct">${droughtPct}%</span>
      </div>
      <div class="weight-row">
        <span class="weight-label">Urban Health</span>
        <div class="weight-bar-track"><div class="weight-bar-fill urban-w" style="width:${urbanPct}%"></div></div>
        <span class="weight-pct">${urbanPct}%</span>
      </div>
    </div>

    ${topDrivers.length > 0 ? `
    <div class="result-section">
      <div class="section-label">Key Drivers</div>
      ${driversHtml}
    </div>` : ""}

    <div class="result-section" style="margin-bottom:4px;">
      <div class="section-label">City-wide Signal</div>
      <div style="font-size:11px; color:${cityColor}; padding:4px 0;">
        ${cityDir} &mdash; ${cityConf}% confidence
      </div>
    </div>

    <div class="map-hint">
      ← Select a layer on the left, then drag the map slider to compare
    </div>
  `;

  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;
}

/* ================================================
   UTILITY: Haversine Distance (km)
   ================================================ */
function getDistance(coord1, coord2) {
  const R    = 6371;
  const lat1 = coord1[1], lon1 = coord1[0];
  const lat2 = coord2[1], lon2 = coord2[0];
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
          * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
