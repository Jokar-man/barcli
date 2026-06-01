# ABM Pathfinding Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use dbf-dev:subagent-driven-development (recommended) or dbf-dev:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an agent-based simulation mode to the map that lets a user place a start and destination point, then runs two A\* pathfinding simulations — one on baseline vulnerability, one on post-policy vulnerability — animates both agents on the map, and shows a comparative vulnerability profile chart in the chat panel.

**Architecture:** Client-side only — A\* runs on a road graph built from `data/climate_isochrone.geojson`, with edge costs weighted by vulnerability scores sampled from the nearest `data.geojson` points. The ABM mode activates when the user clicks the ABM button: the baseline map hides, only the impact map shows, and two clicks on the map set start (gold) and destination (silver) points. React state owns the ABM lifecycle; Mapbox GL owns all rendering.

**Tech Stack:** React 18 hooks, Mapbox GL 3, Turf.js 6 (already loaded), plain SVG for the path chart, no new npm dependencies.

---

## Reference: What the user's Python notebook does

From `ABM_Interactive.ipynb`:
- A\* search on a downsampled UTCI raster grid (~280×316 cells)
- `thermal_cost(v)` maps temperature → movement cost (hot = expensive)
- Two paths: base UTCI grid vs modified UTCI grid
- Output: animated map markers + line chart of UTCI value at each step

For barcli:
- Replace UTCI grid with vulnerability score grid (data.geojson points)
- Replace UTCI cost with vulnerability cost (high vuln = expensive)
- Replace raster grid with road graph (climate_isochrone.geojson LineStrings)
- "Before" = baseline vulnerability, "After" = post-policy V_new

## Reference: How the thesis repo routes

From `D:\Github\thesis\main.js`:
- `climate_isochrone.geojson` holds the road network as LineString features
- Snap arbitrary points to roads via `turf.nearestPointOnLine()`
- No backend needed — all client-side

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/abm/roadGraph.js` | Create | Parse isochrone GeoJSON → weighted adjacency graph; sample nodes at 30 m intervals |
| `src/utils/abm/astar.js` | Create | Generic A\* on the graph; accepts a `cost(nodeId)` function |
| `src/utils/abm/vulnerabilitySampler.js` | Create | Given [lng,lat], return nearest vulnerability score from loaded points |
| `src/hooks/useABM.js` | Create | ABM mode state machine: idle → placing-start → placing-end → running → done |
| `src/components/ABMPanel/index.jsx` | Create | Chart container shown in ChatPanel when ABM result exists |
| `src/components/ABMPanel/PathChart.jsx` | Create | SVG line chart: vulnerability along path, baseline (blue) vs policy (orange) |
| `src/hooks/useMapbox.js` | Modify | Add ABM map layers, click handler, path + agent animation |
| `src/components/LeftPanel/index.jsx` | Modify | ABM button activates ABM mode (not disabled any more) |
| `src/App.jsx` | Modify | Wire abmMode state, pass to useMapbox and ChatPanel |
| `src/components/ChatPanel/index.jsx` | Modify | Render ABMPanel when abmResult is available |

---

## Task 1: Road Graph Builder

**Files:**
- Create: `src/utils/abm/roadGraph.js`

This file parses `climate_isochrone.geojson` into an adjacency graph. Nodes are coordinates sampled every ~30 m along each LineString. Edges connect consecutive samples. Edge weights are geographic distances in metres.

- [ ] **Step 1: Create the file**

```js
// src/utils/abm/roadGraph.js
import * as turf from '@turf/turf'

const SAMPLE_INTERVAL_M = 30  // sample every 30 m along each road

/**
 * Build an adjacency graph from a GeoJSON FeatureCollection of LineStrings.
 * Returns { nodes: Map<id, [lng,lat]>, edges: Map<id, Array<{to, dist}>> }
 * where id = "lng,lat" rounded to 6 dp.
 */
