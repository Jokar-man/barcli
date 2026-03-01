# 🎯 Scientific Analysis & Implementation Workflow
# Semantic AI Policy Impact on Spatial Vulnerability Raster

## 📊 SCIENTIFIC FEASIBILITY ANALYSIS

### ✅ STRENGTHS (Scientifically Sound)

1. **Risk Amplification Theory** ✓
   - Formula correctly assumes policies affect existing vulnerabilities
   - Aligns with IPCC AR6 risk framework: Risk = Hazard × Exposure × Vulnerability
   - Your formula: Impact = Direction × Confidence × (weighted vulnerabilities)

2. **Multi-Dimensional Vulnerability** ✓
   - Heat, Drought, Population captured
   - Weights from AI model outputs reflect actual policy focus
   - Example: Heat-focused policy → high w_H, low w_D

3. **Direction & Confidence Scaling** ✓
   - δ (direction) provides sign: mitigation reduces, aggravation increases
   - c (confidence) modulates magnitude: uncertain policies have less impact
   - Prevents overconfident predictions

4. **Local vs Citywide Blending** ✓
   - α parameter allows spatial specificity vs generalization
   - Realistic: citywide policies have local variations
   - α=0.6 for local, α=0.4 for citywide is reasonable

5. **Spatial Diffusion (Optional)** ✓✓✓
   - HIGHLY RECOMMENDED for urban systems
   - Captures spillover effects (e.g., cooling from parks affects neighbors)
   - Aligns with urban heat island literature

---

## ⚠️ SCIENTIFIC CONSIDERATIONS

### Potential Issues & Solutions:

#### 1. **Linear Additivity Assumption**
**Issue:** Formula assumes impacts add linearly
```
V_new = V_baseline + β * I_final
```

**Reality:** Vulnerabilities interact non-linearly
- Example: Extreme heat + drought → exponential health risk

**Solutions:**
a) **Multiplicative (for synergies):**
```python
V_new = V_baseline * (1 + β * I_final)
```

b) **Threshold-based:**
```python
if V_baseline > threshold:
    V_new = V_baseline + β * I_final * amplification_factor
else:
    V_new = V_baseline + β * I_final
```

c) **Keep linear for v1, add non-linear in v2**

---

#### 2. **Policy Strength Scaling (β)**
**Issue:** How to calibrate β?

**Solutions:**
- **Empirical calibration:** Use historical policy impacts
- **Expert judgment:** Urban planners estimate typical impact magnitude
- **Sensitivity analysis:** Show results for β ∈ [0.05, 0.2]
- **Recommended:** Start with β = 0.1 (10% max change)

---

#### 3. **Temporal Dynamics**
**Issue:** Policies take time to show effects

**Solutions:**
- Add temporal decay: `β(t) = β_max * (1 - e^(-λt))`
- Short-term vs long-term scenarios
- For v1: Assume steady-state (policy fully implemented)

---

#### 4. **Weight Normalization**
**Issue:** AI outputs (54.1%, 26.7%, 19.2%) should they sum to 1?

**Current:** They sum to 100% ✓
**Correct interpretation:**
```python
w_H = 0.541  # Heat weight
w_D = 0.192  # Drought weight  
w_P = 0.267  # Population weight
# Sum = 1.0 ✓
```

---

## 🏗️ IMPLEMENTATION WORKFLOW

### **Architecture Overview:**

```
User Input (Policy Text)
    ↓
[Semantic AI Model] → {direction, confidence, weights}
    ↓
[Formula Engine] → Calculates I_i for each cell
    ↓
[Spatial Processor] → Updates raster
    ↓
[Visualization] → Display on map
```

---

### **STEP 1: Add AI Model Endpoint**

**File:** `backend/api.py` (new file)

```python
import requests
import numpy as np

API_URL = "https://jokar-man-urban-climate-model.hf.space"

def analyze_policy(policy_text: str, neighborhood: str = None):
    """
    Query semantic AI model.
    Returns: direction, confidence, weights
    """
    response = requests.post(
        f"{API_URL}/analyze",
        json={
            "sentence": policy_text,
            "neighborhood": neighborhood,
            "year": 2024
        }
    )
    
    data = response.json()
    
    # Extract local-level results
    local = data['neighborhood_level']
    city = data['city_level']
    
    # Parse direction
    direction_local = 1 if local['direction'] == 'Aggravation' else -1
    direction_city = 1 if city['direction'] == 'Aggravation' else -1
    
    # Parse confidence
    conf_local = local['confidence']
    conf_city = city['confidence']
    
    # Parse weights (from macro_impact)
    impacts = local['macro_impact']
    w_H = impacts['Heat risk']
    w_D = impacts['Drought risk']
    w_P = impacts['Urban health']
    
    return {
        'local': {
            'direction': direction_local,
            'confidence': conf_local,
            'weights': {'heat': w_H, 'drought': w_D, 'population': w_P}
        },
        'city': {
            'direction': direction_city,
            'confidence': conf_city,
            'weights': {'heat': w_H, 'drought': w_D, 'population': w_P}
        },
        'neighborhood': data['analyzed_neighborhood']
    }
```

