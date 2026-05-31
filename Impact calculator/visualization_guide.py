"""
FRONTEND VISUALIZATION GUIDE
How to display policy impacts on the 3D map

Strategy:
1. Load policy deltas from CSV
2. Create impact grids (heat, drought, health)
3. Blend with baseline temperature
4. Visualize as heat overlay
5. Allow interactive policy selection
"""

# ═══════════════════════════════════════════════════════════
# BACKEND ENDPOINT: Enhanced CFD with Policy Deltas
# ═══════════════════════════════════════════════════════════

# Add this to your FastAPI backend (main.py):

from fastapi import FastAPI
import pandas as pd
import numpy as np
from enhanced_impact_formula import PolicyDeltaDatabase, EnhancedImpactCalculator, ImpactMapper

# Initialize at startup
policy_db = PolicyDeltaDatabase(
    'barcelona_policy_station_deltas.csv',
    'barcelona_spei_policy_deltas.csv'
)
impact_calc = EnhancedImpactCalculator(policy_db)

@app.post("/api/impact/calculate")
async def calculate_policy_impact(request: PolicyImpactRequest):
    """
    Calculate impact from real policy deltas.
    
    Request:
    {
        "policy_name": "Tree Master Plan (2017–2037)",
        "zones": [
            {
                "name": "eastern_corridor",
                "center": [50, 70],
                "radius": 25
            }
        ]
    }
    
    Response:
    {
        "heat_grid": [...],
        "drought_grid": [...],
        "health_grid": [...],
        "impact_stats": {...}
    }
    """
    
    mapper = ImpactMapper(grid_size=100)
    
    # Build zones for the policy
    zones = {}
    for zone in request.zones:
        zones[zone['name']] = {
            'center': tuple(zone['center']),
            'radius': zone.get('radius', 20),
            'policies': {request.policy_name: 1.0}
        }
    
    # Apply impacts
    mapper.apply_from_zones(zones, impact_calc)
    
    # Get grids
    heat = mapper.get_grid('heat')
    drought = mapper.get_grid('drought')
    health = mapper.get_grid('health')
    
    return {
        "policy": request.policy_name,
        "heat_grid": heat.tolist(),
        "drought_grid": drought.tolist(),
        "health_grid": health.tolist(),
        "statistics": {
            "heat_mean": float(heat.mean()),
            "heat_max": float(heat.max()),
            "drought_mean": float(drought.mean()),
            "drought_max": float(drought.max()),
            "health_mean": float(health.mean())
        }
    }


@app.get("/api/policies/available")
async def get_available_policies():
    """Get list of all available policies with their deltas."""
    
    policies = []
    for policy_name, delta in policy_db.policy_deltas.items():
        policies.append({
            "name": policy_name,
            "category": delta['category'],
            "year": delta['year'],
            "delta_temp": delta['delta_temp'],
            "delta_drought": delta['delta_drought'],
            "impact_magnitude": abs(delta['delta_temp']) + abs(delta['delta_drought'])
        })
    
    # Sort by impact magnitude
    policies.sort(key=lambda x: x['impact_magnitude'], reverse=True)
    
    return {"policies": policies}


@app.post("/api/impact/compare")
async def compare_policies(request: PolicyComparisonRequest):
    """
    Compare impacts of two policies side-by-side.
    
    Request:
    {
        "policy_a": "Tree Master Plan (2017–2037)",
        "policy_b": "Urban Mobility Plan (PMU)",
        "zones": [{...}]
    }
    """
    
    results = {}
    
    for policy_name, policy_key in [
        (request.policy_a, 'policy_a'),
        (request.policy_b, 'policy_b')
    ]:
        mapper = ImpactMapper(grid_size=100)
        
        zones = {}
        for zone in request.zones:
            zones[zone['name']] = {
                'center': tuple(zone['center']),
                'radius': zone.get('radius', 20),
                'policies': {policy_name: 1.0}
            }
        
        mapper.apply_from_zones(zones, impact_calc)
        
        results[policy_key] = {
            "heat_grid": mapper.get_grid('heat').tolist(),
            "drought_grid": mapper.get_grid('drought').tolist(),
            "health_grid": mapper.get_grid('health').tolist()
        }
    
    return results


