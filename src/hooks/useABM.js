// src/hooks/useABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { MESA_API_URL } from '../constants'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { astar, ampCost } from '../utils/abm/astar'
import { buildSpatialIndex, sampleVulnerability, profileAlongPath } from '../utils/abm/vulnerabilitySampler'

/**
 * ABM state machine:
 *   'idle'          - ABM not active
 *   'placing-start' - waiting for map click: start point
 *   'placing-end'   - waiting for map click: destination
 *   'running'       - computing paths
 *   'done'          - paths available, chart visible
 *
 * Tries the Mesa Python backend first (/simulate/single).
 * Falls back to the local JS A* implementation if the API is unavailable.
 */

const MESA_SINGLE_URL = `${MESA_API_URL}/simulate/single`
const CLIMATE_WEIGHT  = 0.5   // passed to Mesa; 0 = pure distance, 1 = pure climate

export default function useABM({ isActive, points, stats, activeFields, impactFeatures }) {
  const [abmState, setAbmState]         = useState('idle')
  const [startCoord, setStartCoord]     = useState(null)
  const [endCoord, setEndCoord]         = useState(null)
  const [baselineProfile, setBaseline]  = useState(null)
  const [policyProfile, setPolicy]      = useState(null)
  const [baselinePath, setBaselinePath] = useState(null)
  const [policyPath, setPolicyPath]     = useState(null)

  const graphRef        = useRef(null)
  const indexBaseRef    = useRef([])
  const indexPolicyRef  = useRef([])
  const activeFieldsRef = useRef(activeFields)
  const computedRef     = useRef(false)

  useEffect(() => { activeFieldsRef.current = activeFields }, [activeFields])

  // Load road graph when ABM activates (JS fallback only — Mesa loads its own)
  useEffect(() => {
    if (!isActive || graphRef.current) return
    fetch('/data/climate_isochrone.geojson')
      .then(r => r.json())
      .then(geojson => { graphRef.current = buildRoadGraph(geojson) })
      .catch(e => console.warn('[ABM] Could not load road graph for JS fallback:', e))
  }, [isActive])

  // Rebuild baseline spatial index
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

  // Activate / deactivate
  useEffect(() => {
    if (!isActive) {
      computedRef.current = false
      setAbmState('idle')
      setStartCoord(null)
      setEndCoord(null)
      setBaseline(null)
      setPolicy(null)
      setBaselinePath(null)
      setPolicyPath(null)
    } else {
      computedRef.current = false
      setAbmState('placing-start')
    }
  }, [isActive])

  const handleMapClick = useCallback((lngLat) => {
    if (abmState === 'placing-start') {
      setStartCoord([lngLat.lng, lngLat.lat])
      setAbmState('placing-end')
    } else if (abmState === 'placing-end') {
      setEndCoord([lngLat.lng, lngLat.lat])
      setAbmState('running')
    }
  }, [abmState])

  // ── Run simulation when state → 'running' ──────────────────────────────────

  useEffect(() => {
    if (abmState !== 'running') return
    if (computedRef.current) return
    computedRef.current = true
    if (!startCoord || !endCoord) return

    runSimulation(startCoord, endCoord)
  }, [abmState, startCoord, endCoord])

  async function runSimulation(start, end) {
    // ── 1. Try Mesa backend ──────────────────────────────────────────────────
    try {
      const body = {
        start,
        end,
        climate_weight: CLIMATE_WEIGHT,
        baseline_index: indexBaseRef.current.length  ? indexBaseRef.current  : null,
        policy_index:   indexPolicyRef.current.length ? indexPolicyRef.current : null,
      }

      const res = await fetch(MESA_SINGLE_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(60000),  // 60s — HF Space cold start can be 30-60s
      })

      if (!res.ok) throw new Error(`Mesa API ${res.status}`)
      const data = await res.json()

      if (!data.baseline_path?.length) throw new Error('Mesa returned empty path')

      setBaselinePath(data.baseline_path)
      setPolicyPath(data.policy_path || data.baseline_path)
      setBaseline(data.baseline_profile || [])
      setPolicy(data.policy_profile   || data.baseline_profile || [])
      setAbmState('done')
      return

    } catch (err) {
      console.warn('[ABM] Mesa API unavailable, falling back to JS A*:', err.message)
    }

    // ── 2. JS fallback ───────────────────────────────────────────────────────
    if (!graphRef.current) {
      console.warn('[ABM] Road graph not ready for JS fallback')
      setAbmState('placing-start')
      computedRef.current = false
      return
    }

    const { nodes, edges } = graphRef.current
    const startId = snapToGraph(start, nodes)
    const goalId  = snapToGraph(end,   nodes)

    if (!startId || !goalId) {
      console.warn('[ABM] Could not snap coords to graph')
      setAbmState('placing-start')
      computedRef.current = false
      return
    }

    const baseIndex   = indexBaseRef.current
    const policyIndex = indexPolicyRef.current.length ? indexPolicyRef.current : baseIndex

    const baseCostFn = id => {
      const [lng, lat] = nodes.get(id)
      return ampCost(sampleVulnerability(lng, lat, baseIndex))
    }
    const policyCostFn = id => {
      const [lng, lat] = nodes.get(id)
      return ampCost(sampleVulnerability(lng, lat, policyIndex))
    }

    const basePath         = astar(startId, goalId, nodes, edges, baseCostFn)
    const policyPathResult = astar(startId, goalId, nodes, edges, policyCostFn)

    if (!basePath.length) {
      console.warn('[ABM] JS A* found no path')
      setAbmState('placing-start')
      computedRef.current = false
      return
    }

    const toCoords = path => path.map(id => nodes.get(id))
    setBaselinePath(toCoords(basePath))
    setPolicyPath(toCoords(policyPathResult.length ? policyPathResult : basePath))
    setBaseline(profileAlongPath(basePath,                                          nodes, baseIndex))
    setPolicy(profileAlongPath(policyPathResult.length ? policyPathResult : basePath, nodes, policyIndex))
    setAbmState('done')
  }

  const reset = useCallback(() => {
    computedRef.current = false
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
