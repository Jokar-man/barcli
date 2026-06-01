
const FIELDS = [
  { key: 'heat',         label: 'Heat' },
  { key: 'SPEI',         label: 'Drought' },
  { key: 'urban_health', label: 'Urban Health' },
  { key: 'abm',          label: 'ABM' },
]

export default function LeftPanel({ activeFields, onToggleField }) {
  return (
    <div id="panel">
      <h3>Climate Layers</h3>
      {FIELDS.map(({ key, label }) => (
        <button
          key={key}
          data-field={key}
          className={activeFields.includes(key) ? 'active' : ''}
          onClick={() => onToggleField(key)}
          style={key === 'abm' && activeFields.includes('abm')
            ? { borderColor: '#FFD700', color: '#FFD700', background: 'rgba(255,215,0,0.1)' }
            : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
