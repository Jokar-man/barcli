# Multi-Agent ABM & Agentic Interaction Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dbf-dev:subagent-driven-development (recommended) or dbf-dev:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global reset button, restructure the left panel with an "Agentic Interaction" section (Single Agent / Multi-Agent tabs), and implement a Multi-Agent generative ABM where 15–20 pedestrian agents react to heat stress and seek climate shelters — showing before/after policy shelter-utilisation counts.

**Architecture:** LeftPanel gains a reset button and an Agentic Interaction section replacing the ABM button. A new `useMultiABM` hook runs two synchronous A*-guided simulations (before/after policy) with identical agent starting positions. Shelter markers are loaded into both Mapbox maps from `data/climate_shelters.geojson`; clicking one triggers the simulation. A `MultiABMPanel` in the chat sidebar shows animated dots on the map and a before/after shelter count card.

**Tech Stack:** React 18 hooks, Mapbox GL 3, plain JS (no TypeScript), Turf.js (already installed), `data/climate_shelters.geojson`, shared road graph from `climate_isochrone.geojson`.

---

## Codebase Context (read before touching anything)

| File | Current role |
|---|---|
| `src/components/LeftPanel/index.jsx` | Climate layer buttons + ABM button (ABM button will be removed) |
| `src/App.jsx` | Root state: `activeFields`, `abmActive`, `impactData`, `loadedPoints`, `loadedStats`, `impactFC` |
| `src/hooks/useABM.js` | Single-agent A* simulation — not modified in this plan |
| `src/hooks/useMapbox.js` | Both maps, ABM layers; gains shelter layers + multi-agent layers |
| `src/components/ChatPanel/index.jsx` | Shows ABMPanel; gains MultiABMPanel |
| `src/styles/index.css` | All styles; gains agentic section + shelter result card styles |

## Simulation Algorithm (read before Task 3)

Each agent per step:
1. `vuln = sampleVulnerability(agent.nodeId)` (cached per node)
2. If `vuln >= 0.65` → `agent.seeking = true` (heat stress triggered)
3. If seeking → greedy toward shelter: pick unvisited neighbour closest to shelter; if that neighbour IS the shelter node → `agent.arrived = true`
4. Else → random walk: prefer unvisited neighbours (anti-loop)
5. Record snapshot every 5 steps for animation (40 frames for 200-step simulation)

Run twice with identical starting positions: once with `indexBaseRef` (raw vulnerability), once with `indexPolicyRef` (post-policy V_new). Count arrived agents in each run → before/after comparison.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/components/LeftPanel/index.jsx` | Modify | Remove ABM field; add reset button; add Agentic Interaction section |
| `src/hooks/useMultiABM.js` | Create | Load isochrone, build graph, spawn agents, run simulation ×2, return snapshots + counts |
| `src/hooks/useMapbox.js` | Modify | Add shelter markers on both maps; click handler for shelter selection; multi-agent dot layers; `updateMultiAgentPositions()` |
| `src/components/MultiABMPanel/index.jsx` | Create | Shelter name, before/after count bars, Play/Pause, step counter |
| `src/components/ChatPanel/index.jsx` | Modify | Show MultiABMPanel + multi-agent status messages |
| `src/App.jsx` | Modify | `agenticMode` state, `handleReset`, wire useMultiABM, pass new props |
| `src/styles/index.css` | Modify | `.agentic-section`, `.agentic-btn`, `.shelter-result-card`, `.count-bar` |

---

## Task 1: LeftPanel Restructure — Reset Button + Agentic Interaction Section

**Files:**
- Modify: `src/components/LeftPanel/index.jsx`
- Modify: `src/styles/index.css` (append styles)

- [ ] **Step 1: Rewrite `src/components/LeftPanel/index.jsx`**

```jsx
// src/components/LeftPanel/index.jsx

const CLIMATE_FIELDS = [
  { key: 'heat',         label: 'Heat' },
  { key: 'SPEI',         label: 'Drought' },
  { key: 'urban_health', label: 'Urban Health' },
]

