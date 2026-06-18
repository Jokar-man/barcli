// src/hooks/useMultiABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { MESA_API_URL } from '../constants'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { buildSpatialIndex, sampleVulnerability } from '../utils/abm/vulnerabilitySampler'

const MESA_MULTI_URL = `${MESA_API_URL}/simulate/multi`

// ── JS-fallback constants (mirror mesa_multi.py) ─────────────────────────────

const NUM_AGENTS       = 20
const MAX_STEPS        = 200
const SNAPSHOT_EVERY   = 5
const SPAWN_RADIUS_M   = 600
const SPAWN_MIN_M      = 150

const PERSONAS_JS = [
  { id: 'old',    stressThreshold: 2.0, heatTrigger: 0.30 },
  { id: 'middle', stressThreshold: 4.0, heatTrigger: 0.45 },
  { id: 'young',  stressThreshold: 6.0, heatTrigger: 0.55 },
  { id: 'kids',   stressThreshold: 2.5, heatTrigger: 0.35 },
]
const GENDER_PATTERNS = [
  ['F','M','F','M','F'],
  ['M','F','M','F','M'],
  ['F','M','F','M','F'],
  ['M','F','M','F','M'],
]
const AGENT_ROSTER = PERSONAS_JS.flatMap((p, pi) =>
  GENDER_PATTERNS[pi].map(gender => ({ persona: p.id, gender }))
)

function distSq([lng1, lat1], [lng2, lat2]) {
  const dx = (lng1 - lng2) * 111320 * Math.cos(lat1 * Math.PI / 180)
  const dy = (lat1 - lat2) * 110540
  return dx * dx + dy * dy
}