export function buildRoadGraph(isochroneGeoJSON) {
  const nodes = new Map()   // id → [lng, lat]
  const edges = new Map()   // id → [{to: id, dist: number}]

  function nodeId([lng, lat]) {
    return `${lng.toFixed(6)},${lat.toFixed(6)}`
  }

  function ensureNode(coord) {
    const id = nodeId(coord)
    if (!nodes.has(id)) {
      nodes.set(id, coord)
      edges.set(id, [])
    }
    return id
  }

  function addEdge(idA, idB, dist) {
    edges.get(idA).push({ to: idB, dist })
    edges.get(idB).push({ to: idA, dist })
  }

  const features = isochroneGeoJSON.features || []

  features.forEach(feature => {
    const geom = feature.geometry
    if (!geom) return

    // Handle both LineString and MultiLineString
    const lines = geom.type === 'MultiLineString'
      ? geom.coordinates.map(coords => turf.lineString(coords))
      : geom.type === 'LineString'
        ? [feature]
        : []

    lines.forEach(line => {
      const totalLen = turf.length(line, { units: 'meters' })
      if (totalLen < 1) return

      const steps = Math.max(2, Math.ceil(totalLen / SAMPLE_INTERVAL_M))
      const sampledCoords = []

      for (let i = 0; i <= steps; i++) {
        const d = (i / steps) * totalLen
        const pt = turf.along(line, d, { units: 'meters' })
        sampledCoords.push(pt.geometry.coordinates)
      }

      // Connect consecutive samples
      for (let i = 0; i < sampledCoords.length - 1; i++) {
        const idA = ensureNode(sampledCoords[i])
        const idB = ensureNode(sampledCoords[i + 1])
        if (idA !== idB) {
          const dist = turf.distance(
            turf.point(sampledCoords[i]),
            turf.point(sampledCoords[i + 1]),
            { units: 'meters' }
          )
          addEdge(idA, idB, dist)
        }
      }
    })
  })

  return { nodes, edges }
}

/**
 * Snap an arbitrary [lng,lat] to the nearest node in the graph.
 * Returns the node id string.
 */
export function snapToGraph(coord, nodes) {
  let bestId = null
  let bestDist = Infinity

  for (const [id, nodeCoord] of nodes) {
    const d = turf.distance(turf.point(coord), turf.point(nodeCoord), { units: 'meters' })
    if (d < bestDist) {
      bestDist = d
      bestId = id
    }
  }

  return bestId
}
```

- [ ] **Step 2: Verify lint**

```
npm run lint
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/abm/roadGraph.js
git commit -m "feat: add road graph builder from isochrone GeoJSON"
```

---

## Task 2: A\* Algorithm

**Files:**
- Create: `src/utils/abm/astar.js`

Generic A\* on the road graph. Accepts a `costFn(nodeId) → number` multiplier so the same algorithm works for both baseline and post-policy vulnerability.

- [ ] **Step 1: Create the file**

```js
// src/utils/abm/astar.js

/**
 * A* pathfinding on a road graph.
 *
 * @param {string}   startId    - node id (from roadGraph)
 * @param {string}   goalId     - node id (from roadGraph)
 * @param {Map}      nodes      - id → [lng, lat]
 * @param {Map}      edges      - id → [{to, dist}]
 * @param {Function} costFn     - (nodeId) → vulnerability multiplier [0.5 .. 3.0]
 * @returns {string[]}          - ordered array of node ids, empty if no path
 */
export function astar(startId, goalId, nodes, edges, costFn) {
  if (!nodes.has(startId) || !nodes.has(goalId)) return []

  const goalCoord = nodes.get(goalId)

  // Euclidean heuristic in metres
  function heuristic(id) {
    const [lng, lat] = nodes.get(id)
    const [glng, glat] = goalCoord
    const dx = (lng - glng) * 111320 * Math.cos(lat * Math.PI / 180)
    const dy = (lat - glat) * 110540
    return Math.sqrt(dx * dx + dy * dy)
  }

  const gScore = new Map([[startId, 0]])
  const fScore = new Map([[startId, heuristic(startId)]])
  const cameFrom = new Map()
  // Min-heap via sorted array (sufficient for ~10k nodes)
  const open = [{ id: startId, f: heuristic(startId) }]
  const closed = new Set()

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f)
    const { id: current } = open.shift()

    if (current === goalId) {
      // Reconstruct path
      const path = []
      let node = current
      while (node) {
        path.unshift(node)
        node = cameFrom.get(node)
      }
      return path
    }

    closed.add(current)

    const neighbours = edges.get(current) || []
    for (const { to, dist } of neighbours) {
      if (closed.has(to)) continue
      // Cost = geographic distance × vulnerability multiplier at destination
      const tentativeG = (gScore.get(current) || Infinity) + dist * costFn(to)
      const prevG = gScore.get(to) ?? Infinity
      if (tentativeG < prevG) {
        cameFrom.set(to, current)
        gScore.set(to, tentativeG)
        const f = tentativeG + heuristic(to)
        fScore.set(to, f)
        if (!open.find(o => o.id === to)) {
          open.push({ id: to, f })
        } else {
          const existing = open.find(o => o.id === to)
          if (existing) existing.f = f
        }
      }
    }
  }

  return []  // no path found
}