# ═══════════════════════════════════════════════════════════
# FRONTEND: React Component for Policy Selection
# ═══════════════════════════════════════════════════════════

# File: frontend/src/components/PolicySelector.jsx

"""
import React, { useState, useEffect } from 'react'
import axios from 'axios'

export default function PolicySelector({ onPolicySelect, onCompare }) {
  const [policies, setPolicies] = useState([])
  const [selectedPolicies, setSelectedPolicies] = useState([])
  const [activeTab, setActiveTab] = useState('heat')  // 'heat', 'drought', 'health'
  const [loading, setLoading] = useState(true)
  
  useEffect(() => {
    // Load available policies
    axios.get('http://localhost:8000/api/policies/available')
      .then(res => setPolicies(res.data.policies))
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [])
  
  const handlePolicySelect = (policy) => {
    // Calculate and visualize impact
    const zones = [
      {
        name: 'primary_impact_zone',
        center: [50, 50],  // Promenade center
        radius: 30
      }
    ]
    
    axios.post('http://localhost:8000/api/impact/calculate', {
      policy_name: policy.name,
      zones
    })
    .then(res => {
      onPolicySelect(res.data)
      setSelectedPolicies([...selectedPolicies, policy])
    })
  }
  
  const handleCompare = () => {
    if (selectedPolicies.length < 2) {
      alert('Select at least 2 policies to compare')
      return
    }
    
    axios.post('http://localhost:8000/api/impact/compare', {
      policy_a: selectedPolicies[0].name,
      policy_b: selectedPolicies[1].name,
      zones: [{
        name: 'comparison_zone',
        center: [50, 50],
        radius: 30
      }]
    })
    .then(res => onCompare(res.data))
  }
  
  return (
    <div className="space-y-4 p-4 bg-gray-800 rounded-lg">
      <h3 className="text-lg font-semibold">Policies (Impact-Based)</h3>
      
      {loading ? (
        <div>Loading policies...</div>
      ) : (
        <>
          {/* Tab selector */}
          <div className="flex gap-2">
            {['heat', 'drought', 'health'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1 rounded ${
                  activeTab === tab
                    ? 'bg-blue-600'
                    : 'bg-gray-700 hover:bg-gray-600'
                }`}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </div>
          
          {/* Policy list sorted by impact magnitude */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {policies.map(policy => (
              <div
                key={policy.name}
                onClick={() => handlePolicySelect(policy)}
                className="p-3 bg-gray-700 hover:bg-gray-600 rounded cursor-pointer transition"
              >
                <div className="font-medium">{policy.name}</div>
                <div className="text-sm text-gray-300">
                  Category: {policy.category}
                </div>
                
                {/* Impact bars */}
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs">Heat:</span>
                    <div className="flex-1 h-2 bg-gray-600 rounded overflow-hidden">
                      <div
                        className={`h-full ${
                          policy.delta_temp > 0 ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.abs(policy.delta_temp) * 30)}%`
                        }}
                      />
                    </div>
                    <span className="w-12 text-xs text-right">
                      {policy.delta_temp:+.2f}°C
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <span className="w-16 text-xs">Drought:</span>
                    <div className="flex-1 h-2 bg-gray-600 rounded overflow-hidden">
                      <div
                        className={`h-full ${
                          policy.delta_drought > 0 ? 'bg-green-500' : 'bg-orange-500'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.abs(policy.delta_drought) * 20)}%`
                        }}
                      />
                    </div>
                    <span className="w-12 text-xs text-right">
                      {policy.delta_drought:+.2f}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {/* Compare button */}
          <button
            onClick={handleCompare}
            disabled={selectedPolicies.length < 2}
            className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded transition"
          >
            Compare Selected ({selectedPolicies.length})
          </button>
          
          {/* Selected policies */}
          {selectedPolicies.length > 0 && (
            <div className="p-2 bg-gray-700 rounded">
              <div className="text-sm font-semibold mb-2">Selected:</div>
              <div className="space-y-1">
                {selectedPolicies.map((p, i) => (
                  <div key={i} className="text-sm flex justify-between">
                    <span>{p.name}</span>
                    <button
                      onClick={() => setSelectedPolicies(selectedPolicies.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
"""


