"""
Barcli Mesa Simulation API
FastAPI app — deploy as a HuggingFace Space (SDK: docker or gradio).
Exposes:
  POST /simulate/single  — Mesa single-agent A* pathfinding
  POST /simulate/multi   — Mesa multi-agent shelter-seeking
  GET  /health           — liveness check
"""

import json
import math
import os
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mesa_single import SingleAgentModel
from mesa_multi  import MultiAgentModel, AGENT_ROSTER, PERSONAS

# ── App setup ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Preload graph and vulnerability index at startup so first request is fast
    _load_graph()
    _load_baseline_vuln()
    yield

app = FastAPI(title="Barcli Mesa Simulation API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # lock to your Vercel URL in production if preferred
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# ── Road-graph builder (pure Python, no external geo deps) ───────────────────

SAMPLE_INTERVAL_M = 30


def _node_id(lng: float, lat: float) -> str:
    return f"{lng:.6f},{lat:.6f}"


def _line_length(coords: list) -> float:
    total = 0.0
    for i in range(len(coords) - 1):
        dx = (coords[i+1][0] - coords[i][0]) * 111320 * math.cos(math.radians(coords[i][1]))
        dy = (coords[i+1][1] - coords[i][1]) * 110540
        total += math.sqrt(dx*dx + dy*dy)
    return total


def _sample_along(coords: list, total_len: float, steps: int) -> list:
    """Return `steps+1` evenly-spaced points interpolated along a polyline."""
    result, cum, seg = [], 0.0, 0
    for i in range(steps + 1):
        target = (i / steps) * total_len
        while seg < len(coords) - 2:
            dx = (coords[seg+1][0] - coords[seg][0]) * 111320 * math.cos(math.radians(coords[seg][1]))
            dy = (coords[seg+1][1] - coords[seg][1]) * 110540
            slen = math.sqrt(dx*dx + dy*dy)
            if cum + slen >= target:
                break
            cum += slen
            seg += 1
        c0, c1 = coords[seg], coords[min(seg+1, len(coords)-1)]
        dx = (c1[0] - c0[0]) * 111320 * math.cos(math.radians(c0[1]))
        dy = (c1[1] - c0[1]) * 110540
        slen = math.sqrt(dx*dx + dy*dy)
        t = (target - cum) / slen if slen > 0 else 0.0
        result.append([c0[0] + t*(c1[0]-c0[0]), c0[1] + t*(c1[1]-c0[1])])
    return result


@lru_cache(maxsize=1)
def _load_graph() -> tuple:
    """Build nodes/edges from climate_isochrone.geojson. Cached after first call."""
    path = os.path.join(DATA_DIR, "climate_isochrone.geojson")
    with open(path) as f:
        geo = json.load(f)

    nodes: dict = {}
    edges: dict = {}

    def ensure(coord):
        nid = _node_id(*coord)
        if nid not in nodes:
            nodes[nid] = coord
            edges[nid] = []
        return nid

    def add_edge(a, b, dist):
        if not any(e["to"] == b for e in edges[a]):
            edges[a].append({"to": b, "dist": dist})
            edges[b].append({"to": a, "dist": dist})

    for feat in geo.get("features", []):
        geom = feat.get("geometry", {})
        gtype = geom.get("type", "")
        raw   = geom.get("coordinates", [])
        lines = [raw] if gtype == "LineString" else (raw if gtype == "MultiLineString" else [])

        for line in lines:
            if len(line) < 2:
                continue
            total = _line_length(line)
            if total < 1:
                continue
            n = max(2, math.ceil(total / SAMPLE_INTERVAL_M))
            pts = _sample_along(line, total, n)
            for i in range(len(pts) - 1):
                a, b = ensure(pts[i]), ensure(pts[i+1])
                if a != b:
                    dx = (pts[i][0]-pts[i+1][0]) * 111320 * math.cos(math.radians(pts[i][1]))
                    dy = (pts[i][1]-pts[i+1][1]) * 110540
                    add_edge(a, b, math.sqrt(dx*dx + dy*dy))

    return nodes, edges


def _snap(lng: float, lat: float, nodes: dict) -> Optional[str]:
    best_id, best_d2 = None, math.inf
    cos_lat = math.cos(math.radians(lat))
    for nid, coord in nodes.items():
        dx = (coord[0] - lng) * 111320 * cos_lat
        dy = (coord[1] - lat) * 110540
        d2 = dx*dx + dy*dy
        if d2 < best_d2:
            best_d2, best_id = d2, nid
    return best_id


@lru_cache(maxsize=1)
def _load_baseline_vuln() -> tuple:
    """Compute baseline vulnerability index from data.geojson. Cached."""
    path = os.path.join(DATA_DIR, "data.geojson")
    with open(path) as f:
        geo = json.load(f)

    FIELDS = ["heat", "SPEI", "urban_health"]
    stats = {k: {"min": math.inf, "max": -math.inf} for k in FIELDS}
    for feat in geo["features"]:
        p = feat["properties"]
        for k in FIELDS:
            v = float(p.get(k) or 0)
            if v < stats[k]["min"]: stats[k]["min"] = v
            if v > stats[k]["max"]: stats[k]["max"] = v

    def norm(val, k):
        mn, mx = stats[k]["min"], stats[k]["max"]
        return (val - mn) / (mx - mn) if mx > mn else 0.0

    index = []
    for feat in geo["features"]:
        p   = feat["properties"]
        lng, lat = feat["geometry"]["coordinates"]
        score = sum(norm(float(p.get(k) or 0), k) for k in FIELDS) / len(FIELDS)
        index.append({"lng": lng, "lat": lat, "score": score})

    return tuple(index)   # tuple so lru_cache can hash it


# ── Pydantic models ───────────────────────────────────────────────────────────

class VulnPoint(BaseModel):
    lng: float
    lat: float
    score: float

class SingleRequest(BaseModel):
    start:          List[float]                  # [lng, lat]
    end:            List[float]                  # [lng, lat]
    baseline_index: Optional[List[VulnPoint]] = None
    policy_index:   Optional[List[VulnPoint]] = None
    climate_weight: float = 0.5

class MultiRequest(BaseModel):
    shelter_coord:  List[float]                  # [lng, lat]
    baseline_index: Optional[List[VulnPoint]] = None
    policy_index:   Optional[List[VulnPoint]] = None
    seed:           int = 42


# ── Helper: convert Pydantic list → plain dicts ───────────────────────────────

def _to_index(items: Optional[List[VulnPoint]], fallback) -> list:
    if items:
        return [{"lng": v.lng, "lat": v.lat, "score": v.score} for v in items]
    return list(fallback)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "service": "barcli-mesa"}


