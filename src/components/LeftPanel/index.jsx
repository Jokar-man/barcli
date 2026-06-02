const CLIMATE_FIELDS = [
  { key: 'heat',         label: 'Heat' },
  { key: 'SPEI',         label: 'Drought' },
  { key: 'urban_health', label: 'Urban Health' },
]

export default function LeftPanel({ activeFields, onToggleField, agenticMode, onSetAgenticMode, onReset }) {
  return (
    <div id="panel">
      <div className="panel-header-row">
        <h3>Climate Layers</h3>
        <button className="panel-reset-btn" onClick={onReset} title="Reset all layers and analysis">↺</button>
      </div>

      {CLIMATE_FIELDS.map(({ key, label }) => (
        <button
          key={key}
          data-field={key}
          className={activeFields.includes(key) ? 'active' : ''}
          onClick={() => onToggleField(key)}
        >
          {label}
        </button>
      ))}

      <div className="agentic-section">
        <div className="agentic-header">Agentic Interaction</div>
        <button
          className={'agentic-btn' + (agenticMode === 'single' ? ' active' : '')}
          onClick={() => onSetAgenticMode(agenticMode === 'single' ? 'none' : 'single')}
        >
          Single Agent
        </button>
        <button
          className={'agentic-btn' + (agenticMode === 'multi' ? ' active agentic-multi' : '')}
          onClick={() => onSetAgenticMode(agenticMode === 'multi' ? 'none' : 'multi')}
        >
          Multi-Agent
        </button>
      </div>
    </div>
  )
}
