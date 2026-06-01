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
    if (!edges.get(idA).some(e => e.to === idB) && !edges.get(idB).some(e => e.to === idA)) {
      edges.get(idA).push({ to: idB, dist })
      edges.get(idB).push({ to: idA, dist })
    }
  }

  const features = isochroneGeoJSON.features || []

  features.forEach(feature => {
    const geom = feature.geometry
    if (!geom) return

    // Handle both LineString and MultiLineString
    const lines = geom.type === 'MultiLineString'
      ? (geom.coordinates || []).filter(c => c && c.length >= 2).map(coords => turf.lineString(coords))
      : geom.type === 'LineString'
        ? (geom.coordinates && geom.coordinates.length >= 2 ? [feature] : [])
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
 * Linear scan — O(N) over nodes. Acceptable for single calls; not suitable for per-frame use.
 * Returns the node id string, or null if the graph is empty.
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