@app.post("/simulate/single")
def simulate_single(req: SingleRequest):
    nodes, edges = _load_graph()

    start_id = _snap(req.start[0], req.start[1], nodes)
    end_id   = _snap(req.end[0],   req.end[1],   nodes)
    if not start_id or not end_id:
        raise HTTPException(400, "Could not snap coordinates to road graph")

    fallback     = _load_baseline_vuln()
    base_index   = _to_index(req.baseline_index, fallback)
    policy_index = _to_index(req.policy_index,   base_index)

    base_model = SingleAgentModel(
        nodes, edges, start_id, end_id, base_index, req.climate_weight
    )
    if not base_model.path_coords:
        raise HTTPException(422, "No path found — try different start/end points")

    policy_model = SingleAgentModel(
        nodes, edges, start_id, end_id, policy_index, req.climate_weight
    )

    return {
        "baseline_path":    base_model.path_coords,
        "policy_path":      policy_model.path_coords,
        "baseline_profile": base_model.vuln_profile,
        "policy_profile":   policy_model.vuln_profile,
    }


SPAWN_RADIUS_M = 600
SPAWN_MIN_M    = 150

@app.post("/simulate/multi")
def simulate_multi(req: MultiRequest):
    nodes, edges = _load_graph()

    slng, slat = req.shelter_coord
    shelter_id = _snap(slng, slat, nodes)
    if not shelter_id:
        raise HTTPException(400, "Could not snap shelter to road graph")

    # Candidate spawn nodes within [SPAWN_MIN_M, SPAWN_RADIUS_M] of shelter
    r_sq   = SPAWN_RADIUS_M * SPAWN_RADIUS_M
    min_sq = SPAWN_MIN_M    * SPAWN_MIN_M
    cos_l  = math.cos(math.radians(slat))
    candidates = []
    for nid, coord in nodes.items():
        if nid == shelter_id:
            continue
        dx = (coord[0] - slng) * 111320 * cos_l
        dy = (coord[1] - slat) * 110540
        d2 = dx*dx + dy*dy
        if min_sq <= d2 <= r_sq:
            candidates.append(nid)

    if len(candidates) < 20:
        raise HTTPException(422, "Not enough road nodes near shelter — try a different one")

    # Deterministic Fisher-Yates seeded by shelter longitude (matches JS behaviour)
    shuffled = list(candidates)
    seed = int(slng * 1000) & 0xFFFFFFFF
    def lcg():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return seed / 0xFFFFFFFF
    for i in range(len(shuffled) - 1, 0, -1):
        j = int(lcg() * (i + 1))
        shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
    start_positions = shuffled[:20]

    fallback     = _load_baseline_vuln()
    base_index   = _to_index(req.baseline_index, fallback)
    policy_index = _to_index(req.policy_index,   base_index)

    base_model   = MultiAgentModel(nodes, edges, shelter_id, start_positions, base_index,   seed=req.seed)
    policy_model = MultiAgentModel(nodes, edges, shelter_id, start_positions, policy_index, seed=req.seed)

    base_res   = base_model.run()
    policy_res = policy_model.run()

    return {
        "baseline_count":     base_res["arrived_count"],
        "policy_count":       policy_res["arrived_count"],
        "baseline_snapshots": base_res["snapshots"],
        "policy_snapshots":   policy_res["snapshots"],
        "baseline_breakdown": base_res["persona_breakdown"],
        "policy_breakdown":   policy_res["persona_breakdown"],
        "total_agents":       20,
        "personas":           PERSONAS,
    }
