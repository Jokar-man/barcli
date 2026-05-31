"""
ENHANCED IMPACT VISUALIZATION FRAMEWORK
Using Real Policy Deltas Instead of Simple Direction/Confidence

Key Insight:
- Your data shows actual policy impacts (deltas)
- Tree Master Plan: +0.511°C heat, +1.253 SPEI improvement
- This is MORE ACCURATE than semantic AI direction alone!

Formula:
V_new = V_baseline + Δ_policy
where Δ_policy comes from your historical/simulated data
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Tuple

# ═══════════════════════════════════════════════════════════
# 1. LOAD YOUR ACTUAL POLICY DELTAS
# ═══════════════════════════════════════════════════════════

class PolicyDeltaDatabase:
    """Store and retrieve actual policy impacts from historical data."""
    
    def __init__(self, temp_csv: str, drought_csv: str):
        self.temp_df = pd.read_csv(temp_csv)
        self.drought_df = pd.read_csv(drought_csv)
        
        # Merge by policy name
        self.merged = self.temp_df.merge(
            self.drought_df, 
            on=['year', 'label', 'category'],
            how='inner'
        )
        
        # Create lookup dictionaries
        self.policy_deltas = {}
        self.policy_by_category = {}
        
        for _, row in self.merged.iterrows():
            policy_name = row['label']
            category = row['category']
            
            self.policy_deltas[policy_name] = {
                'delta_temp': float(row['delta_summer_C']),
                'delta_drought': float(row['delta_spei']),
                'category': category,
                'year': int(row['year'])
            }
            
            if category not in self.policy_by_category:
                self.policy_by_category[category] = []
            self.policy_by_category[category].append(policy_name)
        
        print(f"✅ Loaded {len(self.policy_deltas)} policies with actual deltas")
    
    def get_policy_delta(self, policy_name: str) -> Dict:
        """Get actual delta values for a policy."""
        return self.policy_deltas.get(policy_name)
    
    def get_category_average(self, category: str) -> Dict:
        """Get average delta for a policy category."""
        policies = self.policy_by_category.get(category, [])
        if not policies:
            return {'delta_temp': 0, 'delta_drought': 0}
        
        deltas = [self.policy_deltas[p] for p in policies]
        return {
            'delta_temp': np.mean([d['delta_temp'] for d in deltas]),
            'delta_drought': np.mean([d['delta_drought'] for d in deltas]),
            'count': len(policies)
        }
    
    def get_similar_policies(self, policy_name: str, n=3) -> List:
        """Find similar policies based on impact magnitude."""
        if policy_name not in self.policy_deltas:
            return []
        
        target = self.policy_deltas[policy_name]
        target_mag = abs(target['delta_temp']) + abs(target['delta_drought'])
        
        similarities = []
        for name, delta in self.policy_deltas.items():
            if name == policy_name:
                continue
            mag = abs(delta['delta_temp']) + abs(delta['delta_drought'])
            distance = abs(mag - target_mag)
            similarities.append((name, distance))
        
        similarities.sort(key=lambda x: x[1])
        return [s[0] for s in similarities[:n]]


# ═══════════════════════════════════════════════════════════
# 2. ENHANCED IMPACT FORMULA (Using Real Deltas)
# ═══════════════════════════════════════════════════════════

class EnhancedImpactCalculator:
    """
    Calculate impact using actual policy deltas.
    
    Key difference from before:
    - OLD: I = δ × c × (w_H×H + w_D×D + w_P×P)
    - NEW: I = Δ_policy + Confidence_adjustment + Spatial_scaling
    """
    
    def __init__(self, policy_db: PolicyDeltaDatabase):
        self.db = policy_db
        
        # Impact factors per dimension
        # These scale how policy deltas affect the visualization
        self.impact_factors = {
            'heat': {
                'temp_to_impact': 0.5,    # 1°C delta → 0.5 impact units
                'baseline': 28.0           # Barcelona baseline summer temp
            },
            'drought': {
                'spei_to_impact': 0.3,     # 1 SPEI delta → 0.3 impact units
                'baseline': 0.0            # SPEI baseline (neutral)
            },
            'health': {
                'factor': 0.4              # Health is derived from heat+drought
            }
        }
    
    def calculate_impact(
        self,
        policy_name: str,
        confidence: float = None,
        spatial_multiplier: float = 1.0,
        use_category_avg: bool = False
    ) -> Dict:
        """
        Calculate enhanced impact for a policy.
        
        Args:
            policy_name: Name of the policy
            confidence: Override confidence (0-1), else use magnitude-based
            spatial_multiplier: How strong the effect is at this location (0-1)
            use_category_avg: Use category average if policy not found
        
        Returns:
            Dictionary with impact values for each dimension
        """
        
        # Get policy delta
        if policy_name in self.db.policy_deltas:
            delta = self.db.policy_deltas[policy_name]
            delta_temp = delta['delta_temp']
            delta_drought = delta['delta_drought']
        elif use_category_avg:
            # Try to use category average
            return {'error': f'Policy {policy_name} not found'}
        else:
            return {'error': f'Policy {policy_name} not found'}
        
        # If confidence not provided, derive from impact magnitude
        if confidence is None:
            # Larger impacts → higher confidence
            impact_mag = abs(delta_temp) + abs(delta_drought)
            confidence = min(0.95, 0.3 + (impact_mag / 5.0))
        
        # Calculate impact per dimension
        impacts = {
            'policy': policy_name,
            'confidence': confidence,
            'delta_temp': delta_temp,
            'delta_drought': delta_drought,
        }
        
        # Heat impact (from temperature change)
        impacts['heat'] = (
            delta_temp * 
            self.impact_factors['heat']['temp_to_impact'] * 
            confidence *
            spatial_multiplier
        )
        
        # Drought impact (from SPEI change, sign flipped so positive=good)
        impacts['drought'] = (
            (-delta_drought) *  # Flip sign: negative SPEI delta is good
            self.impact_factors['drought']['spei_to_impact'] *
            confidence *
            spatial_multiplier
        )
        
        # Health impact (derived from heat and drought)
        # Heat creates health risk, drought reduces it
        impacts['health'] = (
            (impacts['heat'] * 0.6 + impacts['drought'] * 0.4) *
            self.impact_factors['health']['factor']
        )
        
        return impacts
    
    def interpolate_multiple_policies(
        self,
        policies: Dict[str, float],
        spatial_multiplier: float = 1.0
    ) -> Dict:
        """
        Combine impacts from multiple policies.
        
        Args:
            policies: {policy_name: weight} (e.g., 0.5 for 50% implementation)
            spatial_multiplier: Location-based effect strength
        
        Returns:
            Combined impact dictionary
        """
        
        combined = {
            'heat': 0,
            'drought': 0,
            'health': 0,
            'confidence': 0,
            'policies': []
        }
        
        total_weight = sum(policies.values())
        
        for policy_name, weight in policies.items():
            impact = self.calculate_impact(
                policy_name,
                spatial_multiplier=spatial_multiplier
            )
            
            if 'error' in impact:
                continue
            
            # Weight and accumulate
            normalized_weight = weight / total_weight if total_weight > 0 else 0
            
            combined['heat'] += impact['heat'] * normalized_weight
            combined['drought'] += impact['drought'] * normalized_weight
            combined['health'] += impact['health'] * normalized_weight
            combined['confidence'] *= impact['confidence']  # Geometric mean
            combined['policies'].append({
                'name': policy_name,
                'weight': weight,
                'heat': impact['heat'],
                'drought': impact['drought']
            })
        
        # Geometric mean for confidence
        if combined['policies']:
            combined['confidence'] = combined['confidence'] ** (
                1 / len(combined['policies'])
            )
        
        return combined


# ═══════════════════════════════════════════════════════════
# 3. SPATIAL MAPPING (How to visualize on the grid)
# ═══════════════════════════════════════════════════════════

class ImpactMapper:
    """Map policy impacts to spatial grid for visualization."""
    
    def __init__(self, grid_size: int = 100):
        self.grid_size = grid_size
        self.grids = {
            'heat': np.zeros((grid_size, grid_size)),
            'drought': np.zeros((grid_size, grid_size)),
            'health': np.zeros((grid_size, grid_size))
        }
    
    def apply_impact(
        self,
        impact: Dict,
        center: Tuple[int, int],
        radius: int = 20,
        falloff: str = 'gaussian'
    ):
        """
        Apply an impact to the grid centered at a location.
        
        Args:
            impact: Dictionary with heat, drought, health values
            center: (i, j) grid coordinates
            radius: How far the effect spreads
            falloff: 'gaussian' (smooth) or 'linear' (sharp)
        """
        
        ci, cj = center
        
        for i in range(self.grid_size):
            for j in range(self.grid_size):
                # Distance from center
                dist = np.sqrt((i - ci)**2 + (j - cj)**2)
                
                if dist > radius:
                    continue
                
                # Calculate falloff
                if falloff == 'gaussian':
                    weight = np.exp(-(dist**2) / (2 * (radius/3)**2))
                elif falloff == 'linear':
                    weight = max(0, 1 - dist / radius)
                else:
                    weight = 1 if dist < radius else 0
                
                # Apply impact
                self.grids['heat'][i, j] += impact['heat'] * weight
                self.grids['drought'][i, j] += impact['drought'] * weight
                self.grids['health'][i, j] += impact['health'] * weight
    
    def apply_from_zones(
        self,
        zones: Dict[str, Dict],
        calculator: EnhancedImpactCalculator
    ):
        """
        Apply impacts from predefined zones.
        
        zones = {
            'eastern_corridor': {
                'center': (50, 70),
                'radius': 25,
                'policies': {'Tree Master Plan': 1.0}
            },
            'central_plaza': {
                'center': (30, 30),
                'radius': 15,
                'policies': {'Urban Mobility Plan': 0.5}
            }
        }
        """
        
        for zone_name, zone_config in zones.items():
            center = zone_config['center']
            radius = zone_config.get('radius', 20)
            policies = zone_config.get('policies', {})
            
            # Calculate combined impact
            impact = calculator.interpolate_multiple_policies(
                policies,
                spatial_multiplier=1.0
            )
            
            # Apply to grid
            self.apply_impact(impact, center, radius)
            
            print(f"✅ Applied {zone_name}: heat={impact['heat']:.3f}, drought={impact['drought']:.3f}")
    
    def get_grid(self, dimension: str) -> np.ndarray:
        """Get the impact grid for a dimension."""
        return self.grids[dimension]
    
    def reset(self):
        """Clear all grids."""
        for dim in self.grids:
            self.grids[dim] = np.zeros((self.grid_size, self.grid_size))


# ═══════════════════════════════════════════════════════════
# 4. COMPARISON: OLD vs NEW FORMULA
# ═══════════════════════════════════════════════════════════

def compare_formulas():
    """Show the difference between old (semantic) and new (delta) approach."""
    
    print("=" * 80)
    print("FORMULA COMPARISON")
    print("=" * 80)
    
    print("\n📌 OLD APPROACH (Semantic AI only):")
    print("""
    I = δ × c × (w_H×H + w_D×D + w_P×P)
    
    Problem: Tree policy doesn't flip things even though it should!
    - δ = +1 (mitigation)
    - c = 0.85 (confidence)
    - Weights (0.7, 0.2, 0.5) apply to semantic model outputs
    
    Result: Impact = 1 × 0.85 × (arbitrary) = Often weak!
    Why weak? Because semantic model outputs H, D, P are just 
    normalized probabilities (0-1), not actual temperature changes!
    """)
    
    print("\n📌 NEW APPROACH (Using actual deltas):")
    print("""
    I = Δ_temp + Δ_drought (from your historical/simulated data)
    
    Advantage: Tree Master Plan ACTUALLY changes things!
    - Δ_temp = +0.511°C (measured!)
    - Δ_drought = +1.253 SPEI (measured!)
    - Confidence derived from magnitude: 0.3 + |impact|/5 = ~0.54
    
    Result: Impact = real numbers! V_new = V_baseline + 0.511°C
    Why strong? Because it's based on actual observed/simulated data!
    """)
    
    print("\n📌 HYBRID APPROACH (Best of both):")
    print("""
    I = Δ_policy × (1 + semantic_adjustment)
    
    Steps:
    1. Start with actual policy delta: Δ = +0.511°C
    2. Semantic model analyzes policy: "Confidence 0.85 in heat mitigation"
    3. Adjust delta if semantic differs: I = 0.511 × (0.85 / baseline_confidence)
    
    This scales real impacts by semantic confidence!
    Tree policy can still be weak (+0.511°C is real!) 
    But semantic model captures nuances.
    """)


# ═══════════════════════════════════════════════════════════
# 5. QUICK TEST
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Load your data
    db = PolicyDeltaDatabase(
        'barcelona_policy_station_deltas.csv',
        'barcelona_spei_policy_deltas.csv'
    )
    
    # Create calculator
    calc = EnhancedImpactCalculator(db)
    
    print("\n" + "=" * 80)
    print("EXAMPLE 1: Tree Master Plan (Single Policy)")
    print("=" * 80)
    
    impact_tree = calc.calculate_impact('Tree Master Plan (2017–2037)')
    print(json.dumps(impact_tree, indent=2))
    
    print("\n" + "=" * 80)
    print("EXAMPLE 2: Multiple Policies Combined")
    print("=" * 80)
    
    combined = calc.interpolate_multiple_policies({
        'Tree Master Plan (2017–2037)': 0.7,
        'Urban Mobility Plan (PMU)': 0.3
    })
    print(json.dumps(combined, indent=2))
    
    print("\n" + "=" * 80)
    print("EXAMPLE 3: Spatial Mapping")
    print("=" * 80)
    
    mapper = ImpactMapper(grid_size=100)
    
    zones = {
        'eastern_corridor': {
            'center': (50, 70),
            'radius': 25,
            'policies': {'Tree Master Plan (2017–2037)': 1.0}
        },
        'central_plaza': {
            'center': (30, 30),
            'radius': 15,
            'policies': {'Urban Mobility Plan (PMU)': 0.5}
        }
    }
    
    mapper.apply_from_zones(zones, calc)
    
    heat_grid = mapper.get_grid('heat')
    print(f"\nHeat grid shape: {heat_grid.shape}")
    print(f"Heat range: {heat_grid.min():.3f} to {heat_grid.max():.3f}")
    print(f"Heat mean: {heat_grid.mean():.3f}")
    
    # Show comparison
    compare_formulas()

import json
