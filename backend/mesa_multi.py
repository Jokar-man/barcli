"""
Multi-agent Mesa shelter-seeking model with 4 personas × 2 genders.
20 agents total (5 per persona, 10F + 10M).

Each agent random-walks until cumulative heat stress crosses the
persona-specific threshold, then greedily seeks the nearest shelter.

Uses explicit per-step loops instead of mesa.time schedulers so the
code works with any Mesa 2.x version.
"""

import math
import mesa


# ── Personas ──────────────────────────────────────────────────────────────────

PERSONAS = [
    {"id": "old",    "label": "Elderly",     "stress_threshold": 2.0, "heat_trigger": 0.30},
    {"id": "middle", "label": "Middle-aged", "stress_threshold": 4.0, "heat_trigger": 0.45},
    {"id": "young",  "label": "Young Adult", "stress_threshold": 6.0, "heat_trigger": 0.55},
    {"id": "kids",   "label": "Kids",        "stress_threshold": 2.5, "heat_trigger": 0.35},
]

_GENDER_PATTERNS = [
    ["F", "M", "F", "M", "F"],   # old    → 3F 2M
    ["M", "F", "M", "F", "M"],   # middle → 2F 3M
    ["F", "M", "F", "M", "F"],   # young  → 3F 2M
    ["M", "F", "M", "F", "M"],   # kids   → 2F 3M
]

AGENT_ROSTER = [
    {"persona": p["id"], "gender": g}
    for pi, p in enumerate(PERSONAS)
    for g in _GENDER_PATTERNS[pi]
]  # exactly 20 entries


# ── Spatial grid for O(1) nearest-neighbour lookup ───────────────────────────

_CELL_DEG = 0.003

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


def dist_sq(coord_a, coord_b) -> float:
    lng1, lat1 = coord_a
    lng2, lat2 = coord_b
    dx = (lng1 - lng2) * 111320 * math.cos(math.radians(lat1))
    dy = (lat1 - lat2) * 110540
    return dx * dx + dy * dy


# ── Mesa agent ────────────────────────────────────────────────────────────────

class ShelterSeekingAgent(mesa.Agent):
    """Accumulates stress while exposed to heat; switches to greedy shelter-seeking once threshold crossed."""

    def __init__(self, model, start_node: str, persona: dict, gender: str):
        super().__init__(model)
        self.current_node  = start_node
        self.persona       = persona
        self.gender        = gender
        self.stress_accum  = 0.0
        self.seeking       = False
        self.arrived       = (start_node == model.shelter_node)
        self.visited       = {start_node}

    def step(self):
        if self.arrived:
            return

        vuln    = self.model.get_vuln(self.current_node)
        trigger = self.persona["heat_trigger"]
        if vuln > trigger:
            self.stress_accum += (vuln - trigger) * 2.0

        if not self.seeking and self.stress_accum >= self.persona["stress_threshold"]:
            self.seeking = True

        neighbours = [e["to"] for e in self.model.edges.get(self.current_node, [])]
        if not neighbours:
            return

        if self.seeking:
            shelter_coord = self.model.nodes[self.model.shelter_node]
            unvisited = [n for n in neighbours if n not in self.visited]
            pool = unvisited if unvisited else neighbours
            next_node = min(pool, key=lambda n: dist_sq(self.model.nodes[n], shelter_coord))
            if next_node == self.model.shelter_node or self.current_node == self.model.shelter_node:
                self.arrived      = True
                self.current_node = self.model.shelter_node
                return
        else:
            unvisited = [n for n in neighbours if n not in self.visited]
            pool      = unvisited if unvisited else neighbours
            next_node = self.model.random.choice(pool)

        self.visited.add(next_node)
        self.current_node = next_node


# ── Mesa model ────────────────────────────────────────────────────────────────

class MultiAgentModel(mesa.Model):
    MAX_STEPS      = 200
    SNAPSHOT_EVERY = 5

    def __init__(
        self,
        nodes: dict,
        edges: dict,
        shelter_node: str,
        start_positions: list,
        vuln_index: list,
        seed: int = 42,
    ):
        super().__init__(seed=seed)
        self.nodes        = nodes
        self.edges        = edges
        self.shelter_node = shelter_node
        self.vuln_index   = vuln_index
        self._vuln_cache: dict = {}
        self._vuln_grid = _build_grid(vuln_index)   # O(M) once; lookups are O(1)

        # Create all 20 agents (mesa.Model tracks them in self.agents automatically)
        self._agent_list = []
        for i, (start_node, entry) in enumerate(zip(start_positions, AGENT_ROSTER)):
            persona = next(p for p in PERSONAS if p["id"] == entry["persona"])
            agent   = ShelterSeekingAgent(self, start_node, persona, entry["gender"])
            self._agent_list.append(agent)

        self._snapshots = [self._snapshot()]

    def get_vuln(self, node_id: str) -> float:
        if node_id not in self._vuln_cache:
            lng, lat = self.nodes[node_id]
            self._vuln_cache[node_id] = _sample_grid(lng, lat, self._vuln_grid)
        return self._vuln_cache[node_id]

    def _snapshot(self) -> list:
        return [
            {
                "id":      a.unique_id,
                "lng":     self.nodes[a.current_node][0],
                "lat":     self.nodes[a.current_node][1],
                "arrived": a.arrived,
                "persona": a.persona["id"],
                "gender":  a.gender,
            }
            for a in self._agent_list
        ]

    def step(self):
        """Simultaneous activation — all agents read state from t, write to t+1."""
        for agent in self._agent_list:
            agent.step()

    def run(self) -> dict:
        for s in range(self.MAX_STEPS):
            self.step()
            if (s + 1) % self.SNAPSHOT_EVERY == 0 or s == self.MAX_STEPS - 1:
                self._snapshots.append(self._snapshot())

        arrived = [a for a in self._agent_list if a.arrived]

        breakdown = {}
        for p in PERSONAS:
            pid   = p["id"]
            group = [a for a in self._agent_list if a.persona["id"] == pid]
            breakdown[pid] = {
                "label":   p["label"],
                "total":   len(group),
                "arrived": sum(1 for a in group if a.arrived),
            }

        return {
            "arrived_count":     len(arrived),
            "snapshots":         self._snapshots,
            "persona_breakdown": breakdown,
        }
