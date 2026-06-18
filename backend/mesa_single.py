"""
Single-agent Mesa pathfinding model.
Agent finds the route from start → end minimising a blend of
geographic distance and climate vulnerability cost.
"""

import heapq
import math
import mesa


def amp_cost(score: float) -> float:
    if score >= 0.8: return 2.5
    if score >= 0.7: return 2.0
    if score >= 0.6: return 1.5
    if score >= 0.4: return 1.1
    if score >= 0.2: return 1.0
    return 0.85


# ── Spatial grid for O(1) nearest-neighbour vulnerability lookup ──────────────
# Without this, sample_vuln is O(N) per node — for a long A* path exploring
# thousands of nodes × thousands of vuln points = millions of Python ops → timeout.

_CELL_DEG = 0.003   # ~330m per cell; 3×3 search radius covers ~1km

def _build_grid(vuln_index: list) -> dict:
    grid = {}
    for p in vuln_index:
        cx = int(p["lng"] / _CELL_DEG)
        cy = int(p["lat"] / _CELL_DEG)
        grid.setdefault((cx, cy), []).append(p)
    return grid

def _sample_grid(lng: float, lat: float, grid: dict) -> float:
    cx = int(lng / _CELL_DEG)
    cy = int(lat / _CELL_DEG)
    cos_lat = math.cos(math.radians(lat))
    best_d2, best_score = math.inf, 0.0
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            for p in grid.get((cx + dx, cy + dy), []):
                ddx = (p["lng"] - lng) * 111320 * cos_lat
                ddy = (p["lat"] - lat) * 110540
                d2  = ddx * ddx + ddy * ddy
                if d2 < best_d2:
                    best_d2 = d2
                    best_score = p["score"]
    return best_score


# ── Mesa agent ────────────────────────────────────────────────────────────────

class PathfinderAgent(mesa.Agent):
    def __init__(self, model):
        super().__init__(model)
        self.current_node: str = model.start_id
        self.arrived: bool = False
        self._remaining: list = []

    def step(self):
        if self.arrived or not self._remaining:
            self.arrived = True
            return
        self.current_node = self._remaining.pop(0)
        if self.current_node == self.model.end_id:
            self.arrived = True


# ── Mesa model ────────────────────────────────────────────────────────────────

class SingleAgentModel(mesa.Model):
    """
    Computes a climate-weighted A* path at construction time.
    climate_weight=0 → pure shortest path
    climate_weight=1 → maximum climate avoidance
    """

    def __init__(
        self,
        nodes: dict,
        edges: dict,
        start_id: str,
        end_id: str,
        vuln_index: list,
        climate_weight: float = 0.5,
    ):
        super().__init__()
        self.nodes = nodes
        self.edges = edges
        self.start_id = start_id
        self.end_id = end_id
        self.climate_weight = climate_weight
        self._vuln_cache: dict = {}
        self._vuln_grid = _build_grid(vuln_index)   # O(M) once; lookups are O(1)

        self.agent = PathfinderAgent(self)
        path = self._astar(start_id, end_id)
        self.agent._remaining = list(path[1:])

        self.path_coords  = [nodes[nid] for nid in path]
        self.vuln_profile = [self._get_vuln(nid) for nid in path]

    def _get_vuln(self, node_id: str) -> float:
        if node_id not in self._vuln_cache:
            lng, lat = self.nodes[node_id]
            self._vuln_cache[node_id] = _sample_grid(lng, lat, self._vuln_grid)
        return self._vuln_cache[node_id]

    def _edge_cost(self, node_id: str, dist: float) -> float:
        v = self._get_vuln(node_id)
        return dist * (1.0 + self.climate_weight * (amp_cost(v) - 1.0))

    def _heuristic(self, a_id: str, b_id: str) -> float:
        alng, alat = self.nodes[a_id]
        blng, blat = self.nodes[b_id]
        dx = (alng - blng) * 111320 * math.cos(math.radians(alat))
        dy = (alat - blat) * 110540
        return math.sqrt(dx * dx + dy * dy)

    def _astar(self, start_id: str, goal_id: str) -> list:
        g_score   = {start_id: 0.0}
        came_from: dict = {}
        counter   = 0
        open_heap = [(self._heuristic(start_id, goal_id), counter, start_id)]
        closed: set = set()

        while open_heap:
            _, _, current = heapq.heappop(open_heap)
            if current == goal_id:
                path, node = [], current
                while node is not None:
                    path.append(node)
                    node = came_from.get(node)
                return list(reversed(path))

            if current in closed:
                continue
            closed.add(current)

            for edge in self.edges.get(current, []):
                nb = edge["to"]
                if nb in closed:
                    continue
                tg = g_score[current] + self._edge_cost(nb, edge["dist"])
                if tg < g_score.get(nb, math.inf):
                    came_from[nb] = current
                    g_score[nb]   = tg
                    counter += 1
                    heapq.heappush(open_heap, (tg + self._heuristic(nb, goal_id), counter, nb))

        return []

    def step(self):
        self.agent.step()
