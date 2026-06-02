// src/hooks/useMultiABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { buildSpatialIndex, sampleVulnerability } from '../utils/abm/vulnerabilitySampler'

const NUM_AGENTS       = 20
const MAX_STEPS        = 200
const SNAPSHOT_EVERY   = 5       // store agent positions every 5 sim steps → 40 animation frames
const SPAWN_RADIUS_M   = 600     // max metres from shelter to spawn agents
const SPAWN_MIN_M      = 150     // min metres — agents must start at least this far from shelter
// Cumulative stress model:
//   Each step the agent stands in a node with vuln > HEAT_TRIGGER, stress accumulates.
//   Only when total accumulated stress ≥ STRESS_ACCUMULATION_THRESHOLD does the agent
//   turn toward the shelter. Agents in cool areas may NEVER reach the threshold.
const HEAT_TRIGGER     = 0.45    // vulnerability above this contributes to stress accumulation
const STRESS_THRESHOLD = 4.0     // total accumulated stress that triggers shelter-seeking
//   Example: node with vuln=0.8 → adds (0.8-0.45)×2 = 0.70 per step → triggers after ~6 steps
//            node with vuln=0.5 → adds (0.5-0.45)×2 = 0.10 per step → triggers after ~40 steps
//            node with vuln=0.4 → adds nothing → never triggers

// Squared distance (metres) — no sqrt needed, used for comparison only
function distSq([lng1, lat1], [lng2, lat2]) {
  const dx = (lng1 - lng2) * 111320 * Math.cos(lat1 * Math.PI / 180)
  const dy = (lat1 - lat2) * 110540
  return dx * dx + dy * dy
}

/**
 * Run one multi-agent simulation synchronously.
 * Each agent: random-walks when comfortable, seeks shelter greedily when stressed.
 * Returns { arrivedCount, snapshots }
 * snapshots: array of frames — each frame = [{id, lng, lat, arrived}]
 */
