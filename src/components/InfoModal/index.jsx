
export default function InfoModal({ isOpen, onClose }) {
  if (!isOpen) return null
  return (
    <div id="info-modal" onClick={e => e.target === e.currentTarget && onClose()}>
      <span className="close-modal" onClick={onClose}>&times;</span>
      <h4>Data Sources & Information</h4>
      <p>This map visualises vulnerability in Barcelona based on multiple factors:</p>
      <p><strong>1. Combined Heat (UHI + LST):</strong> Average of Urban Heat Island effect and Land Surface Temperature from Google Earth Engine (2021–2024).</p>
      <p><strong>2. Drought (SPEI):</strong> Standardised Precipitation Evapotranspiration Index, indicating hydrological stress (2023).</p>
      <p><strong>3. Urban Health:</strong> Composite of immigrant density, inverted income level (lower income = higher vulnerability), and population density.</p>
      <p>All data points are normalised to a vulnerability score 0–1.</p>
      <p><strong>City Centre Reference:</strong> Plaça Catalunya (2.1734°E, 41.3851°N)</p>
      <p style={{ marginTop: 20, fontSize: 12, color: '#666' }}>
        <a href="https://www.mapbox.com/" target="_blank" rel="noreferrer">Map visuals powered by Mapbox.</a>
      </p>
    </div>
  )
}
