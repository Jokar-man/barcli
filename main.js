mapboxgl.accessToken = "pk.eyJ1IjoibGFrc2htaS1kYmYxNSIsImEiOiJjbWdnYWM4cTYwZ2czMmtzY3k0cHlrZTA0In0.AwWDdoOtmRZNAXz1s4yQxw";

// Barcelona Center - Plaça Catalunya
const CENTER = [2.1734, 41.3851];
let points = null;
let activeFields = [];
let stats = {};
let cadastralData = null;
let centerFocusKm = 5;

// Impact simulation state
let impactData = null;   // Last AI response
const ALPHA = 0.6;       // Local vs citywide blend weight
const BETA  = 0.1;       // Policy strength scaling
const AI_API_URL = "https://jokar-man-urban-climate-model.hf.space";

/* -------------------------
   Initialize MAP
-------------------------- */
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  center: CENTER,
  zoom: 13.5,
  pitch: 60,
  bearing: -20,
  antialias: true,
  minZoom: 10,
  maxZoom: 18
});

map.on("load", async () => {

  /* -------------------------
     LOAD Cadastral Buildings GeoJSON
  -------------------------- */
  try {
    cadastralData = await fetch("data/barcelona_buildings.geojson").then(r => r.json());
    map.addSource("cadastral-buildings-source", {
      type: "geojson",
      data: cadastralData
    });

    map.addLayer({
      id: "3d-cadastral",
      type: "fill-extrusion",
      source: "cadastral-buildings-source",
      paint: {
        "fill-extrusion-color": "#00eaff",
        "fill-extrusion-height": ["*", ["get", "numberOfFloorsAboveGround"], 3.5],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.28
      }
    }, "waterway-label");
  } catch (err) {
    console.error("Could not load cadastral buildings:", err);
  }

  /* -------------------------
     MAPBOX DEFAULT 3D BUILDINGS
  -------------------------- */
  map.addLayer({
    id: "3d-mapbox-default",
    source: "composite",
    "source-layer": "building",
    filter: ["all", ["has", "height"], ["has", "min_height"]],
    type: "fill-extrusion",
    minzoom: 13,
    paint: {
      "fill-extrusion-color": "#00eaff",
      "fill-extrusion-height": ["get", "height"],
      "fill-extrusion-base": ["get", "min_height"],
      "fill-extrusion-opacity": 0.1
    }
  }, "waterway-label");

  map.getStyle().layers.forEach(layer => {
    if (layer.type === "symbol") {
      map.removeLayer(layer.id);
    }
  });

  /* -------------------------
     LOAD Vulnerability Points
  -------------------------- */
  try {
    const resp = await fetch("data/data.geojson");
    const text = await resp.text();
    points = JSON.parse(text);
  } catch (err) {
    alert("ERROR: data/data.geojson not found.");
    return;
  }

  computeStats();

  /* -------------------------
     Original Points Source
  -------------------------- */
  map.addSource("points", {
    type: "geojson",
    data: points
  });

  /* -------------------------
     Impact Overlay Source (starts empty)
  -------------------------- */
  map.addSource("impact-points", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] }
  });

  /* -------------------------
     Original Glow Halo Layer
  -------------------------- */
  map.addLayer({
    id: "glow-halo",
    type: "circle",
    source: "points",
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 5,
        16, 25
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_value"],
        0,   "rgba(0,120,255,0)",
        0.1, "rgba(0,120,255,0.12)",
        0.5, "rgba(0,255,180,0.18)",
        0.8, "rgba(255,220,0,0.24)",
        1,   "rgba(255,0,80,0.32)"
      ],
      "circle-blur": 0.8,
      "circle-opacity": 1
    }
  });

  /* -------------------------
     Original Glow Core Layer
  -------------------------- */
  map.addLayer({
    id: "glow-core",
    type: "circle",
    source: "points",
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 2,
        16, 8
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_value"],
        0.0, "rgba(50,50,50,0)",
        0.2, "rgb(0,120,255)",
        0.5, "rgb(0,255,180)",
        0.8, "rgb(255,220,0)",
        1.0, "rgb(255,0,80)"
      ],
      "circle-opacity": 0.7
    }
  });

  /* -------------------------
     Impact Halo Layer (hidden initially)
     Color: green (mitigation) → gray (neutral) → red (aggravation)
  -------------------------- */
  map.addLayer({
    id: "impact-halo",
    type: "circle",
    source: "impact-points",
    layout: { "visibility": "none" },
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 6,
        16, 28
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_impact_value"],
        0,    "rgba(0,255,100,0.22)",
        0.35, "rgba(0,200,180,0.18)",
        0.5,  "rgba(160,160,160,0.10)",
        0.65, "rgba(255,140,0,0.18)",
        1,    "rgba(255,0,80,0.28)"
      ],
      "circle-blur": 0.8,
      "circle-opacity": [
        "case", ["to-boolean", ["get", "_inFocus"]], 1, 0
      ]
    }
  });

  /* -------------------------
     Impact Core Layer (hidden initially)
  -------------------------- */
  map.addLayer({
    id: "impact-core",
    type: "circle",
    source: "impact-points",
    layout: { "visibility": "none" },
    paint: {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 3,
        16, 10
      ],
      "circle-color": [
        "interpolate", ["linear"], ["get", "_impact_value"],
        0,    "rgb(0,255,127)",
        0.3,  "rgb(0,210,180)",
        0.5,  "rgb(160,160,160)",
        0.7,  "rgb(255,140,0)",
        1,    "rgb(255,0,60)"
      ],
      "circle-opacity": [
        "case", ["to-boolean", ["get", "_inFocus"]], 0.9, 0
      ]
    }
  });

  map.on("mouseenter", "glow-core", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "glow-core", () => map.getCanvas().style.cursor = "");

  setupButtons();
  setupRadiusControl();
  setupInfoModal();
  updateVisualization();
});