export default function LeftPanel({ activeFields, onToggleField, agenticMode, onSetAgenticMode, onReset }) {
  return (
    <div id="panel">
      <div className="panel-header-row">
        <h3>Climate Layers</h3>
        <button className="panel-reset-btn" onClick={onReset} title="Reset all layers and analysis">↺</button>
      </div>

      {CLIMATE_FIELDS.map(({ key, label }) => (
        <button
          key={key}
          data-field={key}
          className={activeFields.includes(key) ? 'active' : ''}
          onClick={() => onToggleField(key)}
        >
          {label}
        </button>
      ))}

      <div className="agentic-section">
        <div className="agentic-header">Agentic Interaction</div>
        <button
          className={'agentic-btn' + (agenticMode === 'single' ? ' active' : '')}
          onClick={() => onSetAgenticMode(agenticMode === 'single' ? 'none' : 'single')}
        >
          Single Agent
        </button>
        <button
          className={'agentic-btn' + (agenticMode === 'multi' ? ' active agentic-multi' : '')}
          onClick={() => onSetAgenticMode(agenticMode === 'multi' ? 'none' : 'multi')}
        >
          Multi-Agent
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Append styles to `src/styles/index.css`**

Read the file first, then append at the bottom:

```css
/* =====================
   PANEL HEADER ROW & RESET
   ===================== */

.panel-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0;
}

.panel-header-row h3 {
  margin: 0;
}

.panel-reset-btn {
  background: none;
  border: 1px solid rgba(0,234,255,0.18);
  color: #555;
  font-size: 13px;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, border-color 0.2s;
}
.panel-reset-btn:hover { color: #ff4466; border-color: rgba(255,68,102,0.4); }

/* =====================
   AGENTIC INTERACTION SECTION
   ===================== */

.agentic-section {
  margin-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.07);
  padding-top: 12px;
}

.agentic-header {
  font-size: 9px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.agentic-btn {
  display: block;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 6px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  color: #888;
  font-family: inherit;
  font-size: 11px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.agentic-btn:hover { border-color: rgba(0,234,255,0.3); color: #ccc; }
.agentic-btn.active { border-color: #00eaff; color: #00eaff; background: rgba(0,234,255,0.08); }
.agentic-btn.agentic-multi.active { border-color: #ff9900; color: #ff9900; background: rgba(255,153,0,0.08); }
```

- [ ] **Step 3: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/components/LeftPanel/index.jsx src/styles/index.css
git commit -m "feat: add reset button and Agentic Interaction section to LeftPanel"
```

---

## Task 2: App.jsx — agenticMode State + Reset Handler

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Update `src/App.jsx`**

Read the file first. Apply these changes:

**Add import** for `useMultiABM` (will be created in Task 3 — add the import now so it's ready):
```js
import useMultiABM from './hooks/useMultiABM'
```

**Replace** `const [abmActive, setAbmActive] = useState(false)` with:
```js
const [agenticMode,   setAgenticMode]   = useState('none') // 'none'|'single'|'multi'
```

**Add** `abmActive` derived value right after (keeps useABM happy with no signature change):
```js
const abmActive = agenticMode === 'single'
```

**Add** `useMultiABM` call after the `useABM` call (before `useMapbox`):
```js
const {
  shelters,
  selectedShelter,
  multiSimState,
  baselineCount,
  policyCount,
  totalAgents,
  baselineSnapshots,
  policySnapshots,
  onShelterSelected,
  reset: resetMultiABM
} = useMultiABM({
  isActive:       agenticMode === 'multi',
  points:         loadedPoints,
  stats:          loadedStats,
  activeFields,
  impactFeatures: impactFC
})
```

**Update `useMapbox` call** to add multi-agent props:
```js
const {
  mapContainerRef,
  mapImpactRef,
  isCompareVisible,
  showCompare,
  hideCompare,
  updateDivider,
  dividerXRef,
  updateAgentPositions,
  updateMultiAgentPositions
} = useMapbox({
  activeFields,
  impactData,
  selectedCategory,
  abmMode:              abmActive ? abmState : 'idle',
  abmCallbacks:         { handleMapClick, startCoord, endCoord, baselinePath, policyPath },
  onPointsLoaded:       (pts, stats) => { setLoadedPoints(pts); setLoadedStats(stats) },
  onImpactComputed:     setImpactFC,
  multiAbmActive:       agenticMode === 'multi',
  shelterData:          shelters,
  selectedShelterCoord: selectedShelter?.coordinates || null,
  onShelterSelected,
})
```

**Add `handleReset`** after `handleImpactData`:
```js
const handleReset = useCallback(() => {
  setActiveFields([])
  setImpactData(null)
  setSelectedCategory('')
  setAgenticMode('none')
  resetABM()
  resetMultiABM()
  hideCompare()
}, [resetABM, resetMultiABM, hideCompare])
```

**Update `handleToggleField`** — remove the `if (field === 'abm')` branch, leaving only:
```js
const handleToggleField = useCallback((field) => {
  setActiveFields(prev =>
    prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
  )
}, [])
```

**Update `LeftPanel` render**:
```jsx
<LeftPanel
  activeFields={activeFields}
  onToggleField={handleToggleField}
  agenticMode={agenticMode}
  onSetAgenticMode={setAgenticMode}
  onReset={handleReset}
/>
```

**Update `ChatPanel` render**:
```jsx
<ChatPanel
  onImpactData={handleImpactData}
  abmResult={{ baselineProfile, policyProfile, abmState }}
  abmPaths={{ baselinePath, policyPath }}
  updateAgentPositions={updateAgentPositions}
  onResetABM={resetABM}
  agenticMode={agenticMode}
  multiAbmResult={{ multiSimState, baselineCount, policyCount, totalAgents, selectedShelter }}
  multiSnapshots={{ baselineSnapshots, policySnapshots }}
  updateMultiAgentPositions={updateMultiAgentPositions}
  onResetMultiABM={resetMultiABM}
/>
```

- [ ] **Step 2: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors (useMultiABM doesn't exist yet — Vite may warn but not error since it's imported but the file will be created next)

If there is an import error, create a stub `src/hooks/useMultiABM.js`:
```js
export default function useMultiABM() {
  return { shelters: [], selectedShelter: null, multiSimState: 'idle',
    baselineCount: 0, policyCount: 0, totalAgents: 0,
    baselineSnapshots: [], policySnapshots: [],
    onShelterSelected: () => {}, reset: () => {} }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx src/hooks/useMultiABM.js
git commit -m "feat: add agenticMode state, handleReset, stub useMultiABM"
```

---

## Task 3: useMultiABM Hook — Simulation Engine

**Files:**
- Create: `src/hooks/useMultiABM.js`

This hook runs the full multi-agent generative ABM. It:
1. Loads `climate_isochrone.geojson` and builds the road graph (same as useABM, independent load)
2. Loads `climate_shelters.geojson` and exposes the shelter list
3. On shelter selection: finds road nodes within 600 m, spawns 20 agents, runs two 200-step simulations
4. Returns snapshots for map animation and final counts for the result card

- [ ] **Step 1: Write `src/hooks/useMultiABM.js`**

```js
// src/hooks/useMultiABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { sampleVulnerability } from '../utils/abm/vulnerabilitySampler'
import { buildSpatialIndex } from '../utils/abm/vulnerabilitySampler'

const NUM_AGENTS       = 20
const MAX_STEPS        = 200
const SNAPSHOT_EVERY   = 5     // store agent positions every 5 sim steps
const STRESS_THRESHOLD = 0.65  // heat stress that triggers shelter-seeking
const SPAWN_RADIUS_M   = 600   // metres around shelter to spawn agents

// Simple haversine squared distance (no sqrt — only for comparison)
function distSq([lng1, lat1], [lng2, lat2]) {
  const dx = (lng1 - lng2) * 111320 * Math.cos(lat1 * Math.PI / 180)
  const dy = (lat1 - lat2) * 110540
  return dx * dx + dy * dy
}

/**
 * Run one 200-step multi-agent simulation.
 * Returns { arrivedCount, snapshots }
 * snapshots: Array of frames, each frame = [{id, lng, lat, arrived}]
 */
function runSimulation(startNodeIds, shelterNodeId, nodes, edges, spatialIndex) {
  // Cache vulnerability per node — avoids 200×20 repeated spatial lookups
  const vulnCache = new Map()
  const getVuln = id => {
    if (!vulnCache.has(id)) {
      const [lng, lat] = nodes.get(id)
      vulnCache.set(id, sampleVulnerability(lng, lat, spatialIndex))
    }
    return vulnCache.get(id)
  }

  const shelterCoord = nodes.get(shelterNodeId)

  // Initialise agents as mutable objects (no immutability needed inside simulation)
  const agents = startNodeIds.map((nodeId, i) => ({
    id:      i,
    nodeId,
    seeking: getVuln(nodeId) >= STRESS_THRESHOLD,
    arrived: nodeId === shelterNodeId,
    visited: new Set([nodeId])
  }))

  const nodeToCoord = id => {
    const [lng, lat] = nodes.get(id)
    return { lng, lat }
  }

  const snapshots = [agents.map(a => ({
    id: a.id, ...nodeToCoord(a.nodeId), arrived: a.arrived
  }))]

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const agent of agents) {
      if (agent.arrived) continue

      const v = getVuln(agent.nodeId)
      if (v >= STRESS_THRESHOLD) agent.seeking = true

      const neighbours = (edges.get(agent.nodeId) || []).map(e => e.to)
      if (!neighbours.length) continue

      let nextNode
      if (agent.seeking) {
        // Greedy toward shelter — prefer unvisited to avoid loops
        const pool = neighbours.filter(id => !agent.visited.has(id))
        const candidates = pool.length ? pool : neighbours
        const shelterC = shelterCoord
        nextNode = candidates.reduce((best, id) =>
          distSq(nodes.get(id), shelterC) < distSq(nodes.get(best), shelterC) ? id : best
        )
        if (nextNode === shelterNodeId || agent.nodeId === shelterNodeId) {
          agent.arrived = true
          agent.nodeId  = shelterNodeId
          continue
        }
      } else {
        // Random walk — prefer unvisited neighbours to spread out
        const unvisited = neighbours.filter(id => !agent.visited.has(id))
        const pool = unvisited.length ? unvisited : neighbours
        nextNode = pool[Math.floor(Math.random() * pool.length)]
      }

      agent.visited.add(nextNode)
      agent.nodeId = nextNode
    }

    // Snapshot every SNAPSHOT_EVERY steps + final step
    if ((step + 1) % SNAPSHOT_EVERY === 0 || step === MAX_STEPS - 1) {
      snapshots.push(agents.map(a => ({
        id: a.id, ...nodeToCoord(a.nodeId), arrived: a.arrived
      })))
    }
  }

  return {
    arrivedCount: agents.filter(a => a.arrived).length,
    snapshots
  }
}

export default function useMultiABM({ isActive, points, stats, activeFields, impactFeatures }) {
  const [shelters,          setShelters]          = useState([])
  const [selectedShelter,   setSelectedShelter]   = useState(null)
  const [multiSimState,     setMultiSimState]     = useState('idle')
  // 'idle' | 'selecting' | 'running' | 'done'
  const [baselineCount,     setBaselineCount]     = useState(0)
  const [policyCount,       setPolicyCount]       = useState(0)
  const [baselineSnapshots, setBaselineSnapshots] = useState([])
  const [policySnapshots,   setPolicySnapshots]   = useState([])

  const graphRef       = useRef(null)
  const indexBaseRef   = useRef([])
  const indexPolicyRef = useRef([])

  const totalAgents = NUM_AGENTS

  // Load isochrone + build road graph once when multi-agent mode activates
  useEffect(() => {
    if (!isActive || graphRef.current) return
    fetch('/data/climate_isochrone.geojson')
      .then(r => r.json())
      .then(geo => {
        graphRef.current = buildRoadGraph(geo)
        console.log('[MultiABM] Graph:', graphRef.current.nodes.size, 'nodes')
      })
      .catch(e => console.error('[MultiABM] Failed to load isochrone:', e))
  }, [isActive])

  // Load shelter GeoJSON once
  useEffect(() => {
    if (!isActive || shelters.length) return
    fetch('/data/climate_shelters.geojson')
      .then(r => r.json())
      .then(geo => setShelters(geo.features || []))
      .catch(e => console.error('[MultiABM] Failed to load shelters:', e))
  }, [isActive, shelters.length])

  // Rebuild baseline spatial index
  useEffect(() => {
    if (!points || !activeFields.length) return
    indexBaseRef.current = buildSpatialIndex(points, stats, activeFields)
  }, [points, stats, activeFields])

  // Rebuild policy spatial index
  useEffect(() => {
    if (!impactFeatures?.features) return
    indexPolicyRef.current = impactFeatures.features.map(f => ({
      lng:   f.geometry.coordinates[0],
      lat:   f.geometry.coordinates[1],
      score: f.properties._value || 0
    }))
  }, [impactFeatures])

  // Reset when deactivated
  useEffect(() => {
    if (!isActive) {
      setSelectedShelter(null)
      setMultiSimState('idle')
      setBaselineCount(0)
      setPolicyCount(0)
      setBaselineSnapshots([])
      setPolicySnapshots([])
    } else {
      setMultiSimState('selecting')
    }
  }, [isActive])

  // Called when user clicks a shelter marker on the map
  const onShelterSelected = useCallback((shelterFeature) => {
    if (!graphRef.current) {
      console.warn('[MultiABM] Graph not ready — click again shortly')
      return
    }

    setSelectedShelter(shelterFeature)
    setMultiSimState('running')

    const { nodes, edges } = graphRef.current

    // Snap shelter to nearest road node
    const shelterCoord  = shelterFeature.geometry.coordinates  // [lng, lat]
    const shelterNodeId = snapToGraph(shelterCoord, nodes)
    if (!shelterNodeId) {
      console.warn('[MultiABM] Could not snap shelter to graph')
      setMultiSimState('selecting')
      return
    }

    // Find candidate road nodes within SPAWN_RADIUS_M of shelter
    const [slng, slat] = shelterCoord
    const RADIUS_SQ = SPAWN_RADIUS_M * SPAWN_RADIUS_M
    const candidates = []
    for (const [id, coord] of nodes) {
      if (id === shelterNodeId) continue
      if (distSq(coord, [slng, slat]) <= RADIUS_SQ) {
        candidates.push(id)
      }
    }

    if (candidates.length < NUM_AGENTS) {
      console.warn('[MultiABM] Not enough road nodes near shelter — try a different one')
      setMultiSimState('selecting')
      return
    }

    // Shuffle candidates and pick NUM_AGENTS starting positions
    // Use a deterministic Fisher-Yates shuffle seeded by shelter index
    // so both baseline and policy simulations start identically
    const shuffled = [...candidates]
    let seed = shelterFeature.geometry.coordinates[0] * 1000 | 0
    const lcg = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF }
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(lcg() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const startPositions = shuffled.slice(0, NUM_AGENTS)

    const baseIndex   = indexBaseRef.current
    const policyIndex = indexPolicyRef.current.length ? indexPolicyRef.current : baseIndex

    // Run both simulations synchronously (fast — ~200ms total)
    const baseResult   = runSimulation(startPositions, shelterNodeId, nodes, edges, baseIndex)
    const policyResult = runSimulation(startPositions, shelterNodeId, nodes, edges, policyIndex)

    setBaselineCount(baseResult.arrivedCount)
    setPolicyCount(policyResult.arrivedCount)
    setBaselineSnapshots(baseResult.snapshots)
    setPolicySnapshots(policyResult.snapshots)
    setMultiSimState('done')
  }, [])

  const reset = useCallback(() => {
    setSelectedShelter(null)
    setMultiSimState('selecting')
    setBaselineCount(0)
    setPolicyCount(0)
    setBaselineSnapshots([])
    setPolicySnapshots([])
  }, [])

  return {
    shelters,
    selectedShelter,
    multiSimState,
    baselineCount,
    policyCount,
    totalAgents,
    baselineSnapshots,
    policySnapshots,
    onShelterSelected,
    reset
  }
}
```

- [ ] **Step 2: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMultiABM.js
git commit -m "feat: add useMultiABM generative simulation hook with shelter-seeking agents"
```

---

## Task 4: Mapbox Shelter Markers + Multi-Agent Layers

**Files:**
- Modify: `src/hooks/useMapbox.js`

Add to useMapbox:
1. Accept `multiAbmActive`, `shelterData`, `selectedShelterCoord`, `onShelterSelected` props
2. Add shelter marker sources/layers to both maps (shown only when `multiAbmActive`)
3. Add multi-agent dot sources/layers (baseline on left map, policy on right map)
4. Expose `updateMultiAgentPositions(frameIdx, baseSnaps, policySnaps)` function

- [ ] **Step 1: Update `useMapbox` signature and refs**

Read `src/hooks/useMapbox.js` in full first.

Change the function signature from:
```js
export default function useMapbox({ activeFields, impactData, selectedCategory, abmMode, abmCallbacks, onPointsLoaded, onImpactComputed }) {
```
to:
```js
export default function useMapbox({
  activeFields, impactData, selectedCategory,
  abmMode, abmCallbacks,
  onPointsLoaded, onImpactComputed,
  multiAbmActive, shelterData, selectedShelterCoord, onShelterSelected
}) {
```

Add two new refs after the existing `abmCallbacksRef`:
```js
const onShelterSelectedRef = useRef(onShelterSelected)
useEffect(() => { onShelterSelectedRef.current = onShelterSelected }, [onShelterSelected])
```

- [ ] **Step 2: Add shelter + multi-agent sources/layers to baseline map**

Find the line in the `map.on('load', ...)` callback that says:
```js
      // ── ABM layers on BASELINE map (left side) ───────────────────────
```

AFTER the existing ABM baseline layer block (after `map.addLayer({ id: 'abm-end-main-circle', ... })`), add:

```js
      // ── Shelter markers on BASELINE map ──────────────────────────────
      map.addSource('shelters-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addSource('selected-shelter-main', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'shelters-main-circle', type: 'circle', source: 'shelters-main',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-color': '#00ff88', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 }
      })
      map.addLayer({
        id: 'selected-shelter-main-circle', type: 'circle', source: 'selected-shelter-main',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 12, 'circle-color': '#00ff88', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff', 'circle-opacity': 1 }
      })

      // Shelter click handler — forwards to useMultiABM via ref
      map.on('click', 'shelters-main-circle', e => {
        if (!e.features.length) return
        onShelterSelectedRef.current?.(e.features[0])
      })
      map.on('mouseenter', 'shelters-main-circle', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'shelters-main-circle', () => { map.getCanvas().style.cursor = '' })

      // ── Multi-agent dots on BASELINE map (before-agent) ──────────────
      map.addSource('multi-agents-baseline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'multi-agents-baseline-dot', type: 'circle', source: 'multi-agents-baseline',
        paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['get', 'arrived'], '#00ff88', '#00eaff'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.9
        }
      })
```

- [ ] **Step 3: Add shelter + multi-agent sources/layers to impact map**

Find the line AFTER `addGlowLayers(impactMap, 'points-impact', 'impact')` and BEFORE the existing `// ── ABM layers` comment. Add:

```js
      // ── Shelter markers on IMPACT map (right side) ───────────────────
      impactMap.addSource('shelters-impact', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addSource('selected-shelter-impact', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addLayer({
        id: 'shelters-impact-circle', type: 'circle', source: 'shelters-impact',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 7, 'circle-color': '#00ff88', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.85 }
      })
      impactMap.addLayer({
        id: 'selected-shelter-impact-circle', type: 'circle', source: 'selected-shelter-impact',
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 12, 'circle-color': '#00ff88', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff', 'circle-opacity': 1 }
      })

      // ── Multi-agent dots on IMPACT map (after-agent) ─────────────────
      impactMap.addSource('multi-agents-policy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      impactMap.addLayer({
        id: 'multi-agents-policy-dot', type: 'circle', source: 'multi-agents-policy',
        paint: {
          'circle-radius': 5,
          'circle-color': ['case', ['get', 'arrived'], '#00ff88', '#ff9900'],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.9
        }
      })
```

- [ ] **Step 4: Add useEffects for shelter visibility + data sync**

After the existing `useEffect([abmMode])` (the one that keeps climate dots visible), add:

```js
  // Show/hide shelter markers + sync shelter data when multiAbmActive changes
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('shelters-main')) return

    const vis = multiAbmActive ? 'visible' : 'none'
    ;['shelters-main-circle', 'selected-shelter-main-circle'].forEach(id => {
      if (mBase.getLayer(id)) mBase.setLayoutProperty(id, 'visibility', vis)
    })
    ;['shelters-impact-circle', 'selected-shelter-impact-circle'].forEach(id => {
      if (mImpact?.getLayer(id)) mImpact.setLayoutProperty(id, 'visibility', vis)
    })

    // Clear multi-agent dots when mode deactivates
    if (!multiAbmActive) {
      const empty = { type: 'FeatureCollection', features: [] }
      if (mBase.getSource('multi-agents-baseline')) mBase.getSource('multi-agents-baseline').setData(empty)
      if (mImpact?.getSource('multi-agents-policy')) mImpact.getSource('multi-agents-policy').setData(empty)
    }
  }, [multiAbmActive])

  // Sync shelter marker data to both maps when shelterData arrives
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!shelterData?.length || !mBase?.getSource('shelters-main')) return
    const fc = { type: 'FeatureCollection', features: shelterData }
    mBase.getSource('shelters-main').setData(fc)
    if (mImpact?.getSource('shelters-impact')) mImpact.getSource('shelters-impact').setData(fc)
  }, [shelterData])

  // Highlight selected shelter on both maps
  useEffect(() => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('selected-shelter-main')) return
    const fc = selectedShelterCoord
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: selectedShelterCoord }, properties: {} }] }
      : { type: 'FeatureCollection', features: [] }
    mBase.getSource('selected-shelter-main').setData(fc)
    if (mImpact?.getSource('selected-shelter-impact')) mImpact.getSource('selected-shelter-impact').setData(fc)
  }, [selectedShelterCoord])
```

- [ ] **Step 5: Add `updateMultiAgentPositions` callback and return it**

After the existing `updateAgentPositions` useCallback, add:

```js
  // Update multi-agent dot positions from a snapshot frame
  // Called directly from MultiABMPanel RAF tick — no React state
  const updateMultiAgentPositions = useCallback((frameIdx, baseSnaps, policySnaps) => {
    const mBase   = mapRef.current
    const mImpact = mapImpactInst.current
    if (!mBase?.getSource('multi-agents-baseline')) return

    const toFC = snapshot => ({
      type: 'FeatureCollection',
      features: (snapshot || []).map(a => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
        properties: { arrived: a.arrived }
      }))
    })

    const bFrame = baseSnaps?.[Math.min(frameIdx, (baseSnaps?.length || 1) - 1)]
    const pFrame = policySnaps?.[Math.min(frameIdx, (policySnaps?.length || 1) - 1)]

    mBase.getSource('multi-agents-baseline').setData(toFC(bFrame))
    if (mImpact?.getSource('multi-agents-policy')) {
      mImpact.getSource('multi-agents-policy').setData(toFC(pFrame))
    }
  }, [])
```

Update the return object to include `updateMultiAgentPositions`:
```js
  return {
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef,
    updateAgentPositions,
    updateMultiAgentPositions
  }
```

- [ ] **Step 6: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useMapbox.js
git commit -m "feat: add shelter markers and multi-agent dot layers to Mapbox maps"
```

---

## Task 5: MultiABMPanel Component — Shelter Count Result Display

**Files:**
- Create: `src/components/MultiABMPanel/index.jsx`
- Modify: `src/styles/index.css` (append)

- [ ] **Step 1: Create `src/components/MultiABMPanel/index.jsx`**

```jsx
// src/components/MultiABMPanel/index.jsx
import { useState, useEffect, useRef } from 'react'

const FRAME_SKIP = 3  // ~20 animation frames/second at 60 fps

export default function MultiABMPanel({
  selectedShelter,
  baselineCount,
  policyCount,
  totalAgents,
  baselineSnapshots,
  policySnapshots,
  updateMultiAgentPositions,
  onReset
}) {
  const [playing,  setPlaying]  = useState(false)
  const [frameIdx, setFrameIdx] = useState(0)
  const rafRef    = useRef(null)
  const frameRef  = useRef(0)
  const updateRef = useRef(updateMultiAgentPositions)
  useEffect(() => { updateRef.current = updateMultiAgentPositions }, [updateMultiAgentPositions])

  const maxFrames = Math.max(baselineSnapshots?.length || 0, policySnapshots?.length || 0)

  // Reset animation when new simulation results arrive
  useEffect(() => {
    setFrameIdx(0)
    setPlaying(false)
    frameRef.current = 0
  }, [baselineSnapshots])

  // Animation loop — updates map agent dots directly (no React re-renders)
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); rafRef.current = null; return }

    let localFrame = null
    const tick = () => {
      frameRef.current += 1
      if (frameRef.current % FRAME_SKIP === 0) {
        setFrameIdx(f => {
          const next = f + 1
          if (next >= maxFrames) { setPlaying(false); return f }
          localFrame = next
          return next
        })
        if (localFrame !== null) {
          updateRef.current?.(localFrame, baselineSnapshots, policySnapshots)
        }
      }
      if (localFrame === null || localFrame < maxFrames - 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = null }
  }, [playing, maxFrames, baselineSnapshots, policySnapshots])

  if (!selectedShelter) return null

  const shelterName = selectedShelter.properties?.name || 'Selected Shelter'
  const district    = selectedShelter.properties?.addresses_district_name || ''

  const basePct   = totalAgents > 0 ? Math.round((baselineCount / totalAgents) * 100) : 0
  const policyPct = totalAgents > 0 ? Math.round((policyCount   / totalAgents) * 100) : 0
  const diff      = policyCount - baselineCount

  return (
    <div className="shelter-result-card">
      <div className="shelter-result-header">
        <div>
          <div className="shelter-result-name">🏛 {shelterName}</div>
          {district && <div className="shelter-result-district">{district}</div>}
        </div>
        <button className="abm-reset-btn" onClick={onReset}>✕ Reset</button>
      </div>

      <div className="shelter-count-section">
        <div className="shelter-count-label">Agents reaching shelter ({totalAgents} total)</div>

        <div className="shelter-count-row">
          <span className="shelter-count-tag baseline">Before</span>
          <div className="shelter-count-track">
            <div className="shelter-count-fill baseline-fill" style={{ width: basePct + '%' }} />
          </div>
          <span className="shelter-count-num">{baselineCount}/{totalAgents}</span>
        </div>

        <div className="shelter-count-row">
          <span className="shelter-count-tag policy">After</span>
          <div className="shelter-count-track">
            <div className="shelter-count-fill policy-fill" style={{ width: policyPct + '%' }} />
          </div>
          <span className="shelter-count-num">{policyCount}/{totalAgents}</span>
        </div>

        <div className={`shelter-diff ${diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral'}`}>
          {diff > 0
            ? `↑ ${diff} more agents reached safety after policy`
            : diff < 0
              ? `↓ ${Math.abs(diff)} fewer agents stressed enough to seek shelter`
              : 'Policy had no measurable effect on shelter utilisation'}
        </div>
      </div>

      {maxFrames > 1 && (
        <div className="abm-controls">
          <button className="abm-play-btn" onClick={() => setPlaying(p => !p)}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <input
            type="range"
            min={0}
            max={maxFrames - 1}
            value={frameIdx}
            onChange={e => {
              const f = Number(e.target.value)
              setFrameIdx(f)
              updateRef.current?.(f, baselineSnapshots, policySnapshots)
            }}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10, color: '#888', minWidth: 40 }}>
            {frameIdx * 5}/{MAX_STEPS}
          </span>
        </div>
      )}
    </div>
  )
}
```

Note: `MAX_STEPS` needs to be imported or defined locally. Add at the top of the file:
```js
const MAX_STEPS = 200
```

- [ ] **Step 2: Append shelter result card styles to `src/styles/index.css`**

Read the file first, then append:

```css
/* =====================
   MULTI-AGENT SHELTER RESULT CARD
   ===================== */

