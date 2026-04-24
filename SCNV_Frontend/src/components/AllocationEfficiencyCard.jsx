import React from 'react';
import { Milk, Info } from 'lucide-react';
import StarBorder from './StarBorder';

function AllocationEfficiencyCard({ selectedCountry, isCelonisEnabled }) {
  const CELONIS_URL = "https://royal-frieslandcampina.eu-3.celonis.cloud/package-manager/ui/studio/ui/spaces/91eccf88-cca1-456d-8802-fdaf1c49c35a/packages/46cce81e-2edc-43ac-8abb-0ddcbc5c7a5d/nodes/92a7a150-af50-430c-ab97-b82fd00cc008";

  const handleKpiClick = () => {
    if (isCelonisEnabled) {
      window.open(CELONIS_URL, '_blank', 'noopener,noreferrer');
    }
  };

  const metrics = [
    {
      label: 'Total DE Milk Consumed At Lochem',
      value: '163M KG',
      icon: <Milk size={20} />,
      color: '#3b82f6',
      description: 'Historical consumption from DE sources',
    },
    {
      label: 'Total NL Milk Consumed At Lochem',
      value: '178M KG',
      icon: <Milk size={20} />,
      color: '#10b981',
      description: 'Historical consumption from NL sources',
    },
    {
      label: 'Total DE Milk Consumed For Selected Material',
      value: '1.47M KG',
      icon: <Info size={20} />,
      color: '#f59e0b',
      description: 'Material specific DE volume',
    },
    {
      label: 'Total NL Milk Consumed For Selected Material',
      value: '1.64M KG',
      icon: <Info size={20} />,
      color: '#e8431f',
      description: 'Material specific NL volume',
    },
  ];

  return (
    <div className="kpi-efficiency-grid" style={{ 
      display: 'grid', 
      gridTemplateColumns: 'repeat(4, 1fr)', 
      gap: '1rem' 
    }}>
      {metrics.map((m) => (
        <StarBorder 
          key={m.label} 
          color={isCelonisEnabled ? '#1db8ff' : m.color} 
          speed={isCelonisEnabled ? '5s' : '15s'} 
          thickness={isCelonisEnabled ? 3 : 1} 
          style={{ borderRadius: '16px' }}
        >
          <div 
            className="kpi-card" 
            onClick={handleKpiClick}
            style={{ 
              height: '100%', 
              margin: 0, 
              border: 'none',
              cursor: isCelonisEnabled ? 'pointer' : 'default',
              transition: 'transform 0.2s',
              background: 'white',
              position: 'relative'
            }}
            onMouseEnter={e => isCelonisEnabled && (e.currentTarget.style.transform = 'translateY(-4px)')}
            onMouseLeave={e => isCelonisEnabled && (e.currentTarget.style.transform = 'translateY(0)')}
          >
            {isCelonisEnabled && (
              <div style={{
                position: 'absolute', top: '8px', right: '8px',
                fontSize: '10px', color: '#1db8ff', fontWeight: '700'
              }}>
                CELONIS LIVE
              </div>
            )}
            <div className="kpi-card__header">
              <div className="kpi-card__icon" style={{ 
                background: `${isCelonisEnabled ? '#1db8ff' : m.color}15`, 
                color: isCelonisEnabled ? '#1db8ff' : m.color 
              }}>
                {m.icon}
              </div>
            </div>
            <div className="kpi-card__value" style={{ 
              color: isCelonisEnabled ? '#1db8ff' : m.color,
              fontSize: '1.5rem',
              fontWeight: '800'
            }}>
              {m.value}
            </div>
            <div className="kpi-card__label" style={{ fontSize: '0.75rem', fontWeight: '600', minHeight: '2.5rem' }}>
              {m.label}
            </div>
            <div className="kpi-card__desc" style={{ fontSize: '0.7rem' }}>
              {m.description}
            </div>
          </div>
        </StarBorder>
      ))}
    </div>
  );
}

export default AllocationEfficiencyCard;
