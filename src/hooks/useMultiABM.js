// src/hooks/useMultiABM.js — stub, full implementation in Task 3
export default function useMultiABM() {
  return {
    shelters: [], selectedShelter: null, multiSimState: 'idle',
    baselineCount: 0, policyCount: 0, totalAgents: 0,
    baselineSnapshots: [], policySnapshots: [],
    onShelterSelected: () => {}, reset: () => {}
  }
}
