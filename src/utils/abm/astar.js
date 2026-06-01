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
 * Map vulnerability score [0,1] to movement cost multiplier.
 * Higher vulnerability = more expensive to traverse (agent avoids high-risk zones).
 * Mirrors thermal_cost() from the reference ABM_Interactive.ipynb notebook.
 *
 * @param {number} score - vulnerability score [0, 1]
 * @returns {number} cost multiplier [0.5, 6.0]
 */
export function vulnerabilityCost(score) {
  if (score > 0.8) return 6.0
  if (score > 0.6) return 3.0
  if (score > 0.4) return 1.5
  if (score > 0.2) return 1.0
  return 0.5  // low vulnerability = safe/easy to traverse
}
