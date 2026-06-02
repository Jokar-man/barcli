// src/components/MultiABMPanel/index.jsx
import { useState, useEffect, useRef } from 'react'

const MAX_STEPS  = 200
const FRAME_SKIP = 8  // ~7-8 animation frames/sec at 60fps — slow enough to follow agents

export default function MultiABMPanel({
  selectedShelter,
  baselineCount,
  policyCount,
  totalAgents,
  baselineSnapshots,
  policySnapshots,
  updateMultiAgentPositions,
  onReset
}) {
  const [playing,  setPlaying]  = useState(false)
  const [frameIdx, setFrameIdx] = useState(0)
  const rafRef    = useRef(null)
  const frameRef  = useRef(0)
  const updateRef = useRef(updateMultiAgentPositions)
  useEffect(() => { updateRef.current = updateMultiAgentPositions }, [updateMultiAgentPositions])

  const maxFrames = Math.max(baselineSnapshots?.length || 0, policySnapshots?.length || 0)

  // Reset animation when new simulation results arrive
  useEffect(() => {
    setFrameIdx(0)
    setPlaying(false)
    frameRef.current = 0
  }, [baselineSnapshots])

  // RAF animation loop — updates Mapbox agent dots directly (no React re-renders)
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); rafRef.current = null; return }

    let localFrame = null

    const tick = () => {
      frameRef.current += 1
      if (frameRef.current % FRAME_SKIP === 0) {
        setFrameIdx(f => {
          const next = f + 1
          if (next >= maxFrames) { setPlaying(false); return f }
          localFrame = next
          return next
        })
        if (localFrame !== null) {
          updateRef.current?.(localFrame, baselineSnapshots, policySnapshots)
        }
      }
      if (localFrame === null || localFrame < maxFrames - 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(rafRef.current); rafRef.current = null; frameRef.current = 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, maxFrames])

  if (!selectedShelter) return null

  const shelterName = selectedShelter.properties?.name || 'Selected Shelter'
  const district    = selectedShelter.properties?.addresses_district_name || ''
  const basePct     = totalAgents > 0 ? Math.round((baselineCount / totalAgents) * 100) : 0
  const policyPct   = totalAgents > 0 ? Math.round((policyCount   / totalAgents) * 100) : 0
  const diff        = policyCount - baselineCount

  return (
    <div className="shelter-result-card">
      <div className="shelter-result-header">
        <div>
          <div className="shelter-result-name">🏛 {shelterName}</div>
          {district && <div className="shelter-result-district">{district}</div>}
        </div>
        <button className="abm-reset-btn" onClick={onReset}>✕ Reset</button>
      </div>

      <div className="shelter-count-section">
        <div className="shelter-count-label">Agents reaching shelter ({totalAgents} total)</div>

        <div className="shelter-count-row">
          <span className="shelter-count-tag baseline">Before</span>
          <div className="shelter-count-track">
            <div className="shelter-count-fill baseline-fill" style={{ width: basePct + '%' }} />
          </div>
          <span className="shelter-count-num">{baselineCount}/{totalAgents}</span>
        </div>

        <div className="shelter-count-row">
          <span className="shelter-count-tag policy">After</span>
          <div className="shelter-count-track">
            <div className="shelter-count-fill policy-fill" style={{ width: policyPct + '%' }} />
          </div>
          <span className="shelter-count-num">{policyCount}/{totalAgents}</span>
        </div>

        <div className={'shelter-diff ' + (diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral')}>
          {diff > 0
            ? `↑ ${diff} more agents reached safety after policy`
            : diff < 0
              ? `↓ ${Math.abs(diff)} fewer agents stressed enough to seek shelter`
              : 'Policy had no measurable effect on shelter utilisation'}
        </div>
      </div>

      {maxFrames > 1 && (
        <div className="abm-controls">
          <button className="abm-play-btn" onClick={() => setPlaying(p => !p)}>
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <input
            type="range"
            min={0}
            max={maxFrames - 1}
            value={frameIdx}
            onChange={e => {
              const f = Number(e.target.value)
              setFrameIdx(f)
              updateRef.current?.(f, baselineSnapshots, policySnapshots)
            }}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 10, color: '#888', minWidth: 44 }}>
            {frameIdx * 5}/{MAX_STEPS}
          </span>
        </div>
      )}
    </div>
  )
}
