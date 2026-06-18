import { useState, useCallback, useEffect } from 'react'
import useMapbox from './hooks/useMapbox'
import useABM from './hooks/useABM'
import useMultiABM from './hooks/useMultiABM'
import LeftPanel from './components/LeftPanel'
import ChatPanel from './components/ChatPanel'
import CompareDivider from './components/CompareDivider'
import Legend from './components/Legend'
import InfoModal from './components/InfoModal'
import { MESA_API_URL } from './constants'

// Ping the Mesa HF Space on load so the container is warm before the user runs a simulation.
// HF free-tier Spaces sleep after ~15 min; this gives them ~60s to wake up in the background.
function useMesaWarmup() {
  useEffect(() => {
    fetch(`${MESA_API_URL}/health`, { signal: AbortSignal.timeout(60000) })
      .catch(() => {})  // silence errors — warmup is best-effort
  }, [])
}

export default function App() {
  useMesaWarmup()

  const [activeFields,     setActiveFields]     = useState([])
  const [impactData,       setImpactData]       = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showModal,        setShowModal]        = useState(false)
  const [agenticMode,   setAgenticMode]   = useState('none') // 'none'|'single'|'multi'
  const abmActive = agenticMode === 'single'
  // Populated by useMapbox callbacks — declared here so useABM can read them
  const [loadedPoints,  setLoadedPoints]  = useState(null)
  const [loadedStats,   setLoadedStats]   = useState({})
  const [impactFC,      setImpactFC]      = useState(null)

  // useABM is called first; it starts with null data and re-runs when
  // useMapbox delivers real points/stats/impactFC via the setters above.
  const {
    abmState,
    startCoord,
    endCoord,
    baselineProfile,
    policyProfile,
    baselinePath,
    policyPath,
    handleMapClick,
    reset: resetABM
  } = useABM({
    isActive:       abmActive,
    points:         loadedPoints,
    stats:          loadedStats,
    activeFields,
    impactFeatures: impactFC
  })

  const {
    shelters,
    selectedShelter,
    multiSimState,
    baselineCount,
    policyCount,
    totalAgents,
    baselineSnapshots,
    policySnapshots,
    onShelterSelected,
    reset: resetMultiABM
  } = useMultiABM({
    isActive:       agenticMode === 'multi',
    points:         loadedPoints,
    stats:          loadedStats,
    activeFields,
    impactFeatures: impactFC
  })

  const {
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef,
    updateAgentPositions,
    updateMultiAgentPositions,
    is3D,
    toggle3D
  } = useMapbox({
    activeFields,
    impactData,
    selectedCategory,
    abmMode:          abmState,
    abmCallbacks:     { handleMapClick, startCoord, endCoord, baselinePath, policyPath },
    onPointsLoaded:   (pts, stats) => { setLoadedPoints(pts); setLoadedStats(stats) },
    onImpactComputed: setImpactFC,
    multiAbmActive:       agenticMode === 'multi',
    shelterData:          shelters,
    selectedShelterCoord: selectedShelter?.geometry?.coordinates || null,
    onShelterSelected,
  })

  // Show/hide compare whenever impactData or activeFields changes
  useEffect(() => {
    if (impactData && activeFields.length > 0) showCompare()
    else if (!impactData || activeFields.length === 0) hideCompare()
  }, [impactData, activeFields, showCompare, hideCompare])

  // Show compare split when ABM finishes computing paths
  useEffect(() => {
    if (abmState === 'done' && activeFields.length > 0) showCompare()
  }, [abmState, activeFields, showCompare])

  const handleToggleField = useCallback((field) => {
    setActiveFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    )
  }, [])

  const handleImpactData = useCallback((aiResult, category) => {
    setImpactData(aiResult)
    setSelectedCategory(category)
  }, [])

  const handleReset = useCallback(() => {
    setActiveFields([])
    setImpactData(null)
    setSelectedCategory('')
    setAgenticMode('none')
    resetABM()
    resetMultiABM()
    hideCompare()
  }, [resetABM, resetMultiABM, hideCompare])

  const handleDrag = useCallback((clientX) => {
    return updateDivider(clientX)
  }, [updateDivider])

  return (
    <>
      <div id="map"        ref={mapContainerRef} />
      <div id="map-impact" ref={mapImpactRef}    />
      <CompareDivider
        isVisible={isCompareVisible}
        onDrag={handleDrag}
        dividerXRef={dividerXRef}
      />
      <LeftPanel
        activeFields={activeFields}
        onToggleField={handleToggleField}
        agenticMode={agenticMode}
        onSetAgenticMode={setAgenticMode}
        onReset={handleReset}
        is3D={is3D}
        onToggle3D={toggle3D}
      />
      <Legend onInfoClick={() => setShowModal(true)} />
      <InfoModal isOpen={showModal} onClose={() => setShowModal(false)} />
      <ChatPanel
        onImpactData={handleImpactData}
        abmResult={{ baselineProfile, policyProfile, abmState }}
        abmPaths={{ baselinePath, policyPath }}
        updateAgentPositions={updateAgentPositions}
        onResetABM={resetABM}
        agenticMode={agenticMode}
        multiAbmResult={{ multiSimState, baselineCount, policyCount, totalAgents, selectedShelter }}
        multiSnapshots={{ baselineSnapshots, policySnapshots }}
        updateMultiAgentPositions={updateMultiAgentPositions}
        onResetMultiABM={resetMultiABM}
      />
    </>
  )
}