function runSimulation(startNodeIds, shelterNodeId, nodes, edges, spatialIndex) {
  // Cache vulnerability per node to avoid repeated O(N) spatial lookups
  const vulnCache = new Map()
  const getVuln = id => {
    if (!vulnCache.has(id)) {
      const [lng, lat] = nodes.get(id)
      vulnCache.set(id, sampleVulnerability(lng, lat, spatialIndex))
    }
    return vulnCache.get(id)
  }

  const shelterCoord = nodes.get(shelterNodeId)

  // Mutable agent objects — no immutability needed inside simulation
  const agents = startNodeIds.map((nodeId, i) => ({
    id:          i,
    nodeId,
    seeking:     false,     // true once accumulated stress ≥ STRESS_THRESHOLD
    arrived:     nodeId === shelterNodeId,
    visited:     new Set([nodeId]),
    stressAccum: 0.0        // accumulated heat stress (cumulative, not instantaneous)
  }))

  const toCoord = id => { const [lng, lat] = nodes.get(id); return { lng, lat } }

  const snapshots = [agents.map(a => ({ id: a.id, ...toCoord(a.nodeId), arrived: a.arrived }))]

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const agent of agents) {
      if (agent.arrived) continue

      const v = getVuln(agent.nodeId)
      // Accumulate heat stress: only nodes above HEAT_TRIGGER contribute
      // The excess × 2 scales so vuln=0.8 adds ~0.7/step, vuln=0.5 adds ~0.1/step
      if (v > HEAT_TRIGGER) {
        agent.stressAccum += (v - HEAT_TRIGGER) * 2
      }
      // Trigger shelter-seeking once cumulative stress crosses the threshold
      if (!agent.seeking && agent.stressAccum >= STRESS_THRESHOLD) {
        agent.seeking = true
      }

      const neighbours = (edges.get(agent.nodeId) || []).map(e => e.to)
      if (!neighbours.length) continue

      let nextNode
      if (agent.seeking) {
        // Greedy toward shelter — prefer unvisited to break potential loops
        const unvisited = neighbours.filter(id => !agent.visited.has(id))
        const pool = unvisited.length ? unvisited : neighbours
        nextNode = pool.reduce((best, id) =>
          distSq(nodes.get(id), shelterCoord) < distSq(nodes.get(best), shelterCoord) ? id : best
        )
        if (nextNode === shelterNodeId || agent.nodeId === shelterNodeId) {
          agent.arrived = true
          agent.nodeId  = shelterNodeId
          continue
        }
      } else {
        // Random walk — prefer unvisited to spread out through the neighbourhood
        const unvisited = neighbours.filter(id => !agent.visited.has(id))
        const pool = unvisited.length ? unvisited : neighbours
        nextNode = pool[Math.floor(Math.random() * pool.length)]
      }

      agent.visited.add(nextNode)
      agent.nodeId = nextNode
    }

    if ((step + 1) % SNAPSHOT_EVERY === 0 || step === MAX_STEPS - 1) {
      snapshots.push(agents.map(a => ({ id: a.id, ...toCoord(a.nodeId), arrived: a.arrived })))
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

  // Load shelter GeoJSON once when active
  useEffect(() => {
    if (!isActive || shelters.length) return
    fetch('/data/climate_shelters.geojson')
      .then(r => r.json())
      .then(geo => setShelters(geo.features || []))
      .catch(e => console.error('[MultiABM] Failed to load shelters:', e))
  }, [isActive, shelters.length])

  // Rebuild baseline spatial index when points/stats/activeFields change
  useEffect(() => {
    if (!points || !activeFields.length) return
    indexBaseRef.current = buildSpatialIndex(points, stats, activeFields)
  }, [points, stats, activeFields])

  // Rebuild policy spatial index when impact features change
  useEffect(() => {
    if (!impactFeatures?.features) return
    indexPolicyRef.current = impactFeatures.features.map(f => ({
      lng:   f.geometry.coordinates[0],
      lat:   f.geometry.coordinates[1],
      score: f.properties._value || 0
    }))
  }, [impactFeatures])

  // Reset state when deactivated
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
    const shelterCoord  = shelterFeature.geometry.coordinates  // [lng, lat]
    const shelterNodeId = snapToGraph(shelterCoord, nodes)

    if (!shelterNodeId) {
      console.warn('[MultiABM] Could not snap shelter to graph')
      setMultiSimState('selecting')
      return
    }

    // Find road nodes within SPAWN_RADIUS_M but at least SPAWN_MIN_M from shelter
    // Minimum distance ensures agents must actually walk through the city to reach shelter
    const [slng, slat] = shelterCoord
    const RADIUS_SQ  = SPAWN_RADIUS_M * SPAWN_RADIUS_M
    const MIN_SQ     = SPAWN_MIN_M    * SPAWN_MIN_M
    const candidates = []
    for (const [id, coord] of nodes) {
      if (id === shelterNodeId) continue
      const d = distSq(coord, [slng, slat])
      if (d >= MIN_SQ && d <= RADIUS_SQ) candidates.push(id)
    }

    if (candidates.length < NUM_AGENTS) {
      console.warn('[MultiABM] Not enough road nodes near shelter — try a different one')
      setMultiSimState('selecting')
      return
    }

    // Deterministic Fisher-Yates shuffle seeded by shelter longitude
    // — ensures both baseline and policy simulations start from identical positions
    const shuffled = [...candidates]
    let seed = (shelterFeature.geometry.coordinates[0] * 1000) | 0
    const lcg = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xFFFFFFFF
    }
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(lcg() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const startPositions = shuffled.slice(0, NUM_AGENTS)

    const baseIndex   = indexBaseRef.current
    const policyIndex = indexPolicyRef.current.length ? indexPolicyRef.current : baseIndex

    // Run both simulations synchronously (~200ms total)
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
