import { useState, useRef, useEffect } from 'react'
import { AI_API_URL } from '../../constants'
import ABMPanel from '../ABMPanel'

export default function ChatPanel({ onImpactData, abmResult, onResetABM }) {
  const [messages, setMessages] = useState([{ type: 'welcome' }])
  const [policyText, setPolicyText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [isAnalysing, setIsAnalysing] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function analysePolicy() {
    const text = policyText.trim()
    if (!text) return

    setMessages(prev => [...prev, { type: 'user', text }])
    setMessages(prev => [...prev, { type: 'thinking' }])
    setPolicyText('')
    setIsAnalysing(true)

    try {
      const res = await fetch(AI_API_URL + '/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: text, year: 2024 })
      })
      if (!res.ok) throw new Error('API status ' + res.status)
      const aiResult = await res.json()
      setMessages(prev => prev.filter(m => m.type !== 'thinking').concat({ type: 'result', data: aiResult }))
      onImpactData(aiResult, selectedCategory)
    } catch (err) {
      setMessages(prev => prev.filter(m => m.type !== 'thinking').concat({ type: 'error', text: 'Analysis failed: ' + err.message }))
    }
    setIsAnalysing(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analysePolicy()
  }

  return (
    <div id="chat-panel">
      <div id="chat-header">
        <h3>Barcli – AI</h3>
        <p>Describe an urban policy or intervention. The AI analyses its spatial climate impact across Barcelona neighbourhoods.</p>
      </div>

      <div id="chat-messages">
        {messages.map((msg, i) => {
          if (msg.type === 'welcome') return (
            <div key={i} className="chat-welcome">
              <div className="welcome-arrow">→</div>
              <p>Enter a policy sentence below. For example:</p>
              <ul>
                <li>"Installing green roofs in Gràcia to reduce heat"</li>
                <li>"Reducing green spaces in Eixample for new construction"</li>
                <li>"Water-sensitive urban design in Sant Martí"</li>
              </ul>
              <p>After clicking <strong>Analyse</strong>, select a layer on the left. A <strong>draggable slider</strong> will appear on the map showing Baseline vs After Policy.</p>
            </div>
          )
          if (msg.type === 'user') return <div key={i} className="chat-user-msg">{msg.text}</div>
          if (msg.type === 'thinking') return (
            <div key={i} className="chat-thinking"><span/><span/><span/></div>
          )
          if (msg.type === 'error') return <div key={i} className="chat-error">{msg.text}</div>
          if (msg.type === 'result') return <ResultCard key={i} aiResult={msg.data} />
          return null
        })}
        {abmResult?.abmState === 'placing-start' && (
          <div className="abm-status">🟡 Click the map to place the <strong>start point</strong></div>
        )}
        {abmResult?.abmState === 'placing-end' && (
          <div className="abm-status">⚪ Click the map to place the <strong>destination</strong></div>
        )}
        {abmResult?.abmState === 'running' && (
          <div className="abm-status">⏳ Computing pathfinding simulation...</div>
        )}
        {abmResult?.baselineProfile?.length > 0 && (
          <ABMPanel
            baselineProfile={abmResult.baselineProfile}
            policyProfile={abmResult.policyProfile}
            onReset={onResetABM}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      <div id="chat-input-area">
        <div className="category-select-wrap">
          <label htmlFor="policy-category">Policy Type</label>
          <select
            id="policy-category"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
          >
            <option value="">— select type (optional) —</option>
            <option value="urban">Urban / Infrastructure</option>
            <option value="green">Green / Nature</option>
            <option value="water">Water / Drainage</option>
            <option value="energy">Energy</option>
            <option value="governance">Governance / Policy</option>
          </select>
        </div>
        <textarea
          id="policy-input"
          placeholder="e.g. Installing green roofs in Gràcia to reduce the urban heat island effect..."
          rows={3}
          value={policyText}
          onChange={e => setPolicyText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button id="analyse-btn" onClick={analysePolicy} disabled={isAnalysing}>
          {isAnalysing ? 'Analysing...' : 'Analyse'}
        </button>
      </div>
    </div>
  )
}

function ResultCard({ aiResult }) {
  const local        = aiResult.neighborhood_level
  const city         = aiResult.city_level
  const isMitigation = local.direction === 'Mitigation'
  const confPct      = Math.round(local.confidence * 100)
  const neighborhood = aiResult.analyzed_neighborhood || 'Barcelona'
  const isCitywide   = aiResult.is_citywide || false
  const macro        = local.macro_impact || {}
  const heatPct      = Math.round((macro['Heat risk']    || 0) * 100)
  const droughtPct   = Math.round((macro['Drought risk'] || 0) * 100)
  const urbanPct     = Math.round((macro['Urban health'] || 0) * 100)
  const topDrivers   = Object.entries(local.drivers || {}).sort((a,b) => b[1]-a[1]).slice(0,4)
  const cityDir        = city.direction === 'Mitigation' ? '↓ Mitigation' : '↑ Aggravation'
  const cityConf       = Math.round(city.confidence * 100)
  const cityColor      = city.direction === 'Mitigation' ? '#00cc66' : '#ff4466'
  const topCityDrv     = Object.entries(city.drivers || {}).sort((a,b) => b[1]-a[1]).slice(0,4)
  const cityMacro      = city.macro_impact || {}
  const cityHeatPct    = Math.round((cityMacro['Heat risk']    || 0) * 100)
  const cityDroughtPct = Math.round((cityMacro['Drought risk'] || 0) * 100)
  const cityUrbanPct   = Math.round((cityMacro['Urban health'] || 0) * 100)

  return (
    <div className="result-card">
      <div className="result-meta">
        <span className="result-neighborhood">📍 {neighborhood}</span>
        {isCitywide && <span className="citywide-tag">Citywide</span>}
      </div>

      <div className={isMitigation ? 'result-direction mitigation' : 'result-direction aggravation'}>
        {isMitigation ? '↓ MITIGATION' : '↑ AGGRAVATION'}
        <span className="confidence-badge">{confPct}% confidence</span>
      </div>

      <div className="result-section">
        <div className="section-label">Impact Weights</div>
        <WeightRow label="Heat Risk"    pct={heatPct}    cls="heat-w"    />
        <WeightRow label="Drought Risk" pct={droughtPct} cls="drought-w" />
        <WeightRow label="Urban Health" pct={urbanPct}   cls="urban-w"   />
      </div>

      {topDrivers.length > 0 && (
        <div className="result-section">
          <div className="section-label">Key Drivers</div>
          {topDrivers.map(([name, val]) => (
            <DriverRow key={name} name={name} val={val} />
          ))}
        </div>
      )}

      <div className="result-section" style={{ marginBottom: 4 }}>
        <div className="section-label">City-wide Signal</div>
        <div style={{ fontSize: 11, color: cityColor, padding: '4px 0 6px' }}>
          {cityDir} — {cityConf}% confidence
        </div>
        <WeightRow label="Heat Risk"    pct={cityHeatPct}    cls="heat-w"    />
        <WeightRow label="Drought Risk" pct={cityDroughtPct} cls="drought-w" />
        <WeightRow label="Urban Health" pct={cityUrbanPct}   cls="urban-w"   />
        {topCityDrv.length > 0 && (
          <>
            <div className="city-drivers-label" style={{ marginTop: 6 }}>City Drivers</div>
            {topCityDrv.map(([name, val]) => (
              <DriverRow key={name} name={name} val={val} city />
            ))}
          </>
        )}
      </div>

      <div className="map-hint">← Select a layer on the left, then drag the map slider to compare</div>
    </div>
  )
}

function WeightRow({ label, pct, cls }) {
  return (
    <div className="weight-row">
      <span className="weight-label">{label}</span>
      <div className="weight-bar-track">
        <div className={"weight-bar-fill " + cls} style={{ width: pct + '%' }} />
      </div>
      <span className="weight-pct">{pct}%</span>
    </div>
  )
}

function DriverRow({ name, val, city }) {
  const pct = Math.round(val * 100)
  return (
    <div className="driver-row">
      <span className="driver-label">{name}</span>
      <div className="driver-bar-track">
        <div className={"driver-bar-fill" + (city ? " city-driver-fill" : "")} style={{ width: pct + '%' }} />
      </div>
      <span className="driver-pct">{pct}%</span>
    </div>
  )
}