function runSimulationJS(startNodeIds, shelterNodeId, nodes, edges, spatialIndex) {
  const vulnCache = new Map()
  const getVuln = id => {
    if (!vulnCache.has(id)) {
      const [lng, lat] = nodes.get(id)
      vulnCache.set(id, sampleVulnerability(lng, lat, spatialIndex))
    }
    return vulnCache.get(id)
  }
  const shelterCoord = nodes.get(shelterNodeId)
  const agents = startNodeIds.map((nodeId, i) => {
    const roster  = AGENT_ROSTER[i]
    const persona = PERSONAS_JS.find(p => p.id === roster.persona)
    return {
      id: i, nodeId, seeking: false,
      arrived: nodeId === shelterNodeId,
      visited: new Set([nodeId]),
      stressAccum: 0.0,
      persona: persona.id, gender: roster.gender,
      stressThreshold: persona.stressThreshold,
      heatTrigger: persona.heatTrigger,
    }
  })
  const toCoord = id => { const [lng, lat] = nodes.get(id); return { lng, lat } }
  const snapshots = [agents.map(a => ({ id: a.id, ...toCoord(a.nodeId), arrived: a.arrived, persona: a.persona, gender: a.gender }))]

  for (let step = 0; step < MAX_STEPS; step++) {
    for (const agent of agents) {
      if (agent.arrived) continue
      const v = getVuln(agent.nodeId)
      if (v > agent.heatTrigger) agent.stressAccum += (v - agent.heatTrigger) * 2
      if (!agent.seeking && agent.stressAccum >= agent.stressThreshold) agent.seeking = true
      const neighbours = (edges.get(agent.nodeId) || []).map(e => e.to)
      if (!neighbours.length) continue
      let nextNode
      if (agent.seeking) {
        const unvisited = neighbours.filter(id => !agent.visited.has(id))
        const pool = unvisited.length ? unvisited : neighbours
        nextNode = pool.reduce((best, id) =>
          distSq(nodes.get(id), shelterCoord) < distSq(nodes.get(best), shelterCoord) ? id : best)
        if (nextNode === shelterNodeId || agent.nodeId === shelterNodeId) {
          agent.arrived = true; agent.nodeId = shelterNodeId; continue
        }
      } else {
        const unvisited = neighbours.filter(id => !agent.visited.has(id))
        const pool = unvisited.length ? unvisited : neighbours
        nextNode = pool[Math.floor(Math.random() * pool.length)]
      }
      agent.visited.add(nextNode)
      agent.nodeId = nextNode
    }
    if ((step + 1) % SNAPSHOT_EVERY === 0 || step === MAX_STEPS - 1) {
      snapshots.push(agents.map(a => ({ id: a.id, ...toCoord(a.nodeId), arrived: a.arrived, persona: a.persona, gender: a.gender })))
    }
  }

  const breakdown = Object.fromEntries(PERSONAS_JS.map(p => [
    p.id,
    { total: agents.filter(a => a.persona === p.id).length,
      arrived: agents.filter(a => a.persona === p.id && a.arrived).length }
  ]))

  return { arrivedCount: agents.filter(a => a.arrived).length, snapshots, breakdown }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export default function useMultiABM({ isActive, points, stats, activeFields, impactFeatures }) {
  const [shelters,             setShelters]             = useState([])
  const [selectedShelter,      setSelectedShelter]      = useState(null)
  const [multiSimState,        setMultiSimState]        = useState('idle')
  const [baselineCount,        setBaselineCount]        = useState(0)
  const [policyCount,          setPolicyCount]          = useState(0)
  const [baselineSnapshots,    setBaselineSnapshots]    = useState([])
  const [policySnapshots,      setPolicySnapshots]      = useState([])
  const [baselineBreakdown,    setBaselineBreakdown]    = useState(null)
  const [policyBreakdown,      setPolicyBreakdown]      = useState(null)

  const graphRef       = useRef(null)
  const indexBaseRef   = useRef([])
  const indexPolicyRef = useRef([])

  const totalAgents = NUM_AGENTS

  useEffect(() => {
    if (!isActive || graphRef.current) return
    fetch('/data/climate_isochrone.geojson')
      .then(r => r.json())
      .then(geo => { graphRef.current = buildRoadGraph(geo) })
      .catch(e => console.warn('[MultiABM] Could not load road graph for JS fallback:', e))
  }, [isActive])

  useEffect(() => {
    if (!isActive || shelters.length) return
    fetch('/data/climate_shelters.geojson')
      .then(r => r.json())
      .then(geo => setShelters(geo.features || []))
      .catch(e => console.error('[MultiABM] Failed to load shelters:', e))
  }, [isActive, shelters.length])

  useEffect(() => {
    if (!points || !activeFields.length) return
    indexBaseRef.current = buildSpatialIndex(points, stats, activeFields)
  }, [points, stats, activeFields])

  useEffect(() => {
    if (!impactFeatures?.features) return
    indexPolicyRef.current = impactFeatures.features.map(f => ({
      lng:   f.geometry.coordinates[0],
      lat:   f.geometry.coordinates[1],
      score: f.properties._value || 0
    }))
  }, [impactFeatures])

  useEffect(() => {
    if (!isActive) {
      setSelectedShelter(null)
      setMultiSimState('idle')
      setBaselineCount(0)
      setPolicyCount(0)
      setBaselineSnapshots([])
      setPolicySnapshots([])
      setBaselineBreakdown(null)
      setPolicyBreakdown(null)
    } else {
      setMultiSimState('selecting')
    }
  }, [isActive])

  const onShelterSelected = useCallback(async (shelterFeature) => {
    setSelectedShelter(shelterFeature)
    setMultiSimState('running')

    const shelterCoord = shelterFeature.geometry.coordinates

    // ── 1. Try Mesa backend ──────────────────────────────────────────────────
    try {
      const body = {
        shelter_coord:   shelterCoord,
        baseline_index:  indexBaseRef.current.length   ? indexBaseRef.current   : null,
        policy_index:    indexPolicyRef.current.length ? indexPolicyRef.current : null,
      }

      const res = await fetch(MESA_MULTI_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(30000),  // 30s — Mesa sim takes longer than A*
      })

      if (!res.ok) throw new Error(`Mesa API ${res.status}`)
      const data = await res.json()

      setBaselineCount(data.baseline_count)
      setPolicyCount(data.policy_count)
      setBaselineSnapshots(data.baseline_snapshots)
      setPolicySnapshots(data.policy_snapshots)
      setBaselineBreakdown(data.baseline_breakdown || null)
      setPolicyBreakdown(data.policy_breakdown     || null)
      setMultiSimState('done')
      return

    } catch (err) {
      console.warn('[MultiABM] Mesa API unavailable, falling back to JS:', err.message)
    }

    // ── 2. JS fallback ───────────────────────────────────────────────────────
    if (!graphRef.current) {
      console.warn('[MultiABM] Graph not ready for JS fallback')
      setMultiSimState('selecting')
      return
    }

    const { nodes, edges } = graphRef.current
    const [slng, slat] = shelterCoord
    const shelterNodeId = snapToGraph(shelterCoord, nodes)
    if (!shelterNodeId) { setMultiSimState('selecting'); return }

    const RADIUS_SQ = SPAWN_RADIUS_M * SPAWN_RADIUS_M
    const MIN_SQ    = SPAWN_MIN_M    * SPAWN_MIN_M
    const candidates = []
    for (const [id, coord] of nodes) {
      if (id === shelterNodeId) continue
      const d = distSq(coord, [slng, slat])
      if (d >= MIN_SQ && d <= RADIUS_SQ) candidates.push(id)
    }
    if (candidates.length < NUM_AGENTS) { setMultiSimState('selecting'); return }

    const shuffled = [...candidates]
    let seed = (shelterFeature.geometry.coordinates[0] * 1000) | 0
    const lcg = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xFFFFFFFF }
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(lcg() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const startPositions = shuffled.slice(0, NUM_AGENTS)

    const baseIndex   = indexBaseRef.current
    const policyIndex = indexPolicyRef.current.length ? indexPolicyRef.current : baseIndex

    const baseResult   = runSimulationJS(startPositions, shelterNodeId, nodes, edges, baseIndex)
    const policyResult = runSimulationJS(startPositions, shelterNodeId, nodes, edges, policyIndex)

    setBaselineCount(baseResult.arrivedCount)
    setPolicyCount(policyResult.arrivedCount)
    setBaselineSnapshots(baseResult.snapshots)
    setPolicySnapshots(policyResult.snapshots)
    setBaselineBreakdown(baseResult.breakdown)
    setPolicyBreakdown(policyResult.breakdown)
    setMultiSimState('done')
  }, [])

  const reset = useCallback(() => {
    setSelectedShelter(null)
    setMultiSimState('selecting')
    setBaselineCount(0)
    setPolicyCount(0)
    setBaselineSnapshots([])
    setPolicySnapshots([])
    setBaselineBreakdown(null)
    setPolicyBreakdown(null)
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
    baselineBreakdown,
    policyBreakdown,
    onShelterSelected,
    reset
  }
}
