// src/components/ABMPanel/index.jsx
import { useState, useEffect, useRef } from 'react'
import PathChart from './PathChart'

export default function ABMPanel({ baselineProfile, policyProfile, onReset }) {
  const [playing, setPlaying] = useState(false)
  const [step, setStep]       = useState(0)
  const rafRef                = useRef(null)
  const maxSteps = Math.max(baselineProfile?.length || 0, policyProfile?.length || 0)

  // Reset animation when new profiles arrive
  useEffect(() => {
    setStep(0)
    setPlaying(false)
  }, [baselineProfile])

  // Animation loop
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return }
    const tick = () => {
      setStep(s => {
        if (s >= maxSteps - 1) { setPlaying(false); return s }
        rafRef.current = requestAnimationFrame(tick)
        return s + 1
      })
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, maxSteps])

  if (!baselineProfile?.length) return null

  return (
    <div className="abm-panel">
      <div className="abm-panel-header">
        <span>ABM Path Analysis</span>
        <button className="abm-reset-btn" onClick={onReset}>✕ Reset</button>
      </div>
      <PathChart
        baselineProfile={baselineProfile}
        policyProfile={policyProfile}
        stepIndex={step}
      />
      <div className="abm-controls">
        <button
          className="abm-play-btn"
          onClick={() => setPlaying(p => !p)}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <input
          type="range"
          min={0}
          max={maxSteps - 1}
          value={step}
          onChange={e => setStep(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, color: '#888', minWidth: 40 }}>{step}/{maxSteps - 1}</span>
      </div>
    </div>
  )
}
