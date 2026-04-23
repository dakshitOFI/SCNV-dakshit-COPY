import React from 'react';
import { fmt, EDGE_COLORS, flagEmoji } from '../utils/graphHelpers';

export default function InfoPanel({ node, graphData, currentView, onClose, onFocusNode }) {
  if (!node || !graphData) return null;
  const currentNodes = currentView === 'bom' ? (graphData.bom_nodes || []) : graphData.nodes;
  const currentEdges = currentView === 'bom' ? (graphData.bom_edges || []) : graphData.edges;
  const nodeMap = Object.fromEntries(currentNodes.map(n => [n.id, n]));

  const outEdges = currentEdges.filter(e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    return s === node.id;
  });
  const inEdges = currentEdges.filter(e => {
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    return t === node.id;
  });

  const totalOut = outEdges.reduce((s, e) => s + (e.qty_kg || 0), 0);
  const totalIn = inEdges.reduce((s, e) => s + (e.qty_kg || 0), 0);

  const typeLabels = { plant: '🏭 Plant', vendor: '🐄 Vendor', customer: '🏪 Customer', material: '📦 Material' };

  return (
    <div className="nm-info-panel open">
      <button className="nm-info-close" onClick={onClose}>✕ Close</button>
      <span className={`nm-info-type-badge ${node.type}`}>{typeLabels[node.type]}</span>
      <div className="nm-info-name">{node.label || node.id}</div>
      <div className="nm-info-sub">{flagEmoji(node.country)} {node.country || ''} · {node.city || ''}</div>

      <div className="nm-kpi-grid">
        <div className="nm-kpi-card">
          <div className="nm-kpi-val" style={{ color: '#1db8ff' }}>{fmt(totalIn)} <span style={{ fontSize: 11, color: '#6b7280' }}>kg</span></div>
          <div className="nm-kpi-key">Inbound</div>
        </div>
        <div className="nm-kpi-card">
          <div className="nm-kpi-val" style={{ color: '#a78bfa' }}>{fmt(totalOut)} <span style={{ fontSize: 11, color: '#6b7280' }}>kg</span></div>
          <div className="nm-kpi-key">Outbound</div>
        </div>
        <div className="nm-kpi-card">
          <div className="nm-kpi-val">{inEdges.length}</div>
          <div className="nm-kpi-key">In Lanes</div>
        </div>
        <div className="nm-kpi-card">
          <div className="nm-kpi-val">{outEdges.length}</div>
          <div className="nm-kpi-key">Out Lanes</div>
        </div>
      </div>

      {inEdges.length > 0 && (
        <>
          <div className="nm-section-title">Inbound Connections</div>
          <div className="nm-conn-list">
            {inEdges.sort((a, b) => (b.qty_kg || 0) - (a.qty_kg || 0)).slice(0, 8).map((e, i) => {
              const sid = typeof e.source === 'object' ? e.source.id : e.source;
              const src = nodeMap[sid] || {};
              return (
                <div key={i} className="nm-conn-item" onClick={() => onFocusNode(sid)}>
                  <div className="nm-conn-dot" style={{ background: EDGE_COLORS[e.type] }} />
                  <div className="nm-conn-name">{(src.label || sid).slice(0, 24)}</div>
                  <div className="nm-conn-qty">{fmt(e.qty_kg || 0)} kg</div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {outEdges.length > 0 && (
        <>
          <div className="nm-section-title">Outbound Connections</div>
          <div className="nm-conn-list">
            {outEdges.sort((a, b) => (b.qty_kg || 0) - (a.qty_kg || 0)).slice(0, 8).map((e, i) => {
              const tid = typeof e.target === 'object' ? e.target.id : e.target;
              const dst = nodeMap[tid] || {};
              return (
                <div key={i} className="nm-conn-item" onClick={() => onFocusNode(tid)}>
                  <div className="nm-conn-dot" style={{ background: EDGE_COLORS[e.type] }} />
                  <div className="nm-conn-name">{(dst.label || tid).slice(0, 24)}</div>
                  <div className="nm-conn-qty">{fmt(e.qty_kg || 0)} kg</div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
