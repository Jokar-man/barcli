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
  const [abmActive,        setAbmActive]        = useState(false)
  const [impactFeatures,   _setImpactFeatures]  = useState(null)

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
    isActive:      abmActive,
    points:        null,
    stats:         null,
    activeFields,
    impactFeatures
  })

  const {
    mapContainerRef,
    mapImpactRef,
    isCompareVisible,
    showCompare,
    hideCompare,
    updateDivider,
    dividerXRef
  } = useMapbox({
    activeFields,
    impactData,
    selectedCategory,
    abmMode:      abmState,
    abmCallbacks: { handleMapClick, startCoord, endCoord, baselinePath, policyPath }
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
    // Store the last impact features so ABM can use post-policy vulnerability
    // (useMapbox computes them internally — we capture from AI result metadata)
    // For now impactFeatures is set separately via map hook exposure in a future task
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
        onResetABM={resetABM}
      />
    </>
  )
}