/* -------------------------
   Stats + Normalization
-------------------------- */
function computeStats() {
  // Step 1: Collect sub-field raw values for urban health
  const subData = { immigrant1: [], income1: [], pop_sex3: [] };
  points.features.forEach(f => {
    const p = f.properties;
    subData.immigrant1.push(+p.immigrant1 || 0);
    subData.income1.push(+p.income1 || 0);
    subData.pop_sex3.push(+p.pop_sex3 || 0);
  });

  // Sub-field stats (5th–95th percentile)
  const subStats = {};
  Object.keys(subData).forEach(k => {
    const sorted = subData[k].filter(isFinite).sort((a, b) => a - b);
    const n = sorted.length;
    const min = sorted[Math.floor(n * 0.05)] || 0;
    const max = sorted[Math.floor(n * 0.95)] || 1;
    subStats[k] = { min, max, range: Math.max(1e-6, max - min) };
  });

  // Step 2: Precompute _urban_health on each feature
  // Urban Health = immigrants (direct) + income (inverted, lower income = more vulnerable) + population (direct)
  points.features.forEach(f => {
    const p = f.properties;
    const normImm = Math.min(1, Math.max(0, ((+p.immigrant1 || 0) - subStats.immigrant1.min) / subStats.immigrant1.range));
    const normInc = Math.min(1, Math.max(0, ((+p.income1   || 0) - subStats.income1.min)    / subStats.income1.range));
    const normPop = Math.min(1, Math.max(0, ((+p.pop_sex3  || 0) - subStats.pop_sex3.min)   / subStats.pop_sex3.range));
    // Invert income so low income → high vulnerability
    p._urban_health = (normImm + (1 - normInc) + normPop) / 3;
  });

  // Step 3: Compute overall stats per field (5th–95th percentile)
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
    if (n === 0) {
      stats[k] = { min: 0, max: 1, range: 1 };
      return;
    }
    stats[k] = {
      min: a[Math.floor(n * 0.05)] || 0,
      max: a[Math.floor(n * 0.95)] || 1
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

/* -------------------------
   UI Buttons + Updates
-------------------------- */
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

  icon.onclick = () => { modal.style.display = "block"; };

  window.onclick = (event) => {
    if (event.target === modal) modal.style.display = "none";
  };
}

function updateVisualization() {
  // Update original _value and _inFocus for every point
  points.features.forEach(f => {
    const p     = f.properties;
    const dist  = getDistance(CENTER, f.geometry.coordinates);
    p._inFocus  = dist <= centerFocusKm;

    if (activeFields.length === 0) {
      p._value = 0;
      return;
    }

    let sum = 0;
    activeFields.forEach(k => {
      sum += normalize(computeRaw(p, k), k);
    });
    p._value = sum / activeFields.length;
  });

  map.getSource("points").setData(points);

  // Show or hide impact overlay depending on whether we have AI results + active layers
  if (impactData && activeFields.length > 0) {
    showImpactOverlay();
  } else {
    hideImpactOverlay();
  }
}

/* -------------------------
   Impact Overlay
-------------------------- */
function showImpactOverlay() {
  const local   = impactData.neighborhood_level;
  const city    = impactData.city_level;
  const δ_local = local.direction === "Aggravation" ? 1 : -1;
  const δ_city  = city.direction  === "Aggravation" ? 1 : -1;
  const c_local = local.confidence;
  const c_city  = city.confidence;

  const macro = local.macro_impact;
  const w_H = macro["Heat risk"]    || 0;
  const w_D = macro["Drought risk"] || 0;
  const w_P = macro["Urban health"] || 0;

  const impactFeatures = points.features.map(f => {
    const p = f.properties;
    const H = normalize(computeRaw(p, "heat"),         "heat");
    const D = normalize(computeRaw(p, "SPEI"),         "SPEI");
    const P = normalize(computeRaw(p, "urban_health"), "urban_health");

    let I_local, I_city;

    if (activeFields.length === 1) {
      // Show dimension-specific impact when a single layer is selected
      const dimVal = { heat: w_H * H, SPEI: w_D * D, urban_health: w_P * P };
      const v = dimVal[activeFields[0]] || 0;
      I_local = δ_local * c_local * v;
      I_city  = δ_city  * c_city  * v;
    } else {
      // Combined impact when multiple layers are active
      I_local = δ_local * c_local * (w_H * H + w_D * D + w_P * P);
      I_city  = δ_city  * c_city  * (w_H * H + w_D * D + w_P * P);
    }

    // Blend local + citywide (SCIENTIFIC_WORKFLOW formula)
    const I_final = ALPHA * I_local + (1 - ALPHA) * I_city;

    // Map [-1, 1] → [0, 1] for color scale
    const impact_value = Math.min(1, Math.max(0, (I_final + 1) / 2));

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        _impact_value: impact_value,
        _inFocus: p._inFocus
      }
    };
  });

  map.getSource("impact-points").setData({
    type: "FeatureCollection",
    features: impactFeatures
  });

  // Dim original layers so impact is clearly readable alongside them
  map.setPaintProperty("glow-halo", "circle-opacity", 0.3);
  map.setPaintProperty("glow-core", "circle-opacity", 0.25);

  map.setLayoutProperty("impact-halo", "visibility", "visible");
  map.setLayoutProperty("impact-core", "visibility", "visible");

  updateLegend(true);
}

