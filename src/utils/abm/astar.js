// src/utils/abm/astar.js

/**
 * A* pathfinding on a road graph.
 *
 * @param {string}   startId    - node id (from roadGraph)
 * @param {string}   goalId     - node id (from roadGraph)
 * @param {Map}      nodes      - id → [lng, lat]
 * @param {Map}      edges      - id → [{to, dist}]
 * @param {Function} costFn     - (nodeId) → vulnerability multiplier [0.5 .. 6.0]
 * @returns {string[]}          - ordered array of node ids, empty if no path found
 */
export function astar(startId, goalId, nodes, edges, costFn) {
  if (!nodes.has(startId) || !nodes.has(goalId)) return []

  const goalCoord = nodes.get(goalId)

  // Euclidean heuristic in metres (admissible — never overestimates)
  function heuristic(id) {
    const [lng, lat] = nodes.get(id)
    const [glng, glat] = goalCoord
    const dx = (lng - glng) * 111320 * Math.cos(lat * Math.PI / 180)
    const dy = (lat - glat) * 110540
    return Math.sqrt(dx * dx + dy * dy)
  }

  const gScore   = new Map([[startId, 0]])
  const cameFrom = new Map()
  // Simple sorted-array open set — sufficient for graphs up to ~20k nodes
  const open     = [{ id: startId, f: heuristic(startId) }]
  const closed   = new Set()

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f)
    const { id: current } = open.shift()

    if (current === goalId) {
      const path = []
      let node = current
      while (node !== undefined) {
        path.unshift(node)
        node = cameFrom.get(node)
      }
      return path
    }

    closed.add(current)

    for (const { to, dist } of (edges.get(current) || [])) {
      if (closed.has(to)) continue
      const tentativeG = (gScore.get(current) ?? Infinity) + dist * costFn(to)
      const prevG      = gScore.get(to) ?? Infinity
      if (tentativeG < prevG) {
        cameFrom.set(to, current)
        gScore.set(to, tentativeG)
        const f = tentativeG + heuristic(to)
        const existing = open.find(o => o.id === to)
        if (existing) {
          existing.f = f
        } else {
          open.push({ id: to, f })
        }
      }
    }
  }

  return []  // no path found
}

/**
 * Amplified vulnerability-to-cost mapping passed to each A* agent during
 * planning. The 200:1 ratio between safe (0.5) and extreme (100) zones
 * forces A* to route clearly around high-risk areas; after a policy reduces
 * vulnerability, previously expensive nodes become affordable, producing a
 * visibly different path.
 *
 * Thresholds mirror the user's Mesa ABM thermal_cost() but scaled for a
 * 0–1 normalised vulnerability score instead of raw UTCI °C.
 *
 * @param {number} score - normalised vulnerability [0, 1]
 * @returns {number} cost multiplier used by A* edge weighting
 */
// Balanced cost: max 2.5× so the agent won't detour more than 2.5× the direct
// distance to avoid a hot zone. The previous 8× caused visually absurd paths.
// At 2.5× a 30m edge through an extreme zone costs 75m equivalent — the agent
// reroutes only when a meaningful shorter alternative exists nearby.
export function ampCost(score) {
  if (score >= 0.8) return 2.5   // extreme  — clear avoidance but no huge detours
  if (score >= 0.7) return 2.0   // high
  if (score >= 0.6) return 1.5   // moderate
  if (score >= 0.4) return 1.1   // near-neutral
  if (score >= 0.2) return 1.0
  return 0.85                     // cool corridor — slightly preferred
}

