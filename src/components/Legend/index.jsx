
export default function Legend({ onInfoClick }) {
  return (
    <div id="info-legend">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', fontWeight: 700 }}>
        <span id="legend-title">Vulnerability Intensity</span>
      </div>
      <div className="legend-gradient" />
      <div className="legend-labels">
        <span id="legend-low">Low</span>
        <span id="legend-high">High</span>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <div id="info-icon" onClick={onInfoClick}>i</div>
      </div>
    </div>
  )
}