.shelter-result-card {
  background: rgba(5,5,5,0.9);
  border: 1px solid rgba(0,255,136,0.2);
  border-radius: 6px;
  padding: 10px;
  margin-top: 10px;
}

.shelter-result-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.shelter-result-name {
  font-size: 11px;
  color: #00ff88;
  font-weight: 600;
}

.shelter-result-district {
  font-size: 9px;
  color: #555;
  margin-top: 2px;
}

.shelter-count-section { margin-bottom: 8px; }

.shelter-count-label {
  font-size: 9px;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.shelter-count-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.shelter-count-tag {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  min-width: 36px;
  text-align: right;
}
.shelter-count-tag.baseline { color: #00eaff; }
.shelter-count-tag.policy   { color: #ff9900; }

.shelter-count-track {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  overflow: hidden;
}

.shelter-count-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.shelter-count-fill.baseline-fill { background: linear-gradient(90deg, #005577, #00eaff); }
.shelter-count-fill.policy-fill   { background: linear-gradient(90deg, #883300, #ff9900); }

.shelter-count-num {
  font-size: 10px;
  color: #888;
  min-width: 36px;
  text-align: right;
}

.shelter-diff {
  font-size: 10px;
  padding: 5px 0 2px;
  border-top: 1px solid rgba(255,255,255,0.06);
  margin-top: 4px;
}
.shelter-diff.positive { color: #00ff88; }
.shelter-diff.negative { color: #00cc88; }
.shelter-diff.neutral  { color: #555; }
```

- [ ] **Step 3: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/components/MultiABMPanel/index.jsx src/styles/index.css
git commit -m "feat: add MultiABMPanel shelter result card with animated agent replay"
```

---

## Task 6: ChatPanel — Show Multi-Agent Panel and Status Messages

**Files:**
- Modify: `src/components/ChatPanel/index.jsx`

- [ ] **Step 1: Update `src/components/ChatPanel/index.jsx`**

Read the file first.

**Add import** at the top:
```js
import MultiABMPanel from '../MultiABMPanel'
```

**Update function signature**:
```js
export default function ChatPanel({
  onImpactData,
  abmResult, abmPaths, updateAgentPositions, onResetABM,
  agenticMode,
  multiAbmResult, multiSnapshots, updateMultiAgentPositions, onResetMultiABM
}) {
```

**Inside `#chat-messages`, after the existing ABM status/ABMPanel block**, add multi-agent status and result panel:

```jsx
        {/* Multi-Agent ABM status messages */}
        {agenticMode === 'multi' && multiAbmResult?.multiSimState === 'selecting' && (
          <div className="abm-status">🟢 Click a shelter marker on the map to start the simulation</div>
        )}
        {agenticMode === 'multi' && multiAbmResult?.multiSimState === 'running' && (
          <div className="abm-status">⏳ Running generative simulation ({multiAbmResult.totalAgents} agents)...</div>
        )}
        {agenticMode === 'multi' && multiAbmResult?.multiSimState === 'done' && (
          <MultiABMPanel
            selectedShelter={multiAbmResult.selectedShelter}
            baselineCount={multiAbmResult.baselineCount}
            policyCount={multiAbmResult.policyCount}
            totalAgents={multiAbmResult.totalAgents}
            baselineSnapshots={multiSnapshots?.baselineSnapshots}
            policySnapshots={multiSnapshots?.policySnapshots}
            updateMultiAgentPositions={updateMultiAgentPositions}
            onReset={onResetMultiABM}
          />
        )}
```

- [ ] **Step 2: Verify lint and build**

```
npm run lint && npm run build
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatPanel/index.jsx
git commit -m "feat: show MultiABMPanel and status messages in ChatPanel for multi-agent mode"
```

---

## Spec Coverage Self-Check

| Requirement | Covered |
|---|---|
| Reset button on Climate Layers panel | Task 1 — `.panel-reset-btn` in LeftPanel header |
| Remove ABM button | Task 1 — `CLIMATE_FIELDS` no longer includes 'abm' |
| "Agentic Interaction" section with Single Agent + Multi-Agent | Task 1 — `.agentic-section` in LeftPanel |
| Single Agent tab activates existing ABM | Task 2 — `agenticMode === 'single'` → `abmActive = true` |
| Multi-Agent tab activates shelter simulation | Task 2 — `agenticMode === 'multi'` → `useMultiABM.isActive` |
| Load `climate_shelters.geojson` | Task 3 — `useMultiABM` fetches `/data/climate_shelters.geojson` |
| Show shelter markers on map | Task 4 — `shelters-main-circle` + `shelters-impact-circle` layers |
| User clicks shelter to start simulation | Task 4 — `map.on('click', 'shelters-main-circle', ...)` |
| 15–20 agents spawned within 600 m of shelter | Task 3 — `NUM_AGENTS = 20`, `SPAWN_RADIUS_M = 600` |
| Heat-stress threshold triggers shelter-seeking | Task 3 — `STRESS_THRESHOLD = 0.65` in `runSimulation` |
| Before agents read baseline vulnerability | Task 3 — `indexBaseRef.current` passed to first `runSimulation` |
| After agents read post-policy V_new | Task 3 — `indexPolicyRef.current` passed to second `runSimulation` |
| Same starting positions for both runs | Task 3 — LCG-seeded shuffle, same `startPositions` array |
| Show shelter arrival count before/after | Task 5 — `shelter-count-row` bars in `MultiABMPanel` |
| Animated agent dots on both maps | Task 4 + 5 — `updateMultiAgentPositions` + RAF loop in `MultiABMPanel` |
| Diff message (policy effect on shelter use) | Task 5 — `.shelter-diff` with positive/negative/neutral states |
| Green arrived agents, coloured walking agents | Task 4 — data-driven `circle-color` using `arrived` property |