---

### **STEP 2: Formula Engine**

**File:** `backend/impact_calculator.py` (new file)

```python
import numpy as np
import geopandas as gpd
from scipy.ndimage import gaussian_filter

class PolicyImpactCalculator:
    """
    Calculates spatial impact of policy using vulnerability data.
    """
    
    def __init__(self, geojson_path: str, alpha: float = 0.6, beta: float = 0.1):
        """
        Args:
            geojson_path: Path to vulnerability GeoJSON
            alpha: Local vs citywide weight (0.6 = 60% local)
            beta: Policy strength scaling (0.1 = 10% max change)
        """
        self.gdf = gpd.read_file(geojson_path)
        self.alpha = alpha
        self.beta = beta
        
        # Normalize vulnerabilities to [0, 1]
        self._normalize_vulnerabilities()
    
    def _normalize_vulnerabilities(self):
        """Normalize H, D, P to [0, 1] range."""
        for col in ['heat_vuln', 'drought_vuln', 'pop_vuln']:
            if col in self.gdf.columns:
                min_val = self.gdf[col].min()
                max_val = self.gdf[col].max()
                self.gdf[f'{col}_norm'] = (self.gdf[col] - min_val) / (max_val - min_val)
    
    def calculate_impact(self, policy_output: dict, spatial_diffusion: bool = False):
        """
        Calculate policy impact on each spatial unit.
        
        Args:
            policy_output: Output from analyze_policy()
            spatial_diffusion: Apply spatial smoothing
            
        Returns:
            GeoDataFrame with impact scores
        """
        local = policy_output['local']
        city = policy_output['city']
        
        # Extract parameters
        δ_local = local['direction']
        δ_city = city['direction']
        c_local = local['confidence']
        c_city = city['confidence']
        w_H = local['weights']['heat']
        w_D = local['weights']['drought']
        w_P = local['weights']['population']
        
        # Calculate local impact for each spatial unit
        I_local = δ_local * c_local * (
            w_H * self.gdf['heat_vuln_norm'] +
            w_D * self.gdf['drought_vuln_norm'] +
            w_P * self.gdf['pop_vuln_norm']
        )
        
        # Calculate citywide impact
        I_city = δ_city * c_city * (
            w_H * self.gdf['heat_vuln_norm'] +
            w_D * self.gdf['drought_vuln_norm'] +
            w_P * self.gdf['pop_vuln_norm']
        )
        
        # Blend local and citywide
        I_final = self.alpha * I_local + (1 - self.alpha) * I_city
        
        # Apply spatial diffusion (optional)
        if spatial_diffusion:
            I_final = self._apply_spatial_diffusion(I_final)
        
        # Update vulnerability
        # Assuming you have a baseline composite vulnerability
        if 'baseline_vuln' not in self.gdf.columns:
            # Create composite baseline
            self.gdf['baseline_vuln'] = (
                self.gdf['heat_vuln_norm'] +
                self.gdf['drought_vuln_norm'] +
                self.gdf['pop_vuln_norm']
            ) / 3
        
        self.gdf['impact_score'] = I_final
        self.gdf['updated_vuln'] = self.gdf['baseline_vuln'] + self.beta * I_final
        
        # Clip to [0, 1] range
        self.gdf['updated_vuln'] = self.gdf['updated_vuln'].clip(0, 1)
        
        return self.gdf
    
    def _apply_spatial_diffusion(self, I_values: np.ndarray, gamma: float = 0.15):
        """
        Apply spatial smoothing using Gaussian filter.
        
        Args:
            I_values: Impact scores
            gamma: Diffusion strength (0.15 = 15% neighbor influence)
        
        Returns:
            Smoothed impact scores
        """
        # Convert to 2D grid (simplified - assumes regular grid)
        # In reality, you'd need proper spatial interpolation
        sigma = gamma * 10  # Adjust based on your spatial resolution
        smoothed = gaussian_filter(I_values, sigma=sigma)
        
        return smoothed
    
    def export_raster(self, output_path: str, resolution: float = 100):
        """
        Export updated vulnerability as GeoTIFF raster.
        
        Args:
            output_path: Output file path (.tif)
            resolution: Raster resolution in meters
        """
        from rasterio import features
        from rasterio.transform import from_bounds
        import rasterio
        
        # Get bounds
        bounds = self.gdf.total_bounds
        
        # Calculate raster dimensions
        width = int((bounds[2] - bounds[0]) / resolution)
        height = int((bounds[3] - bounds[1]) / resolution)
        
        # Create transform
        transform = from_bounds(*bounds, width, height)
        
        # Rasterize
        shapes = ((geom, value) for geom, value in 
                 zip(self.gdf.geometry, self.gdf['updated_vuln']))
        
        raster = features.rasterize(
            shapes,
            out_shape=(height, width),
            transform=transform,
            fill=0,
            dtype='float32'
        )
        
        # Write to file
        with rasterio.open(
            output_path,
            'w',
            driver='GTiff',
            height=height,
            width=width,
            count=1,
            dtype='float32',
            crs=self.gdf.crs,
            transform=transform
        ) as dst:
            dst.write(raster, 1)
        
        print(f"✅ Raster exported: {output_path}")
```