function hideImpactOverlay() {
  map.setPaintProperty("glow-halo", "circle-opacity", 1);
  map.setPaintProperty("glow-core", "circle-opacity", 0.7);

  map.setLayoutProperty("impact-halo", "visibility", "none");
  map.setLayoutProperty("impact-core", "visibility", "none");

  updateLegend(false);
}

function updateLegend(isImpact) {
  const title    = document.getElementById("legend-title");
  const gradient = document.querySelector(".legend-gradient");
  const low      = document.getElementById("legend-low");
  const high     = document.getElementById("legend-high");

  if (isImpact) {
    if (title)    title.textContent    = "Policy Impact";
    if (gradient) gradient.style.background = "linear-gradient(90deg, rgb(0,255,127), rgb(160,160,160), rgb(255,0,60))";
    if (low)      low.textContent      = "Mitigation";
    if (high)     high.textContent     = "Aggravation";
  } else {
    if (title)    title.textContent    = "Vulnerability Intensity";
    if (gradient) gradient.style.background = "linear-gradient(90deg, rgba(0,120,255,0.2), rgba(0,255,180,0.4), rgba(255,255,0,0.6), rgba(255,0,0,0.8))";
    if (low)      low.textContent      = "Low";
    if (high)     high.textContent     = "High";
  }
}

/* -------------------------
   Policy Analysis
-------------------------- */
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
  userBubble.className = "chat-user-msg";
  userBubble.textContent = policyText;
  messages.appendChild(userBubble);

  // Thinking dots
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-thinking";
  thinkingEl.innerHTML = "<span></span><span></span><span></span>";
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

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const aiResult = await response.json();

    thinkingEl.remove();

    // Store and apply impact
    impactData = aiResult;

    // Render chat result card
    renderChatResult(aiResult);

    // If layers are already active, immediately show impact
    if (activeFields.length > 0) {
      showImpactOverlay();
    }

  } catch (err) {
    thinkingEl.remove();

    const errEl = document.createElement("div");
    errEl.className   = "chat-error";
    errEl.textContent = `Analysis failed: ${err.message}. Check the console for details.`;
    messages.appendChild(errEl);

    console.error("analysePolicy error:", err);
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

  const macro     = local.macro_impact  || {};
  const heatPct   = Math.round((macro["Heat risk"]    || 0) * 100);
  const droughtPct= Math.round((macro["Drought risk"] || 0) * 100);
  const urbanPct  = Math.round((macro["Urban health"] || 0) * 100);

  // Top 4 drivers sorted by magnitude
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

  // City-level direction line
  const cityDir      = city.direction === "Mitigation" ? "↓ Mitigation" : "↑ Aggravation";
  const cityConfPct  = Math.round(city.confidence * 100);
  const cityColor    = city.direction === "Mitigation" ? "#00cc66" : "#ff4466";

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
      <div style="font-size:11px; color:${cityColor}; padding:4px 0;">${cityDir} &mdash; ${cityConfPct}% confidence</div>
    </div>

    <div class="map-hint">
      ← Select a layer on the left to see the spatial impact
    </div>
  `;

  messages.appendChild(card);
  messages.scrollTop = messages.scrollHeight;
}

/* -------------------------
   UTILITY: Haversine Distance (km)
-------------------------- */
function getDistance(coord1, coord2) {
  const R    = 6371;
  const lat1 = coord1[1], lon1 = coord1[0];
  const lat2 = coord2[1], lon2 = coord2[0];

  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