# ═══════════════════════════════════════════════════════════
# VISUALIZATION: Heat Overlay Update
# ═══════════════════════════════════════════════════════════

# File: frontend/src/components/EnhancedHeatOverlay.jsx

"""
import { useMemo } from 'react'
import * as THREE from 'three'

export default function EnhancedHeatOverlay({ 
  baselineTemperature,  // 100x100 grid from CFD
  policyImpact,         // 100x100 grid from policy deltas
  dimension = 'heat',   // 'heat', 'drought', 'health'
  opacity = 0.6
}) {
  
  const texture = useMemo(() => {
    if (!baselineTemperature || !policyImpact) return null
    
    const size = baselineTemperature.length
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    
    const imageData = ctx.createImageData(size, size)
    
    // Get appropriate grid
    const impactGrid = dimension === 'heat' 
      ? policyImpact.heat_grid 
      : dimension === 'drought' 
      ? policyImpact.drought_grid 
      : policyImpact.health_grid
    
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const baseline = baselineTemperature[i][j]  // 20-40°C
        const impact = impactGrid[i][j]             // -1 to +1
        
        // New temperature = baseline + impact
        const newValue = baseline + (impact * 5)    // Scale impact
        const normalized = (newValue - 20) / (40 - 20)
        
        // Color: cold (blue) to hot (red)
        const r = Math.floor(255 * normalized)
        const g = 0
        const b = Math.floor(255 * (1 - normalized))
        const a = 200
        
        const idx = (j * size + i) * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = a
      }
    }
    
    ctx.putImageData(imageData, 0, 0)
    
    const tex = new THREE.CanvasTexture(canvas)
    tex.needsUpdate = true
    return tex
  }, [baselineTemperature, policyImpact, dimension])
  
  if (!texture) return null
  
  return (
    <mesh position={[0, 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[500, 500]} />
      <meshBasicMaterial 
        map={texture}
        transparent
        opacity={opacity}
      />
    </mesh>
  )
}
"""


# ═══════════════════════════════════════════════════════════
# KEY DIFFERENCES FROM OLD APPROACH
# ═══════════════════════════════════════════════════════════

print("""
OLD APPROACH (Simple Direction + Confidence):
────────────────────────────────────────────
1. Semantic AI says: "Planting trees is Mitigation with 85% confidence"
2. Direction δ = +1, Confidence c = 0.85
3. Calculate: I = 1 × 0.85 × (semantic weights)
4. Problem: Semantic weights are 0-1 normalized values
5. Result: Impact is weak and abstract

NEW APPROACH (Real Policy Deltas):
──────────────────────────────────
1. Historical data says: "Tree Master Plan reduced temp by 0.511°C"
2. And improved drought by +1.253 SPEI
3. Use directly: Δ_temp = +0.511, Δ_drought = +1.253
4. Calculate: I = real temperature change!
5. Result: Impact is strong, concrete, measurable

WHY THIS IS BETTER:
───────────────────
✅ Grounded in real data (historical or simulated)
✅ Shows actual magnitude (not just direction)
✅ Explains why trees help but aren't magic
✅ Allows comparison between policies
✅ Can be visualized with real temperature units
✅ More scientifically defensible
""")