/**
 * Map vulnerability score [0,1] to movement cost multiplier.
 * Higher vulnerability = more expensive to traverse (agent avoids high-risk areas).
 * Mirrors the thermal_cost() function from ABM_Interactive.ipynb.
 */
export function vulnerabilityCost(score) {
  if (score > 0.8) return 6.0
  if (score > 0.6) return 3.0
  if (score > 0.4) return 1.5
  if (score > 0.2) return 1.0
  return 0.5  // low vulnerability = easy/safe to traverse
}
```

- [ ] **Step 2: Verify lint**

```
npm run lint
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/abm/astar.js
git commit -m "feat: add A* pathfinding with vulnerability cost function"
```

---

## Task 3: Vulnerability Sampler

**Files:**
- Create: `src/utils/abm/vulnerabilitySampler.js`

Given any `[lng, lat]` coordinate and the loaded `points` FeatureCollection, returns the nearest vulnerability score for a given field. Used to assign costs to road graph nodes.

- [ ] **Step 1: Create the file**

```js
// src/utils/abm/vulnerabilitySampler.js
import { computeRaw, normalize } from '../geo'

/**
 * Build a spatial index (flat array) from loaded GeoJSON points.
 * Returns an object used by sampleVulnerability().
 *
 * @param {object}   pointsGeoJSON - the loaded data.geojson FeatureCollection
 * @param {object}   stats         - stats object from computeStats()
 * @param {string[]} activeFields  - which fields to average ['heat','SPEI','urban_health']
 * @returns {Array<{lng, lat, score}>}
 */
export function buildSpatialIndex(pointsGeoJSON, stats, activeFields) {
  if (!pointsGeoJSON || !activeFields.length) return []

  return pointsGeoJSON.features.map(f => {
    const [lng, lat] = f.geometry.coordinates
    const p = f.properties

    let sum = 0
    activeFields.forEach(k => {
      sum += normalize(computeRaw(p, k), k, stats)
    })
    const score = sum / activeFields.length

    return { lng, lat, score }
  })
}

/**
 * Sample the vulnerability score nearest to [lng, lat].
 * Linear scan — fast enough for ~2000 points.
 *
 * @param {number}  lng
 * @param {number}  lat
 * @param {Array}   spatialIndex - from buildSpatialIndex()
 * @returns {number} score [0, 1]
 */
export function sampleVulnerability(lng, lat, spatialIndex) {
  if (!spatialIndex.length) return 0.5

  let bestScore = 0.5
  let bestDist = Infinity

  for (const pt of spatialIndex) {
    const dx = (lng - pt.lng) * 111320 * Math.cos(lat * Math.PI / 180)
    const dy = (lat - pt.lat) * 110540
    const d = dx * dx + dy * dy  // skip sqrt — only comparing
    if (d < bestDist) {
      bestDist = d
      bestScore = pt.score
    }
  }

  return bestScore
}

/**
 * Given an ordered list of node ids, return the vulnerability score at each node.
 * @param {string[]} path
 * @param {Map}      nodes        - id → [lng, lat]
 * @param {Array}    spatialIndex - from buildSpatialIndex()
 * @returns {number[]}
 */
export function profileAlongPath(path, nodes, spatialIndex) {
  return path.map(id => {
    const [lng, lat] = nodes.get(id)
    return sampleVulnerability(lng, lat, spatialIndex)
  })
}
```

- [ ] **Step 2: Verify lint**

```
npm run lint
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/abm/vulnerabilitySampler.js
git commit -m "feat: add vulnerability spatial sampler for ABM path costs"
```

---

## Task 4: Path Chart SVG Component

**Files:**
- Create: `src/components/ABMPanel/PathChart.jsx`
- Create: `src/components/ABMPanel/index.jsx`

`PathChart` renders a pure SVG line chart showing vulnerability along path. `ABMPanel` wraps it with labels and a play/reset button.

- [ ] **Step 1: Create PathChart.jsx**

```jsx
// src/components/ABMPanel/PathChart.jsx

