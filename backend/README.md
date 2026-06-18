---
title: Barcli Mesa API
emoji: 🌡️
colorFrom: blue
colorTo: red
sdk: docker
pinned: false
short_description: Mesa ABM simulation API for Barcelona climate vulnerability
---

# Barcli Mesa API

FastAPI backend providing Mesa-based agent simulation for the [Barcli](https://barcli.vercel.app) frontend.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/health` | Liveness check |
| `POST` | `/simulate/single` | Single-agent A\* pathfinding with climate weighting |
| `POST` | `/simulate/multi` | 20-agent shelter-seeking with 4 personas |

## POST /simulate/single

```json
{
  "start": [-2.1734, 41.3851],
  "end":   [-2.1700, 41.3900],
  "climate_weight": 0.5,
  "baseline_index": null,
  "policy_index":   null
}
```

Returns `baseline_path`, `policy_path` (arrays of `[lng, lat]`) and `baseline_profile`, `policy_profile` (vulnerability scores 0–1 per node).

## POST /simulate/multi

```json
{
  "shelter_coord": [-2.1720, 41.3870],
  "baseline_index": null,
  "policy_index":   null,
  "seed": 42
}
```

Returns per-frame `baseline_snapshots`/`policy_snapshots` and `persona_breakdown` with arrived counts per persona.

## Data files required

Place these in the `data/` directory (same files as the frontend's `public/data/`):

- `data/climate_isochrone.geojson` — road network (LineString features)
- `data/data.geojson` — climate vulnerability points (heat, SPEI, urban_health fields)
- `data/climate_shelters.geojson` — shelter locations (Point features)

## Files

```
├── app.py            FastAPI app + graph loading + routes
├── mesa_single.py    Mesa single-agent A* model
├── mesa_multi.py     Mesa multi-agent shelter model
├── requirements.txt
├── Dockerfile
└── data/
    ├── climate_isochrone.geojson
    ├── data.geojson
    └── climate_shelters.geojson
```
