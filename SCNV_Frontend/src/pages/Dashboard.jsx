import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, { MiniMap, Controls, Background, applyNodeChanges, applyEdgeChanges } from 'reactflow';
import 'reactflow/dist/style.css';
import TopHeader from '../components/TopHeader';
import CountrySelector from '../components/CountrySelector';
import AllocationEfficiencyCard from '../components/AllocationEfficiencyCard';
import ProductiveTrendChart from '../components/ProductiveTrendChart';
import SuboptimalCustomerTile from '../components/SuboptimalCustomerTile';
import { STORAGE_KEYS, API_URL } from '../config/constants';
import { Maximize2, X, Activity, Globe2, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PlantNode from '../components/PlantNode';
import DCNode from '../components/DCNode';
import '../styles/topheader.css';
import '../styles/dashboard.css';
import StarBorder from '../components/StarBorder';

function DashboardPage({ sidebarCollapsed, setSidebarCollapsed, setSelectedAgent }) {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isCelonisEnabled, setIsCelonisEnabled] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(null);

  const nodeTypes = useMemo(() => ({ plant: PlantNode, dc: DCNode }), []);

  const authData = {
    token: localStorage.getItem(STORAGE_KEYS.TOKEN),
    role: localStorage.getItem(STORAGE_KEYS.ROLE),
    email: localStorage.getItem(STORAGE_KEYS.EMAIL),
  };

  const handleLogout = () => {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    window.location.href = '/login';
  };

  const toggleCelonis = async () => {
    try {
      setIsCelonisEnabled(!isCelonisEnabled);
    } catch(e) {
      console.error("Failed to toggle Celonis backend state.", e);
    }
  };

  const onNodesChange = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  useEffect(() => {
    const fetchMapData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/network/map`, {
          headers: { 'Authorization': `Bearer ${authData.token || ''}` }
        });
        if (!res.ok && res.status !== 401) throw new Error('Failed to fetch network data');
        const data = await res.json();
        setNodes(data.nodes || []);
        setEdges(data.edges || []);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchMapData();
  }, [authData.token]);

  const mapContent = loading ? (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-muted)' }}>
      Loading live SAP Network Data from Supabase...
    </div>
  ) : error ? (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
      {error}
    </div>
  ) : (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      fitView
      fitViewOptions={{ padding: 0.2 }}
    >
      <Controls />
      <MiniMap />
      <Background variant="dots" gap={12} size={1} />
    </ReactFlow>
  );

  return (
    <div className="fc-page">
      <TopHeader
        authData={authData}
        onLogout={handleLogout}
        onSelectAgent={setSelectedAgent}
      />

      <div className="fc-page__body">
        <main className="fc-page__main">
          {/* Page Title + Controls Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
            {/* Left: Title */}
            <div className="fc-page-title" style={{ marginBottom: 0 }}>
              <h1>Supply Chain Dashboard</h1>
              <p>Overview of your automated supply chain network visibility and agent activity.</p>
            </div>

            {/* Right: Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
              <CountrySelector
                selectedCountry={selectedCountry}
                onCountryChange={setSelectedCountry}
              />

              {/* Celonis Toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem',
                background: 'white', padding: '0.75rem 1.5rem',
                borderRadius: '2rem', border: '1px solid var(--color-border)',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.06)'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <a 
                      href="https://royal-frieslandcampina.eu-3.celonis.cloud/package-manager/ui/studio/ui/spaces/91eccf88-cca1-456d-8802-fdaf1c49c35a/packages/46cce81e-2edc-43ac-8abb-0ddcbc5c7a5d/nodes/92a7a150-af50-430c-ab97-b82fd00cc008"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="celonis-studio-link"
                      style={{ 
                        fontSize: '0.875rem', 
                        fontWeight: '600', 
                        color: 'var(--color-text)',
                        textDecoration: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = '#10b981'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-text)'}
                    >
                      Celonis EMS <ExternalLink size={12} />
                    </a>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: isCelonisEnabled ? '#10b981' : 'var(--color-muted)' }}>
                    {isCelonisEnabled ? 'Active (Intercepting)' : 'Disabled'}
                  </span>
                </div>
                <button
                  onClick={toggleCelonis}
                  style={{
                    width: '44px', height: '24px',
                    background: isCelonisEnabled ? '#10b981' : '#e5e7eb',
                    borderRadius: '12px', position: 'relative',
                    border: 'none', cursor: 'pointer',
                    transition: 'background 0.3s ease'
                  }}
                >
                  <div style={{
                    width: '20px', height: '20px', background: 'white',
                    borderRadius: '50%', position: 'absolute', top: '2px',
                    left: isCelonisEnabled ? '22px' : '2px',
                    transition: 'left 0.3s ease',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                  }} />
                </button>
              </div>
            </div>
          </div>

          {/* KPI Section */}
          <div className="dashboard-kpi-section" style={{ marginBottom: '1.5rem' }}>
            <div className="dashboard-kpi-section__title">
              <Activity size={14} /> Allocation Efficiency KPIs
            </div>
            <AllocationEfficiencyCard 
              selectedCountry={selectedCountry} 
              isCelonisEnabled={isCelonisEnabled}
            />
          </div>

          {/* Charts Row */}
          <div className="dashboard-charts-row">
            <StarBorder color="#10b981" speed="12s" thickness={3} style={{ borderRadius: '16px', display: 'block', height: '100%', minWidth: 0 }}>
              <ProductiveTrendChart selectedCountry={selectedCountry} />
            </StarBorder>
            <StarBorder color="#3b82f6" speed="8s" thickness={3} style={{ borderRadius: '16px', display: 'block', height: '100%', minWidth: 0 }}>
              <SuboptimalCustomerTile selectedCountry={selectedCountry} />
            </StarBorder>
          </div>

          {/* Network Visibility Map CTA */}
          <section style={{
            background: 'linear-gradient(135deg, #0b0e13 0%, #131820 50%, #0f1a2e 100%)',
            padding: '2rem',
            borderRadius: '1rem',
            border: '1px solid rgba(29, 184, 255, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
            marginBottom: '2rem',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
            cursor: 'pointer',
            overflow: 'hidden',
            transition: 'all 0.3s ease'
          }}
            onClick={() => navigate('/network-map')}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(245, 166, 35, 0.4)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(29, 184, 255, 0.15)'}
          >
            {/* Decorative glow */}
            <div style={{
              position: 'absolute', top: '-50%', right: '-10%',
              width: '300px', height: '300px',
              background: 'radial-gradient(circle, rgba(29,184,255,0.08) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />
            <div style={{
              position: 'absolute', bottom: '-50%', left: '20%',
              width: '200px', height: '200px',
              background: 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)',
              pointerEvents: 'none'
            }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', zIndex: 1 }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(29,184,255,0.15), rgba(245,166,35,0.15))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid rgba(29,184,255,0.2)'
              }}>
                <Globe2 size={28} color="#1db8ff" />
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: '#e2e8f0', marginBottom: '0.25rem' }}>
                  Network Visibility Map
                </h2>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: 0 }}>
                  Interactive D3.js force-directed graph · 295 nodes · 897 flows · Milk intake, STO transfers & sales deliveries
                </p>
              </div>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem', zIndex: 1,
              padding: '0.625rem 1.25rem', borderRadius: '8px',
              background: 'linear-gradient(135deg, #f5a623, #e8431f)',
              color: '#000', fontWeight: '700', fontSize: '0.875rem',
              boxShadow: '0 4px 16px rgba(245, 166, 35, 0.3)',
              whiteSpace: 'nowrap'
            }}>
              <Maximize2 size={16} /> Open Full Map
            </div>
          </section>

          {isMapModalOpen && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.8)', zIndex: 9999,
              display: 'flex', flexDirection: 'column', padding: '2rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', color: 'white' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: '600' }}>Network Visibility Map (Fullscreen)</h2>
                <button
                  onClick={() => setIsMapModalOpen(false)}
                  style={{ background: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <X size={24} color="black" />
                </button>
              </div>
              <div style={{ flex: 1, background: 'white', borderRadius: '1rem', overflow: 'hidden' }}>
                {mapContent}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default DashboardPage;