const W = 310
const H = 140
const PAD = { top: 10, right: 10, bottom: 28, left: 32 }

export default function PathChart({ baselineProfile, policyProfile, stepIndex }) {
  if (!baselineProfile?.length) return null

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const n = Math.max(baselineProfile.length, policyProfile?.length || 0)

  function xScale(i) { return PAD.left + (i / (n - 1)) * innerW }
  function yScale(v) { return PAD.top + innerH - v * innerH }

  function toPolyline(profile) {
    return profile.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' ')
  }

  const stepX = stepIndex != null ? xScale(Math.min(stepIndex, n - 1)) : null

  return (
    <svg width={W} height={H} style={{ display: 'block', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
      {/* Y axis */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + innerH} stroke="#444" strokeWidth={1} />
      {/* X axis */}
      <line x1={PAD.left} y1={PAD.top + innerH} x2={PAD.left + innerW} y2={PAD.top + innerH} stroke="#444" strokeWidth={1} />
      {/* Y axis labels */}
      {[0, 0.5, 1].map(v => (
        <text key={v} x={PAD.left - 4} y={yScale(v) + 4} fill="#666" fontSize={8} textAnchor="end">{v.toFixed(1)}</text>
      ))}
      {/* Axis titles */}
      <text x={PAD.left + innerW / 2} y={H - 2} fill="#555" fontSize={8} textAnchor="middle">steps</text>
      <text x={8} y={PAD.top + innerH / 2} fill="#555" fontSize={8} textAnchor="middle" transform={`rotate(-90,8,${PAD.top + innerH / 2})`}>vulnerability</text>

      {/* Policy path (orange) */}
      {policyProfile?.length > 0 && (
        <polyline points={toPolyline(policyProfile)} fill="none" stroke="#ff9900" strokeWidth={1.5} strokeDasharray="4 2" opacity={0.8} />
      )}
      {/* Baseline path (cyan) */}
      <polyline points={toPolyline(baselineProfile)} fill="none" stroke="#00eaff" strokeWidth={1.5} opacity={0.9} />

      {/* Step cursor */}
      {stepX != null && (
        <line x1={stepX} y1={PAD.top} x2={stepX} y2={PAD.top + innerH} stroke="#fff" strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
      )}

      {/* Legend */}
      <rect x={PAD.left + 4} y={PAD.top + 4} width={8} height={2} fill="#00eaff" />
      <text x={PAD.left + 15} y={PAD.top + 8} fill="#00eaff" fontSize={7}>Baseline</text>
      <rect x={PAD.left + 55} y={PAD.top + 4} width={8} height={2} fill="#ff9900" />
      <text x={PAD.left + 66} y={PAD.top + 8} fill="#ff9900" fontSize={7}>After Policy</text>
    </svg>
  )
}
```

- [ ] **Step 2: Create ABMPanel/index.jsx**

```jsx
// src/components/ABMPanel/index.jsx
import { useState, useEffect, useRef } from 'react'
import PathChart from './PathChart'

export default function ABMPanel({ baselineProfile, policyProfile, onReset }) {
  const [playing, setPlaying] = useState(false)
  const [step, setStep] = useState(0)
  const rafRef = useRef(null)
  const maxSteps = Math.max(baselineProfile?.length || 0, policyProfile?.length || 0)

  useEffect(() => {
    setStep(0)
    setPlaying(false)
  }, [baselineProfile])

  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return }
    const tick = () => {
      setStep(s => {
        if (s >= maxSteps - 1) { setPlaying(false); return s }
        rafRef.current = requestAnimationFrame(tick)
        return s + 1
      })
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, maxSteps])

  if (!baselineProfile?.length) return null

  return (
    <div className="abm-panel">
      <div className="abm-panel-header">
        <span>ABM Path Analysis</span>
        <button className="abm-reset-btn" onClick={onReset}>✕ Reset</button>
      </div>
      <PathChart
        baselineProfile={baselineProfile}
        policyProfile={policyProfile}
        stepIndex={step}
      />
      <div className="abm-controls">
        <button
          className="abm-play-btn"
          onClick={() => setPlaying(p => !p)}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <input
          type="range"
          min={0}
          max={maxSteps - 1}
          value={step}
          onChange={e => setStep(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, color: '#888', minWidth: 40 }}>{step}/{maxSteps - 1}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add ABM panel CSS to `src/styles/index.css`**

Append to the bottom of `src/styles/index.css`:

```css
/* =====================
   ABM PANEL
   ===================== */

.abm-panel {
  background: rgba(5,5,5,0.9);
  border: 1px solid rgba(0,234,255,0.15);
  border-radius: 6px;
  padding: 10px;
  margin-top: 10px;
}

.abm-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 10px;
  color: #00eaff;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 8px;
}

.abm-reset-btn {
  background: none;
  border: none;
  color: #555;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.abm-reset-btn:hover { color: #ff4466; }

.abm-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.abm-play-btn {
  background: rgba(0,234,255,0.1);
  border: 1px solid rgba(0,234,255,0.25);
  color: #00eaff;
  font-size: 10px;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}
.abm-play-btn:hover { background: rgba(0,234,255,0.2); }

.abm-status {
  font-size: 10px;
  color: #888;
  padding: 6px 0 2px;
  text-align: center;
}
```

- [ ] **Step 4: Verify lint and build**

```
npm run lint && npm run build
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add src/components/ABMPanel/
git commit -m "feat: add ABM path chart SVG component with play animation"
```

---

## Task 5: useABM Hook

**Files:**
- Create: `src/hooks/useABM.js`

Orchestrates the ABM: loads isochrone data once, builds the graph, responds to map clicks, runs A\* twice (baseline + policy), returns results.

- [ ] **Step 1: Create the file**

```js
// src/hooks/useABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { astar, vulnerabilityCost } from '../utils/abm/astar'
import { buildSpatialIndex, sampleVulnerability, profileAlongPath } from '../utils/abm/vulnerabilitySampler'

/**
 * ABM mode states:
 *   'idle'          - ABM not active
 *   'placing-start' - waiting for user to click start point
 *   'placing-end'   - waiting for user to click destination
 *   'running'       - computing paths
 *   'done'          - paths available, chart visible
 */

export default function useABM({ isActive, points, stats, activeFields, impactFeatures }) {
  const [abmState, setAbmState]         = useState('idle')
  const [startCoord, setStartCoord]     = useState(null)  // [lng, lat]
  const [endCoord, setEndCoord]         = useState(null)
  const [baselineProfile, setBaseline]  = useState(null)  // number[]
  const [policyProfile, setPolicy]      = useState(null)  // number[]
  const [baselinePath, setBaselinePath] = useState(null)  // [[lng,lat], ...]
  const [policyPath, setPolicyPath]     = useState(null)

  const graphRef  = useRef(null)  // { nodes, edges }
  const indexBaseRef   = useRef(null)  // baseline spatial index
  const indexPolicyRef = useRef(null)  // policy spatial index

  // Load isochrone and build road graph once
  useEffect(() => {
    if (!isActive || graphRef.current) return
    fetch('/data/climate_isochrone.geojson')
      .then(r => r.json())
      .then(geojson => {
        graphRef.current = buildRoadGraph(geojson)
        console.log('[ABM] Road graph built:', graphRef.current.nodes.size, 'nodes')
      })
      .catch(e => console.error('[ABM] Failed to load isochrone:', e))
  }, [isActive])

  // Build spatial indices when points / impactFeatures change
  useEffect(() => {
    if (!points || !activeFields.length) return
    indexBaseRef.current = buildSpatialIndex(points, stats, activeFields)
  }, [points, stats, activeFields])

  useEffect(() => {
    if (!impactFeatures) return
    // impactFeatures is a FeatureCollection with _value already computed
    // Build a simpler index: just {lng, lat, score: _value}
    indexPolicyRef.current = impactFeatures.features.map(f => ({
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      score: f.properties._value || 0
    }))
  }, [impactFeatures])

  // Activate / deactivate ABM
  useEffect(() => {
    if (!isActive) {
      setAbmState('idle')
      setStartCoord(null)
      setEndCoord(null)
      setBaseline(null)
      setPolicy(null)
      setBaselinePath(null)
      setPolicyPath(null)
    } else {
      setAbmState('placing-start')
    }
  }, [isActive])

  // Handle a map click
  const handleMapClick = useCallback((lngLat) => {
    if (abmState === 'placing-start') {
      setStartCoord([lngLat.lng, lngLat.lat])
      setAbmState('placing-end')
    } else if (abmState === 'placing-end') {
      setEndCoord([lngLat.lng, lngLat.lat])
      setAbmState('running')
    }
  }, [abmState])

  // Run A* when both points are set
  useEffect(() => {
    if (abmState !== 'running') return
    if (!startCoord || !endCoord) return
    if (!graphRef.current) {
      console.warn('[ABM] Graph not ready yet')
      setAbmState('placing-start')
      return
    }

    const { nodes, edges } = graphRef.current
    const startId = snapToGraph(startCoord, nodes)
    const goalId  = snapToGraph(endCoord, nodes)

    if (!startId || !goalId) {
      console.warn('[ABM] Could not snap to graph')
      setAbmState('placing-start')
      return
    }

    // Cost function: vulnerability at node × distance
    const baseIndex   = indexBaseRef.current   || []
    const policyIndex = indexPolicyRef.current || baseIndex

    const baseCostFn = (id) => {
      const [lng, lat] = nodes.get(id)
      return vulnerabilityCost(sampleVulnerability(lng, lat, baseIndex))
    }
    const policyCostFn = (id) => {
      const [lng, lat] = nodes.get(id)
      return vulnerabilityCost(sampleVulnerability(lng, lat, policyIndex))
    }

    const basePath   = astar(startId, goalId, nodes, edges, baseCostFn)
    const policyPath = activeFields.length > 0 && policyIndex.length
      ? astar(startId, goalId, nodes, edges, policyCostFn)
      : basePath

    if (!basePath.length) {
      console.warn('[ABM] No path found')
      setAbmState('placing-start')
      return
    }

    // Convert node ids back to [lng, lat] for map rendering
    const toCoords = path => path.map(id => nodes.get(id))
    setBaselinePath(toCoords(basePath))
    setPolicyPath(toCoords(policyPath))

    // Build vulnerability profiles along each path
    setBaseline(profileAlongPath(basePath,   nodes, baseIndex))
    setPolicy(profileAlongPath(policyPath, nodes, policyIndex))

    setAbmState('done')
  }, [abmState, startCoord, endCoord, activeFields])

  const reset = useCallback(() => {
    setAbmState('placing-start')
    setStartCoord(null)
    setEndCoord(null)
    setBaseline(null)
    setPolicy(null)
    setBaselinePath(null)
    setPolicyPath(null)
  }, [])

  return {
    abmState,
    startCoord,
    endCoord,
    baselineProfile,
    policyProfile,
    baselinePath,
    policyPath,
    handleMapClick,
    reset
  }
}
```

- [ ] **Step 2: Verify lint**

```
npm run lint
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useABM.js
git commit -m "feat: add useABM hook with A* pathfinding orchestration"
```

---

## Task 6: Mapbox ABM Layers

**Files:**
- Modify: `src/hooks/useMapbox.js`

Add map click handler, gold/silver markers, path line layers, and a `setImpactFeaturesRef` so `useABM` can access post-policy data.

- [ ] **Step 1: Add ABM props to `useMapbox` signature**

Change the function signature from:
```js
export default function useMapbox({ activeFields, impactData, selectedCategory }) {
```
to:
```js
export default function useMapbox({ activeFields, impactData, selectedCategory, abmMode, abmCallbacks }) {
```

Where:
- `abmMode`: `'idle' | 'placing-start' | 'placing-end' | 'running' | 'done'`
- `abmCallbacks`: `{ handleMapClick, startCoord, endCoord, baselinePath, policyPath }`

- [ ] **Step 2: Add ABM cursor feedback on map**

Inside the map `load` callback (after camera sync), add:
```js
// ABM: pointer cursor when in placing mode
map.on('click', e => {
  if (abmCallbacksRef.current?.handleMapClick) {
    abmCallbacksRef.current.handleMapClick(e.lngLat)
  }
})
```

Add at the top of the hook (after other refs):
```js
const abmCallbacksRef = useRef(abmCallbacks)
useEffect(() => { abmCallbacksRef.current = abmCallbacks }, [abmCallbacks])
```

- [ ] **Step 3: Add ABM layer initialisation (inside impact map load callback)**

After `addGlowLayers(impactMap, 'points-impact', 'impact')`, add:

```js
// ABM layers — all empty at start
impactMap.addSource('abm-start', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
impactMap.addSource('abm-end',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
impactMap.addSource('abm-path-baseline', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
impactMap.addSource('abm-path-policy',   { type: 'FeatureCollection', features: [] })

impactMap.addLayer({
  id: 'abm-path-baseline-line',
  type: 'line',
  source: 'abm-path-baseline',
  paint: { 'line-color': '#00eaff', 'line-width': 3, 'line-opacity': 0.85 }
})
impactMap.addLayer({
  id: 'abm-path-policy-line',
  type: 'line',
  source: 'abm-path-policy',
  paint: { 'line-color': '#ff9900', 'line-width': 3, 'line-opacity': 0.85, 'line-dasharray': [4, 2] }
})
impactMap.addLayer({
  id: 'abm-start-circle',
  type: 'circle',
  source: 'abm-start',
  paint: { 'circle-radius': 8, 'circle-color': '#FFD700', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
})
impactMap.addLayer({
  id: 'abm-end-circle',
  type: 'circle',
  source: 'abm-end',
  paint: { 'circle-radius': 8, 'circle-color': '#C0C0C0', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }
})
```

Note: `'abm-path-policy'` source uses inline data — fix to proper addSource pattern:
```js
impactMap.addSource('abm-path-policy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
```

- [ ] **Step 4: Sync ABM markers and paths to map**

Add a `useEffect` that watches the ABM callbacks and updates the map sources:

```js
useEffect(() => {
  const m = mapImpactInst.current
  if (!m || !m.getSource('abm-start')) return

  const { startCoord, endCoord, baselinePath, policyPath } = abmCallbacks || {}

  // Start marker
  m.getSource('abm-start').setData({
    type: 'FeatureCollection',
    features: startCoord
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: startCoord }, properties: {} }]
      : []
  })

  // End marker
  m.getSource('abm-end').setData({
    type: 'FeatureCollection',
    features: endCoord
      ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: endCoord }, properties: {} }]
      : []
  })

  // Baseline path
  m.getSource('abm-path-baseline').setData({
    type: 'FeatureCollection',
    features: baselinePath?.length > 1
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: baselinePath }, properties: {} }]
      : []
  })

  // Policy path
  m.getSource('abm-path-policy').setData({
    type: 'FeatureCollection',
    features: policyPath?.length > 1
      ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: policyPath }, properties: {} }]
      : []
  })
}, [abmCallbacks])  // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 5: Hide baseline map when ABM mode is active**

Add a `useEffect` watching `abmMode`:

```js
useEffect(() => {
  const m = mapRef.current
  if (!m) return
  const isAbm = abmMode !== 'idle'
  // Hide all climate visualisation layers on baseline map in ABM mode
  ;['glow-halo-main', 'glow-core-main'].forEach(id => {
    if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', isAbm ? 'none' : 'visible')
  })
}, [abmMode])
```

- [ ] **Step 6: Verify lint and build**

```
npm run lint && npm run build
```

Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useMapbox.js
git commit -m "feat: add ABM map layers, click handler, and mode visibility toggle"
```

---

## Task 7: Wire ABM into App.jsx and LeftPanel

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/LeftPanel/index.jsx`

- [ ] **Step 1: Update App.jsx**

Add imports:
```js
import useABM from './hooks/useABM'
```

Add state:
```js
const [abmActive, setAbmActive] = useState(false)
const [impactFeatures, setImpactFeatures] = useState(null)
```

Add the `useABM` hook after `useMapbox`:
```js
const {
  abmState,
  startCoord,
  endCoord,
  baselineProfile,
  policyProfile,
  baselinePath,
  policyPath,
  handleMapClick,
  reset: resetABM
} = useABM({
  isActive: abmActive,
  points: pointsFromHook,
  stats:  statsFromHook,
  activeFields,
  impactFeatures
})
```

> Note: `useMapbox` needs to return `points` and `stats` so `useABM` can use them.
> Add to `useMapbox` return: `pointsRef: pointsRef, statsRef: statsRef`
> Then in App.jsx: `const pointsFromHook = mapboxResult.pointsRef.current` etc.
> OR expose them as state (simpler for now): add `const [loadedPoints, setLoadedPoints] = useState(null)` in useMapbox and call `setLoadedPoints(pts)` after fetch.

Pass to `useMapbox`:
```js
const mapboxResult = useMapbox({
  activeFields,
  impactData,
  selectedCategory,
  abmMode: abmState,
  abmCallbacks: { handleMapClick, startCoord, endCoord, baselinePath, policyPath }
})
```

Handle ABM toggle:
```js
const handleToggleField = useCallback((field) => {
  if (field === 'abm') {
    setAbmActive(prev => !prev)
    return
  }
  setActiveFields(prev =>
    prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
  )
}, [])
```

Pass `abmResult` to ChatPanel:
```js
<ChatPanel
  onImpactData={handleImpactData}
  abmResult={{ baselineProfile, policyProfile, abmState }}
  onResetABM={resetABM}
/>
```

- [ ] **Step 2: Update LeftPanel — enable ABM button**

Change in `LeftPanel/index.jsx`:
```js
const FIELDS = [
  { key: 'heat',         label: 'Heat' },
  { key: 'SPEI',         label: 'Drought' },
  { key: 'urban_health', label: 'Urban Health' },
  { key: 'abm',          label: 'ABM' },  // remove disabled + soon
]
```

The ABM button will now be fully active and toggle with the same `onToggleField` mechanism.
Add a visual indicator for ABM mode: when `activeFields.includes('abm')`, show the button in a gold accent:

```jsx
style={key === 'abm' && activeFields.includes('abm')
  ? { borderColor: '#FFD700', color: '#FFD700', background: 'rgba(255,215,0,0.1)' }
  : undefined}
```

- [ ] **Step 3: Verify lint and build**

```
npm run lint && npm run build
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/LeftPanel/index.jsx
git commit -m "feat: wire ABM hook into App, enable ABM button with gold accent"
```

---

## Task 8: Show ABMPanel in ChatPanel

**Files:**
- Modify: `src/components/ChatPanel/index.jsx`

- [ ] **Step 1: Update ChatPanel to accept abmResult and render ABMPanel**

Add to ChatPanel's props: `{ onImpactData, abmResult, onResetABM }`

Add import at top:
```js
import ABMPanel from '../ABMPanel'
```

Add status message in the messages list based on `abmResult.abmState`:

```jsx
{abmResult?.abmState === 'placing-start' && (
  <div className="abm-status">🟡 Click on the map to place the <strong>start point</strong></div>
)}
{abmResult?.abmState === 'placing-end' && (
  <div className="abm-status">⚪ Click on the map to place the <strong>destination</strong></div>
)}
{abmResult?.abmState === 'running' && (
  <div className="abm-status">⏳ Running pathfinding simulation...</div>
)}
{abmResult?.baselineProfile && (
  <ABMPanel
    baselineProfile={abmResult.baselineProfile}
    policyProfile={abmResult.policyProfile}
    onReset={onResetABM}
  />
)}
```

These are rendered inside `#chat-messages` div, below the welcome/result cards.

- [ ] **Step 2: Verify lint and build**

```
npm run lint && npm run build
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatPanel/index.jsx
git commit -m "feat: show ABM status messages and path chart in chat panel"
```

---

## Spec Coverage Self-Check

| Requirement | Covered by |
|---|---|
| ABM button click hides baseline raster, shows only impact map | Task 6 Step 5 |
| Gold start point on map | Task 6 Step 3 (abm-start-circle, fill #FFD700) |
| Silver destination point on map | Task 6 Step 3 (abm-end-circle, fill #C0C0C0) |
| Mesa-style A\* pathfinding | Task 2 (astar.js mirrors thermal_cost from notebook) |
| Pathways based on before raster | Task 5 — baseline spatial index |
| Pathways based on after policy raster | Task 5 — policy spatial index from impactFeatures |
| Uses road network for routing | Task 1 (roadGraph.js from climate_isochrone.geojson) |
| Graph chart in chat panel | Tasks 4 + 8 |
| Chart shows baseline vs policy | PathChart.jsx — two lines |
| User clicks start/destination on map | Task 5 handleMapClick state machine |

---

## Known Constraints

- **A\* performance:** With ~30 m sampling, the road graph may have 10k–30k nodes. A\* worst-case is slow for very long paths. If paths exceed 2 km, consider increasing `SAMPLE_INTERVAL_M` to 50 m.
- **No policy data yet:** If the user hasn't run an AI analysis yet (no impactData), the policy path falls back to the baseline path (same result). The UI should make this clear.
- **climate_isochrone.geojson** is already in `data/` in both the barcli repo and the thesis repo — no copy needed.