---

### **STEP 3: Frontend Integration**

**File:** `frontend/policy_simulator.js` (new file)

```javascript
class PolicySimulator {
    constructor(mapInstance) {
        this.map = mapInstance;
        this.baselineLayer = null;
        this.impactLayer = null;
    }
    
    async analyzePolicyImpact(policyText, neighborhood = null) {
        // 1. Query semantic AI
        const aiResponse = await fetch('/api/analyze_policy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                policy: policyText,
                neighborhood: neighborhood
            })
        });
        
        const aiResult = await aiResponse.json();
        
        // 2. Calculate spatial impact
        const impactResponse = await fetch('/api/calculate_impact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                policy_output: aiResult,
                spatial_diffusion: true
            })
        });
        
        const impactData = await impactResponse.json();
        
        // 3. Visualize on map
        this.visualizeImpact(impactData);
        
        return impactData;
    }
    
    visualizeImpact(geojson) {
        // Remove old layer
        if (this.impactLayer) {
            this.map.removeLayer(this.impactLayer);
        }
        
        // Add new layer with color scale
        this.impactLayer = L.geoJSON(geojson, {
            style: (feature) => {
                const vuln = feature.properties.updated_vuln;
                const impact = feature.properties.impact_score;
                
                return {
                    fillColor: this.getColor(vuln),
                    weight: 1,
                    opacity: 1,
                    color: impact > 0 ? 'red' : 'green',
                    fillOpacity: 0.7
                };
            },
            onEachFeature: (feature, layer) => {
                layer.bindPopup(`
                    <strong>Impact Score:</strong> ${feature.properties.impact_score.toFixed(3)}<br>
                    <strong>Baseline:</strong> ${feature.properties.baseline_vuln.toFixed(3)}<br>
                    <strong>Updated:</strong> ${feature.properties.updated_vuln.toFixed(3)}
                `);
            }
        }).addTo(this.map);
    }
    
    getColor(value) {
        // Color scale: green (low) → yellow → red (high)
        return value > 0.8 ? '#d73027' :
               value > 0.6 ? '#fc8d59' :
               value > 0.4 ? '#fee08b' :
               value > 0.2 ? '#d9ef8b' :
                             '#91cf60';
    }
}
```

---

### **STEP 4: Backend API Routes**

**File:** `backend/routes.py` (new file)

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from api import analyze_policy
from impact_calculator import PolicyImpactCalculator

app = FastAPI()

# Initialize calculator
calculator = PolicyImpactCalculator(
    geojson_path='data/vulnerability_points.geojson',
    alpha=0.6,
    beta=0.1
)

class PolicyRequest(BaseModel):
    policy: str
    neighborhood: str = None

class ImpactRequest(BaseModel):
    policy_output: dict
    spatial_diffusion: bool = False

@app.post("/api/analyze_policy")
async def api_analyze_policy(req: PolicyRequest):
    """Step 1: Analyze policy with semantic AI"""
    try:
        result = analyze_policy(req.policy, req.neighborhood)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/calculate_impact")
