import { useState, useCallback, useEffect } from 'react'
import useMapbox from './hooks/useMapbox'
import useABM from './hooks/useABM'
import LeftPanel from './components/LeftPanel'
import ChatPanel from './components/ChatPanel'
import CompareDivider from './components/CompareDivider'
import Legend from './components/Legend'
import InfoModal from './components/InfoModal'

export default function App() {
  const [activeFields,     setActiveFields]     = useState([])
  const [impactData,       setImpactData]       = useState(null)
  const [selectedCategory, setSelectedCategory] = useState('')
  const [showModal,        setShowModal]        = useState(false)
  const [abmActive,     setAbmActive]     = useState(false)
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
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef,
    updateAgentPositions
  } = useMapbox({
    activeFields,
    impactData,
    selectedCategory,
    abmMode:          abmState,
    abmCallbacks:     { handleMapClick, startCoord, endCoord, baselinePath, policyPath },
    onPointsLoaded:   (pts, stats) => { setLoadedPoints(pts); setLoadedStats(stats) },
    onImpactComputed: setImpactFC
  })

  // Show/hide compare whenever impactData or activeFields changes
  useEffect(() => {
    if (impactData && activeFields.length > 0) showCompare()
    else if (!impactData) hideCompare()
  }, [impactData, activeFields, showCompare, hideCompare])

  const handleToggleField = useCallback((field) => {
    if (field === 'abm') {
      setAbmActive(prev => !prev)
      return
    }
    setActiveFields(prev =>
      prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]
    )
  }, [])

  const handleImpactData = useCallback((aiResult, category) => {
    setImpactData(aiResult)
    setSelectedCategory(category)
  }, [])

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
        activeFields={abmActive ? [...activeFields, 'abm'] : activeFields}
        onToggleField={handleToggleField}
      />
      <Legend onInfoClick={() => setShowModal(true)} />
      <InfoModal isOpen={showModal} onClose={() => setShowModal(false)} />
      <ChatPanel
        onImpactData={handleImpactData}
        abmResult={{ baselineProfile, policyProfile, abmState }}
        abmPaths={{ baselinePath, policyPath }}
        updateAgentPositions={updateAgentPositions}
        onResetABM={resetABM}
      />
    </>
  )
}
