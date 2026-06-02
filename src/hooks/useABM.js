// src/hooks/useABM.js
import { useState, useEffect, useRef, useCallback } from 'react'
import { buildRoadGraph, snapToGraph } from '../utils/abm/roadGraph'
import { astar, ampCost } from '../utils/abm/astar'
import { buildSpatialIndex, sampleVulnerability, profileAlongPath } from '../utils/abm/vulnerabilitySampler'

/**
 * ABM state machine:
 *   'idle'          - ABM not active
 *   'placing-start' - waiting for map click: start point
 *   'placing-end'   - waiting for map click: destination
 *   'running'       - computing paths (synchronous, brief)
 *   'done'          - paths available, chart visible
 */

export default function useABM({ isActive, points, stats, activeFields, impactFeatures }) {
  const [abmState, setAbmState]         = useState('idle')
  const [startCoord, setStartCoord]     = useState(null)   // [lng, lat]
  const [endCoord, setEndCoord]         = useState(null)   // [lng, lat]
  const [baselineProfile, setBaseline]  = useState(null)   // number[]
  const [policyProfile, setPolicy]      = useState(null)   // number[]
  const [baselinePath, setBaselinePath] = useState(null)   // [[lng,lat], ...]
  const [policyPath, setPolicyPath]     = useState(null)   // [[lng,lat], ...]

  const graphRef        = useRef(null)   // { nodes, edges }
  const indexBaseRef    = useRef([])     // baseline spatial index
  const indexPolicyRef  = useRef([])     // policy spatial index
  const activeFieldsRef = useRef(activeFields)
  const computedRef     = useRef(false)  // prevent A* re-runs

  // Keep activeFieldsRef current
  useEffect(() => { activeFieldsRef.current = activeFields }, [activeFields])

  // Load road graph when ABM activates (once)
  useEffect(() => {
    if (!isActive || graphRef.current) return
    fetch('/data/climate_isochrone.geojson')
      .then(r => r.json())
      .then(geojson => {
        graphRef.current = buildRoadGraph(geojson)
        console.log('[ABM] Road graph:', graphRef.current.nodes.size, 'nodes')
      })
      .catch(e => console.error('[ABM] Failed to load isochrone:', e))
  }, [isActive])

  // Rebuild baseline index when points/stats/activeFields change
  useEffect(() => {
    if (!points || !activeFields.length) return
    indexBaseRef.current = buildSpatialIndex(points, stats, activeFields)
  }, [points, stats, activeFields])

  // Rebuild policy index when impact features change
  useEffect(() => {
    if (!impactFeatures?.features) return
    indexPolicyRef.current = impactFeatures.features.map(f => ({
      lng:   f.geometry.coordinates[0],
      lat:   f.geometry.coordinates[1],
      score: f.properties._value || 0
    }))
  }, [impactFeatures])

  // Activate / deactivate ABM mode
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

  // Handle map click — advances the state machine
  const handleMapClick = useCallback((lngLat) => {
    if (!graphRef.current) return  // graph still loading — ignore click
    if (abmState === 'placing-start') {
      setStartCoord([lngLat.lng, lngLat.lat])
      setAbmState('placing-end')
    } else if (abmState === 'placing-end') {
      setEndCoord([lngLat.lng, lngLat.lat])
      setAbmState('running')
    }
  }, [abmState])

  // Run A* when state transitions to 'running'
  useEffect(() => {
    if (abmState !== 'running') return
    if (computedRef.current) return  // already computed for this transition
    computedRef.current = true
    if (!startCoord || !endCoord) return
    if (!graphRef.current) {
      console.warn('[ABM] Graph not ready')
      setAbmState('placing-start')
      return
    }

    const { nodes, edges } = graphRef.current
    const startId = snapToGraph(startCoord, nodes)
    const goalId  = snapToGraph(endCoord, nodes)

    if (!startId || !goalId) {
      console.warn('[ABM] Could not snap coords to graph')
      setAbmState('placing-start')
      return
    }

    const baseIndex   = indexBaseRef.current
    // Policy index: uses post-policy V_new values when an AI analysis has been run,
    // falls back to baseline only when no impact data exists yet.
    const policyIndex = indexPolicyRef.current.length ? indexPolicyRef.current : baseIndex

    // Each agent gets its own sample function reading its raster state.
    // Before-agent: reads raw baseline vulnerability (original data.geojson).
    // After-agent:  reads post-policy V_new (impact formula output).
    // ampCost() converts the sampled score to an A* edge weight with strong
    // thresholds — nodes above 0.8 are 200× more expensive than safe nodes,
    // so the agents genuinely reroute around high-risk zones.
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
      console.warn('[ABM] A* found no path — try different start/end points')
      setAbmState('placing-start')
      return
    }

    const toCoords = path => path.map(id => nodes.get(id))

    setBaselinePath(toCoords(basePath))
    setPolicyPath(toCoords(policyPathResult.length ? policyPathResult : basePath))
    // profileAlongPath records the vulnerability experienced at each step — feeds the chart
    setBaseline(profileAlongPath(basePath, nodes, baseIndex))
    setPolicy(profileAlongPath(
      policyPathResult.length ? policyPathResult : basePath,
      nodes, policyIndex
    ))
    setAbmState('done')
  }, [abmState, startCoord, endCoord])

  // Reset to placing-start (called from UI)
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