async def api_calculate_impact(req: ImpactRequest):
    """Step 2: Calculate spatial impact"""
    try:
        gdf = calculator.calculate_impact(
            req.policy_output,
            spatial_diffusion=req.spatial_diffusion
        )
        
        # Convert to GeoJSON
        geojson = gdf.to_json()
        
        return {
            "geojson": geojson,
            "statistics": {
                "mean_impact": float(gdf['impact_score'].mean()),
                "max_impact": float(gdf['impact_score'].max()),
                "min_impact": float(gdf['impact_score'].min()),
                "affected_units": len(gdf[abs(gdf['impact_score']) > 0.01])
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/export_raster")
async def api_export_raster():
    """Step 3: Export as GeoTIFF"""
    try:
        output_path = 'output/policy_impact.tif'
        calculator.export_raster(output_path, resolution=100)
        return {"raster_path": output_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

---

## 🎯 COMPLETE WORKFLOW

### User Journey:

```
1. User enters policy: "Installing green roofs in Gracia"
   ↓
2. Frontend calls /api/analyze_policy
   ↓
3. Backend queries Hugging Face API
   → Returns: direction=-1, confidence=0.95, w_H=0.65, w_D=0.20, w_P=0.15
   ↓
4. Frontend calls /api/calculate_impact
   ↓
5. Backend applies formula to each GeoJSON point
   → Calculates I_i for each point
   → Updates vulnerability: V_new = V_baseline - 0.1 * I_i
   ↓
6. Frontend displays updated map
   → Green cells = reduced vulnerability
   → Red cells = increased vulnerability
   ↓
7. (Optional) User exports GeoTIFF for GIS analysis
```

---

## 📈 SCIENTIFIC VALIDATION RECOMMENDATIONS

### To Make This Publishable:

1. **Calibration Study:**
   - Compare predictions with known historical policies
   - Validate β parameter against real data
   - Example: "When Barcelona added 10% tree coverage in 2015-2020, did heat vulnerability change by predicted amount?"

2. **Sensitivity Analysis:**
   - Vary α ∈ [0.3, 0.9]
   - Vary β ∈ [0.05, 0.2]
   - Show how results change

3. **Uncertainty Quantification:**
   - AI confidence already captured
   - Add spatial uncertainty (e.g., points far from policy location)
   - Monte Carlo simulation with parameter ranges

4. **Expert Validation:**
   - Show results to urban planners
   - Ask: "Does this match your intuition?"
   - Iterate based on feedback

5. **Comparison with Baseline:**
   - Create "do nothing" scenario
   - Show difference: Impact = V_policy - V_baseline

---

## 🚀 IMPLEMENTATION PRIORITY

### Phase 1 (MVP - 2 weeks):
- [ ] Create backend API routes
- [ ] Implement basic formula (no diffusion)
- [ ] Visualize on map
- [ ] Test with 5-10 sample policies

### Phase 2 (Enhanced - 1 month):
- [ ] Add spatial diffusion
- [ ] Implement α/β sliders for user control
- [ ] Export GeoTIFF functionality
- [ ] Create comparison tool (before/after)

### Phase 3 (Research - 2 months):
- [ ] Calibration with historical data
- [ ] Sensitivity analysis dashboard
- [ ] Uncertainty visualization
- [ ] Publication-ready outputs

---

## ✅ FINAL VERDICT

### Scientific Feasibility: **8.5/10** ✓✓✓

**Strengths:**
- Solid theoretical foundation
- Aligns with IPCC framework
- Reasonable assumptions
- Implementable with existing data

**Areas to Strengthen:**
- Calibrate β empirically
- Add temporal dynamics (future version)
- Validate against historical policies
- Document assumptions clearly

### Technical Feasibility: **9/10** ✓✓✓

**Strengths:**
- All tools available (Python, FastAPI, Leaflet)
- Semantic AI already working
- GeoJSON data ready
- Clear implementation path

**Challenges:**
- Rasterization requires careful CRS handling
- Spatial diffusion needs optimization for large datasets
- Frontend-backend coordination

---

## 📚 RECOMMENDED REFERENCES

1. IPCC AR6 WGII Chapter 16: "Key Risks Across Sectors and Regions"
2. Cutter et al. (2003): "Social Vulnerability to Environmental Hazards"
3. Depietri et al. (2013): "Heat waves and floods in European cities"
4. Schär et al. (2004): "The role of increasing temperature variability"

---

## 🎓 PUBLICATION POTENTIAL

This could become:
1. **Journal paper** (Urban Climate, Cities, Environment & Planning B)
2. **Tool paper** (Environmental Modelling & Software)
3. **Policy brief** for Barcelona City Council
4. **PhD chapter** if you're in a program

**Novelty:** Combining semantic NLP with spatial vulnerability modeling is relatively unexplored!

---

Would you like me to:
1. Create the full backend implementation code?
2. Design the frontend UI for policy simulation?
3. Write the sensitivity analysis framework?
4. Draft a research paper outline?
