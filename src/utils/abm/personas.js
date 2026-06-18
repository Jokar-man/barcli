// Persona definitions for the multi-agent simulation.
// Each persona has different heat sensitivity and stress thresholds.
export const PERSONAS = [
  {
    id:              'old',
    label:           'Elderly',
    ageRange:        '60+',
    emoji:           '👴',
    color:           '#ff6633',
    stressThreshold: 2.0,   // triggers very quickly — low heat tolerance
    heatTrigger:     0.30,  // sensitive to moderate vulnerability
    sensitivity:     'Very High',
  },
  {
    id:              'middle',
    label:           'Middle-aged',
    ageRange:        '36–60',
    emoji:           '🧑',
    color:           '#00eaff',
    stressThreshold: 4.0,
    heatTrigger:     0.45,
    sensitivity:     'Medium',
  },
  {
    id:              'young',
    label:           'Young Adult',
    ageRange:        '13–35',
    emoji:           '🏃',
    color:           '#00ff88',
    stressThreshold: 6.0,   // most heat-resilient
    heatTrigger:     0.55,
    sensitivity:     'Low',
  },
  {
    id:              'kids',
    label:           'Kids',
    ageRange:        '0–12',
    emoji:           '🧒',
    color:           '#FFD700',
    stressThreshold: 2.5,   // vulnerable and unpredictable
    heatTrigger:     0.35,
    sensitivity:     'High',
  },
]

// 20 agents: 5 per persona, alternating gender per group → 10 F + 10 M total
// Group 0 (old):    F M F M F  → 3F 2M
// Group 1 (middle): M F M F M  → 2F 3M
// Group 2 (young):  F M F M F  → 3F 2M
// Group 3 (kids):   M F M F M  → 2F 3M
export const AGENT_ROSTER = PERSONAS.flatMap((p, pi) => {
  const pattern = pi % 2 === 0
    ? ['F', 'M', 'F', 'M', 'F']
    : ['M', 'F', 'M', 'F', 'M']
  return pattern.map(gender => ({ persona: p.id, gender }))
})
// Total: 20 entries — exactly NUM_AGENTS
