import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { API_URL } from '../config/constants';
import { fmt, flagEmoji, computeDegrees, nodeRadius, getStats,
  EDGE_COLORS, NODE_COLORS, NODE_FILLS, NODE_ICONS, EDGE_TYPE_LABELS } from '../utils/graphHelpers';
import NetworkInfoPanel from '../components/NetworkInfoPanel';
import OfiLogo from '../components/OfiLogo';
import '../styles/networkmap.css';

const MultiSelectDropdown = ({ title, options, selectedIds, toggleSelection, prefixToRemove }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="nm-custom-dropdown" ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      <div className="nm-search-input" onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' }}>
        <span style={{ color: selectedIds.length > 0 ? '#fff' : '#aaa' }}>{selectedIds.length > 0 ? `${selectedIds.length} ${title.split(' ')[1]} Selected` : title}</span>
        <span style={{ fontSize: '10px' }}>{isOpen ? '▲' : '▼'}</span>
      </div>
      {isOpen && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#1c1624', border: '1px solid var(--nm-border)', zIndex: 100, maxHeight: '240px', overflowY: 'auto', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          {options.map(opt => (
            <div key={opt.id} onClick={() => toggleSelection(opt.id)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', gap: '8px', color: selectedIds.includes(opt.id) ? '#fff' : '#aaa', background: selectedIds.includes(opt.id) ? 'rgba(255,255,255,0.05)' : 'transparent' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'} onMouseLeave={e => e.currentTarget.style.background = selectedIds.includes(opt.id) ? 'rgba(255,255,255,0.05)' : 'transparent'}>
              <span style={{ fontSize: '16px', color: selectedIds.includes(opt.id) ? '#e8431f' : '#666', lineHeight: 1 }}>{selectedIds.includes(opt.id) ? '☑' : '☐'}</span>
              <span style={{ fontSize: '13px' }}>{opt.label} ({opt.id.replace(prefixToRemove, '')})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default function NetworkMapPage() {
  const navigate = useNavigate();
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const simRef = useRef(null);
  const zoomRef = useRef(null);
  const nodeElsRef = useRef(null);
  const linkElsRef = useRef(null);
  const edgeLabelElsRef = useRef(null);
  const labelElsRef = useRef(null);

  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [showLabels, setShowLabels] = useState(true);
  const [selectedNode, setSelectedNode] = useState(null);
  const [currentView, setCurrentView] = useState('network');
  const [searchQuery, setSearchQuery] = useState('');
  const [matFilter, setMatFilter] = useState('');
  const [custFilter, setCustFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [plantFilter, setPlantFilter] = useState([]);
  const [hiddenTypes, setHiddenTypes] = useState(new Set());

  // Fetch graph data
  useEffect(() => {
    fetch(`${API_URL}/api/network-map/graph-data`)
      .then(r => { if (!r.ok) throw new Error('Failed to fetch'); return r.json(); })
      .then(data => {
        setGraphData(data);
        setStats(getStats(data.nodes, data.edges));
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  // Build D3 graph
  useEffect(() => {
    if (!graphData || !svgRef.current) return;
    const container = svgRef.current.parentElement;
    const W = container.clientWidth;
    const H = container.clientHeight;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Defs
    const defs = svg.append('defs');
    ['milk_intake', 'procurement', 'sto_transfer', 'sales_delivery', 'transformation'].forEach(t => {
      defs.append('marker').attr('id', `nm-arrow-${t}`).attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('refX', 5).attr('refY', 3).attr('orient', 'auto')
        .append('path').attr('d', 'M0,0 L6,3 L0,6 Z').attr('fill', EDGE_COLORS[t] || '#e8431f');
    });
    // Filters removed for performance

    // Zoom
    const zoom = d3.zoom().scaleExtent([0.05, 8])
      .on('zoom', ({ transform }) => g.attr('transform', transform));
    svg.call(zoom);
    zoomRef.current = zoom;

    const g = svg.append('g');
    gRef.current = g;

    const currentNodes = currentView === 'bom' ? (graphData.bom_nodes || []) : graphData.nodes;
    const currentEdges = currentView === 'bom' ? (graphData.bom_edges || []) : graphData.edges;

    const degree = computeDegrees(currentEdges);
    const nR = n => nodeRadius(n, degree);
    const maxQty = d3.max(currentEdges, e => e.qty_kg || 0) || 1;
    const edgeW = e => Math.max(0.5, Math.min(6, ((e.qty_kg || 0) / maxQty) * 6));

    // Links (using paths to support curved STO transfers)
    const linkG = g.append('g');
    const linkEls = linkG.selectAll('path').data(currentEdges).enter().append('path')
      .attr('id', (e, i) => `nm-edgepath-${i}`)
      .attr('class', e => 'nm-edge ' + e.type)
      .attr('stroke-width', edgeW)
      .attr('marker-end', e => `url(#nm-arrow-${e.type})`)
      .attr('fill', 'none')
      .style('cursor', 'pointer'); // Let user hover the main edge directly
    linkElsRef.current = linkEls;

    // Edge Labels
    const edgeLabelG = g.append('g');
    const edgeLabelEls = edgeLabelG.selectAll('text.nm-edge-label').data(currentEdges).enter().append('text')
      .attr('class', 'nm-edge-label')
      .attr('dy', -4)
      .append('textPath')
      .attr('href', (e, i) => `#nm-edgepath-${i}`)
      .attr('startOffset', '50%')
      .attr('text-anchor', 'middle')
      .text(e => {
        if (e.type === 'transformation' || !e.qty_kg) return e.label || '';
        return new Intl.NumberFormat('en-US').format(Math.round(e.qty_kg)) + ' kg';
      });
    edgeLabelElsRef.current = edgeLabelG.selectAll('text.nm-edge-label');

    // Node groups
    const nodeG = g.append('g');
    const nodeEls = nodeG.selectAll('g').data(currentNodes).enter().append('g')
      .call(d3.drag()
        .on('start', (ev, d) => { if (!ev.active) simRef.current.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
        .on('end', (ev, d) => { if (!ev.active) simRef.current.alphaTarget(0); d.fx = null; d.fy = null; }));
    nodeElsRef.current = nodeEls;

    const nodeW = 140;
    const nodeH = 34;

    // Main rectangle
    nodeEls.append('rect').attr('class', n => 'nm-node-rect ' + n.type)
      .attr('x', -nodeW / 2)
      .attr('y', -nodeH / 2)
      .attr('width', nodeW)
      .attr('height', nodeH)
      .attr('rx', 17);
    // Icon
    nodeEls.append('text').attr('class', 'nm-node-glyph')
      .attr('x', -nodeW / 2 + 14)
      .attr('y', 0)
      .text(n => NODE_ICONS[n.type]);
    // Label (Inside the rectangle)
    const labels = nodeEls.append('text').attr('class', 'nm-node-label')
      .attr('x', -nodeW / 2 + 28)
      .attr('y', 0)
      .attr('text-anchor', 'start')
      .text(n => (n.label || n.id).slice(0, 16));
    labelElsRef.current = labels;

    // Simulation
    const sim = d3.forceSimulation(currentNodes)
      .force('link', d3.forceLink(currentEdges).id(n => n.id)
        .distance(e => e.type === 'sto_transfer' ? 120 : 300).strength(0.08))
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(800))
      .force('x', d3.forceX(n => {
        if (n.type === 'vendor') return W * 0.15;
        if (n.type === 'plant') return W * 0.5;
        if (n.type === 'customer') return W * 0.85;
        if (n.type === 'material') {
           if (n.mat_type === 'ZROH') return W * 0.2;
           if (n.mat_type === 'ZHAL') return W * 0.5;
           if (n.mat_type === 'ZFER') return W * 0.8;
        }
        return W / 2;
      }).strength(1.2)) // Strong strict vertical line constraint
      .force('y', d3.forceY(H / 2).strength(0.02))
      .force('collide', d3.forceCollide().radius(20).iterations(2)) // Base collision, refined in tick
      .on('tick', () => {
        // Enforce strict rectangle bounding box collision to ensure they NEVER overlap
        const padding = 12; // Gap between nodes
        for (let iter = 0; iter < 2; iter++) { // iterations for stability
          for (let i = 0; i < currentNodes.length; i++) {
            for (let j = i + 1; j < currentNodes.length; j++) {
              const a = currentNodes[i];
              const b = currentNodes[j];
              const dx = a.x - b.x;
              const dy = a.y - b.y;
              if (Math.abs(dx) < nodeW + padding && Math.abs(dy) < nodeH + padding) {
                 const overlapY = (nodeH + padding) - Math.abs(dy);
                 const overlapX = (nodeW + padding) - Math.abs(dx);
                 // Resolve along the axis of least penetration
                 if (overlapY < overlapX) {
                   const push = overlapY / 2;
                   if (dy > 0) { a.y += push; b.y -= push; } else { a.y -= push; b.y += push; }
                 } else {
                   const push = overlapX / 2;
                   if (dx > 0) { a.x += push; b.x -= push; } else { a.x -= push; b.x += push; }
                 }
              }
            }
          }
        }
        linkEls.attr('d', e => {
          if (typeof e.source !== 'object' || typeof e.target !== 'object') return '';
          const sx = e.source.x, sy = e.source.y;
          const dx = e.target.x - sx;
          const dy = e.target.y - sy;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          
          // Target point pulled back by rectangle boundary
          const r = e.type === 'sto_transfer' ? (nodeH/2 + 6) : (nodeW/2 + 6);
          const tx = e.target.x - (dx/len) * r;
          const ty = e.target.y - (dy/len) * r;
          
          if (e.type === 'sto_transfer') {
             // Arc for STO transfers (plant-to-plant vertical)
             const dr = len * 1.2;
             return `M${sx},${sy} A${dr},${dr} 0 0,1 ${tx},${ty}`;
          }
          
          // Bending curve for cross-column edges using cubic bezier
          // The control points offset horizontally at 1/3 and 2/3 of the way
          const midX = (sx + tx) / 2;
          const yGap = Math.abs(dy);
          const bend = Math.min(yGap * 0.3, 60); // Bend proportional to vertical gap
          const bendDir = sy < ty ? 1 : -1; // Bend upward or downward based on flow direction
          const c1x = sx + (tx - sx) * 0.3;
          const c1y = sy + bend * bendDir;
          const c2x = sx + (tx - sx) * 0.7;
          const c2y = ty - bend * bendDir;
          
          return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
        });

        nodeEls.attr('transform', n => `translate(${n.x},${n.y})`);
      });
    simRef.current = sim;

    // Animations removed for performance

    // Node events
    nodeEls.on('click', (ev, d) => { ev.stopPropagation(); setSelectedNode(d); });
    nodeEls.on('mouseover', (ev, d) => {
      const deg = computeDegrees(currentEdges);
      const inE = currentEdges.filter(e => (typeof e.target === 'object' ? e.target.id : e.target) === d.id);
      const outE = currentEdges.filter(e => (typeof e.source === 'object' ? e.source.id : e.source) === d.id);
      const tt = document.getElementById('nm-tooltip');
      if (tt) {
        tt.innerHTML = `<div class="tt-type">${d.type.toUpperCase()}</div><div class="tt-name">${d.label||d.id}</div>
          <div class="tt-row"><span class="tt-key">Country</span><span class="tt-val">${flagEmoji(d.country)} ${d.country||'-'}</span></div>
          <div class="tt-row"><span class="tt-key">City</span><span class="tt-val">${d.city||'-'}</span></div>
          <div class="tt-row"><span class="tt-key">Inbound</span><span class="tt-val">${fmt(inE.reduce((s,e)=>s+(e.qty_kg||0),0))} kg</span></div>
          <div class="tt-row"><span class="tt-key">Outbound</span><span class="tt-val">${fmt(outE.reduce((s,e)=>s+(e.qty_kg||0),0))} kg</span></div>
          <div class="tt-row"><span class="tt-key">Connections</span><span class="tt-val">${deg[d.id]||0}</span></div>`;
        tt.classList.add('visible');
        tt.style.left = Math.min(ev.clientX+14, window.innerWidth-310)+'px';
        tt.style.top = Math.max(ev.clientY-10, 10)+'px';
      }
    });
    nodeEls.on('mousemove', ev => {
      const tt = document.getElementById('nm-tooltip');
      if (tt) { tt.style.left = Math.min(ev.clientX+14, window.innerWidth-310)+'px'; tt.style.top = Math.max(ev.clientY-10,10)+'px'; }
    });
    nodeEls.on('mouseout', () => { const tt = document.getElementById('nm-tooltip'); if (tt) tt.classList.remove('visible'); });

    // Edge hover
    linkEls.on('mouseover', (ev, e) => {
      const nm = Object.fromEntries(currentNodes.map(n => [n.id, n]));
      const src = nm[typeof e.source === 'object' ? e.source.id : e.source] || {};
      const dst = nm[typeof e.target === 'object' ? e.target.id : e.target] || {};
      const tt = document.getElementById('nm-edge-tooltip');
      if (tt) {
        tt.innerHTML = `<div class="et-type">${EDGE_TYPE_LABELS[e.type]||e.type}</div>
          <div class="et-qty">${fmt(e.qty_kg||0)} kg</div>
          <div class="et-row"><span class="et-label">From</span><span>${(src.label||'').slice(0,24)}</span></div>
          <div class="et-row"><span class="et-label">To</span><span>${(dst.label||'').slice(0,24)}</span></div>
          <div class="et-row"><span class="et-label">Documents</span><span>${e.count||'-'}</span></div>
          ${e.mats && e.mats.length ? `<div class="et-row"><span class="et-label">Materials</span><span title="${e.mats.join(', ')}">${e.mats.slice(0,3).join(', ')}${e.mats.length>3?'...':''}</span></div>` : ''}
          ${e.avg_fat_pct ? `<div class="et-row"><span class="et-label">Avg Fat%</span><span>${e.avg_fat_pct}%</span></div>` : ''}`;
        tt.classList.add('visible');
        tt.style.left = (ev.clientX+12)+'px'; tt.style.top = (ev.clientY-12)+'px';
      }
    });
    linkEls.on('mousemove', ev => {
      const tt = document.getElementById('nm-edge-tooltip');
      if (tt) { tt.style.left = (ev.clientX+12)+'px'; tt.style.top = (ev.clientY-12)+'px'; }
    });
    linkEls.on('mouseout', () => { const tt = document.getElementById('nm-edge-tooltip'); if (tt) tt.classList.remove('visible'); });

    svg.on('click', () => setSelectedNode(null));

    return () => { sim.stop(); };
  }, [graphData, currentView]);

  const uniqueMaterials = React.useMemo(() => {
    if (!graphData) return [];
    const mats = new Set();
    graphData.edges.forEach(e => {
      if (e.mats) e.mats.forEach(m => mats.add(m));
    });
    return Array.from(mats).sort();
  }, [graphData]);

  const uniqueCustomers = React.useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes
      .filter(n => n.type === 'customer')
      .map(n => ({ id: n.id, label: n.label || n.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graphData]);

  const uniqueVendors = React.useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes
      .filter(n => n.type === 'vendor')
      .map(n => ({ id: n.id, label: n.label || n.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graphData]);

  const uniquePlants = React.useMemo(() => {
    if (!graphData) return [];
    return graphData.nodes
      .filter(n => n.type === 'plant')
      .map(n => ({ id: n.id, label: n.label || n.id }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [graphData]);

  // Multi-select toggle helper
  const toggleMulti = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  };

  // Combined Visibility & Highlight Effect
  useEffect(() => {
    if (!nodeElsRef.current || !linkElsRef.current || !graphData) return;

    const q = searchQuery.toLowerCase().trim();
    const currentNodes = currentView === 'bom' ? (graphData.bom_nodes || []) : graphData.nodes;
    const currentEdges = currentView === 'bom' ? (graphData.bom_edges || []) : graphData.edges;

    const mq = matFilter; // Exact match from dropdown
    const cArr = custFilter;   // Array of selected customer IDs
    const vArr = vendorFilter; // Array of selected vendor IDs
    const pArr = plantFilter;  // Array of selected plant IDs

    // Helper: Find full upstream and downstream pipeline for a node
    const getPipelineNodes = (startId) => {
      if (!startId) return new Set();
      const pipeline = new Set([startId]);
      
      const upstream = {};
      const downstream = {};
      currentEdges.forEach(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        if (!upstream[t]) upstream[t] = [];
        if (!downstream[s]) downstream[s] = [];
        upstream[t].push(s);
        downstream[s].push(t);
      });

      let queue = [startId];
      while (queue.length > 0) {
        const curr = queue.shift();
        const neighbors = upstream[curr] || [];
        for (const n of neighbors) {
          if (!pipeline.has(n)) { pipeline.add(n); queue.push(n); }
        }
      }
      
      queue = [startId];
      while (queue.length > 0) {
        const curr = queue.shift();
        const neighbors = downstream[curr] || [];
        for (const n of neighbors) {
          if (!pipeline.has(n)) { pipeline.add(n); queue.push(n); }
        }
      }
      return pipeline;
    };

    let validEdges = currentEdges;
    if (mq) {
      validEdges = validEdges.filter(e => e.mats && e.mats.includes(mq));
    }

    let validNodes = new Set(currentNodes.map(n => n.id));
    
    // Multi-select: union of all selected pipelines for each filter type
    const applyMultiFilter = (selectedIds) => {
      if (!selectedIds.length) return;
      const union = new Set();
      selectedIds.forEach(id => {
        const p = getPipelineNodes(id);
        p.forEach(n => union.add(n));
      });
      validNodes = new Set([...validNodes].filter(x => union.has(x)));
    };
    
    applyMultiFilter(cArr);
    applyMultiFilter(vArr);
    applyMultiFilter(pArr);

    if (cArr.length || vArr.length || pArr.length) {
      validEdges = validEdges.filter(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return validNodes.has(s) && validNodes.has(t);
      });
    }

    const matchIds = q ? new Set(currentNodes
      .filter(n => (n.label||'').toLowerCase().includes(q) || (n.id||'').toLowerCase().includes(q) ||
        (n.city||'').toLowerCase().includes(q) || (n.country||'').toLowerCase().includes(q))
      .map(n => n.id)) : null;

    const pipelineNodes = new Set();
    const pipelineEdges = new Set();

    validEdges.forEach(e => {
      if (filter !== 'all' && e.type !== filter) return;

      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      
      if (q) {
        if (matchIds.has(s) || matchIds.has(t)) {
          pipelineNodes.add(s);
          pipelineNodes.add(t);
          pipelineEdges.add(e);
        }
      } else {
        pipelineNodes.add(s);
        pipelineNodes.add(t);
        pipelineEdges.add(e);
      }
    });

    const isPipelineFiltered = q || mq || cArr.length || vArr.length || pArr.length || filter !== 'all';
    
    // Toggle element visibility (display: none) so "only that pipeline is visible"
    nodeElsRef.current.style('display', n => {
      if (hiddenTypes.has(n.type)) return 'none';
      if (isPipelineFiltered && !pipelineNodes.has(n.id)) return 'none';
      return null;
    });
    
    const nodeMapLocal = Object.fromEntries(currentNodes.map(n => [n.id, n]));
    
    const edgeDisplayFn = e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      const sType = nodeMapLocal[s]?.type;
      const tType = nodeMapLocal[t]?.type;
      if (hiddenTypes.has(sType) || hiddenTypes.has(tType)) return 'none';
      
      if (isPipelineFiltered && !pipelineEdges.has(e)) return 'none';
      return null;
    };

    linkElsRef.current.style('display', edgeDisplayFn);
    
    const showEdgeLabels = isPipelineFiltered || selectedNode;
    if (edgeLabelElsRef.current) {
      edgeLabelElsRef.current.style('display', e => {
        if (!showEdgeLabels) return 'none'; // Hide text labels on global view to prevent extreme clutter
        return edgeDisplayFn(e);
      });
    }

    // Handle node selection highlight (fading)
    if (selectedNode) {
      const conn = getPipelineNodes(selectedNode.id);
      nodeElsRef.current.selectAll('.nm-node-rect').classed('faded', n => !conn.has(n.id));
      const edgeFadeFn = e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return !conn.has(s) || !conn.has(t);
      };
      linkElsRef.current.classed('faded', edgeFadeFn);
      if (edgeLabelElsRef.current) edgeLabelElsRef.current.classed('faded', edgeFadeFn);
    } else {
      nodeElsRef.current.selectAll('.nm-node-rect').classed('faded', false);
      linkElsRef.current.classed('faded', false);
      if (edgeLabelElsRef.current) edgeLabelElsRef.current.classed('faded', false);
    }
  }, [searchQuery, matFilter, custFilter, vendorFilter, plantFilter, filter, selectedNode, hiddenTypes, graphData, currentView]);

  const handleFocusNode = useCallback(id => {
    if (!graphData) return;
    const currentNodes = currentView === 'bom' ? (graphData.bom_nodes || []) : graphData.nodes;
    const node = currentNodes.find(n => n.id === id);
    if (!node) return;
    setSelectedNode(node);
    if (svgRef.current && zoomRef.current) {
      const container = svgRef.current.parentElement;
      const tx = -node.x * 1.2 + container.clientWidth / 2;
      const ty = -node.y * 1.2 + container.clientHeight / 2;
      d3.select(svgRef.current).transition().duration(600)
        .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(1.2));
    }
  }, [graphData, currentView]);

  const resetZoom = () => {
    if (svgRef.current && zoomRef.current)
      d3.select(svgRef.current).transition().duration(600).call(zoomRef.current.transform, d3.zoomIdentity);
  };

  const zoomIn = () => { if (svgRef.current && zoomRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.4); };
  const zoomOut = () => { if (svgRef.current && zoomRef.current) d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7); };

  const topStoFlows = graphData ? graphData.edges
    .filter(e => e.type === 'sto_transfer').sort((a, b) => (b.qty_kg||0) - (a.qty_kg||0)).slice(0, 6) : [];
  const nodeMap = graphData ? Object.fromEntries((currentView === 'bom' ? graphData.bom_nodes || [] : graphData.nodes).map(n => [n.id, n])) : {};

  return (
    <div className="network-map-page">
      {/* Header */}
      <header className="nm-header">
        <div className="nm-brand">
          <a className="nm-back-btn" onClick={() => navigate('/dashboard')}>← Dashboard</a>
          <OfiLogo size="default" showTagline={false} style={{ marginRight: '8px' }} />
          <div>
            <div className="nm-brand-sub" style={{ fontWeight: 600 }}>Supply Chain Network Visibility Map</div>
          </div>
        </div>
        {stats && (
          <div className="nm-header-stats">
            <div className="nm-stat-pill"><div className="val">{stats.nPlant}</div><div className="key">Plants</div></div>
            <div className="nm-stat-pill"><div className="val">{stats.nVendor}</div><div className="key">Vendors</div></div>
            <div className="nm-stat-pill"><div className="val">{stats.nCust}</div><div className="key">Customers</div></div>
            <div className="nm-stat-pill"><div className="val">{stats.nEdge}</div><div className="key">Flows</div></div>
            <div className="nm-stat-pill"><div className="val">{fmt(stats.milkKg)}</div><div className="key">Raw Milk kg</div></div>
          </div>
        )}
        <div className="nm-header-controls">
          <button className={`nm-btn ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}>All Flows</button>
          <button className={`nm-btn ${filter==='milk_intake'?'active':''}`} onClick={()=>setFilter('milk_intake')}>🥛 Milk</button>
          <button className={`nm-btn ${filter==='procurement'?'active':''}`} onClick={()=>setFilter('procurement')}>📦 Procurement</button>
          <button className={`nm-btn ${filter==='sto_transfer'?'active':''}`} onClick={()=>setFilter('sto_transfer')}>🔄 STO</button>
          <button className={`nm-btn ${filter==='sales_delivery'?'active':''}`} onClick={()=>setFilter('sales_delivery')}>🚚 Delivery</button>
          <button className={`nm-btn ${currentView==='bom'?'active':''}`} onClick={() => { setCurrentView(currentView === 'network' ? 'bom' : 'network'); setFilter('all'); }} style={currentView === 'bom' ? { background: '#e8431f', borderColor: '#e8431f', color: '#fff' } : { borderColor: '#e8431f', color: '#e8431f' }}>🔄 BOM Flow View</button>
          <button className={`nm-btn ${showLabels?'active':''}`} onClick={()=>setShowLabels(!showLabels)}>Labels</button>
          <button className="nm-btn" onClick={resetZoom}>⊙ Reset</button>
        </div>
      </header>

      {/* Main */}
      <main className="nm-main">
        {/* Left sidebar */}
        <aside className="nm-aside">
          <div>
            <div className="nm-panel-title">Filters</div>
            <div className="nm-search-wrap" style={{ marginTop: 8 }}>
              <span className="nm-search-icon">🔍</span>
              <input className="nm-search-input" placeholder="Search (Plant, Vendor, City)…"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <div className="nm-search-wrap" style={{ marginTop: 6 }}>
              <span className="nm-search-icon">📦</span>
              <select className="nm-search-input" style={{ appearance: 'none' }}
                value={matFilter} onChange={e => setMatFilter(e.target.value)}>
                <option value="">All Materials</option>
                {uniqueMaterials.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="nm-search-wrap" style={{ marginTop: 6 }}>
              <span className="nm-search-icon">🏪</span>
              <MultiSelectDropdown 
                title="Select Customers…" 
                options={uniqueCustomers} 
                selectedIds={custFilter} 
                toggleSelection={(id) => toggleMulti(custFilter, setCustFilter, id)} 
                prefixToRemove="CST_" 
              />
              {custFilter.length > 0 && <div className="nm-chips">
                {custFilter.map(id => { const c = uniqueCustomers.find(x => x.id === id); return (
                  <span key={id} className="nm-chip cust" onClick={() => toggleMulti(custFilter, setCustFilter, id)}>
                    {c ? c.label.slice(0,14) : id} ✕
                  </span>
                ); })}
                <span className="nm-chip-clear" onClick={() => setCustFilter([])}>Clear</span>
              </div>}
            </div>
            <div className="nm-search-wrap" style={{ marginTop: 6 }}>
              <span className="nm-search-icon">🏭</span>
              <MultiSelectDropdown 
                title="Select Vendors…" 
                options={uniqueVendors} 
                selectedIds={vendorFilter} 
                toggleSelection={(id) => toggleMulti(vendorFilter, setVendorFilter, id)} 
                prefixToRemove="VDR_" 
              />
              {vendorFilter.length > 0 && <div className="nm-chips">
                {vendorFilter.map(id => { const v = uniqueVendors.find(x => x.id === id); return (
                  <span key={id} className="nm-chip vendor" onClick={() => toggleMulti(vendorFilter, setVendorFilter, id)}>
                    {v ? v.label.slice(0,14) : id} ✕
                  </span>
                ); })}
                <span className="nm-chip-clear" onClick={() => setVendorFilter([])}>Clear</span>
              </div>}
            </div>
            <div className="nm-search-wrap" style={{ marginTop: 6 }}>
              <span className="nm-search-icon">🏗️</span>
              <MultiSelectDropdown 
                title="Select Plants…" 
                options={uniquePlants} 
                selectedIds={plantFilter} 
                toggleSelection={(id) => toggleMulti(plantFilter, setPlantFilter, id)} 
                prefixToRemove="PLT_" 
              />
              {plantFilter.length > 0 && <div className="nm-chips">
                {plantFilter.map(id => { const p = uniquePlants.find(x => x.id === id); return (
                  <span key={id} className="nm-chip plant" onClick={() => toggleMulti(plantFilter, setPlantFilter, id)}>
                    {p ? p.label.slice(0,14) : id} ✕
                  </span>
                ); })}
                <span className="nm-chip-clear" onClick={() => setPlantFilter([])}>Clear</span>
              </div>}
            </div>
          </div>

          <div>
            <div className="nm-panel-title">Node Types</div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[['plant', '#22c55e', 'Plant (PL)'], ['vendor', '#f5a623', 'Milk Vendor'], ['customer', '#a78bfa', 'Customer']].map(([t, c, l]) => (
                <div key={t} className={`nm-legend-item ${hiddenTypes.has(t)?'dimmed':''}`}
                  onClick={() => { const s = new Set(hiddenTypes); s.has(t) ? s.delete(t) : s.add(t); setHiddenTypes(s); }}>
                  <div className="nm-legend-dot" style={{ background: c }} />
                  <div className="nm-legend-label">{l}</div>
                  <div className="nm-legend-count">{stats ? stats[t === 'plant' ? 'nPlant' : t === 'vendor' ? 'nVendor' : 'nCust'] : '-'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="nm-separator" />

          <div>
            <div className="nm-panel-title">Edge Types</div>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[['#f5a623', '🥛 Milk Intake', 'eMilk'], ['#f472b6', '📦 Procurement PO', 'eProc'], ['#3be8b0', '🔄 STO Transfer', 'eSto'], ['#a78bfa', '🚚 Sales Delivery', 'eDel']].map(([c, l, k]) => (
                <div key={l} className="nm-legend-item">
                  <div className="nm-legend-line" style={{ background: c }} />
                  <div className="nm-legend-label">{l}</div>
                  <div className="nm-legend-count">{stats ? stats[k] : '-'}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="nm-separator" />

          <div>
            <div className="nm-panel-title">Top STO Flows</div>
            <div className="nm-flow-list" style={{ marginTop: 8 }}>
              {topStoFlows.map((e, i) => {
                const src = nodeMap[typeof e.source === 'object' ? e.source.id : e.source] || {};
                const dst = nodeMap[typeof e.target === 'object' ? e.target.id : e.target] || {};
                return (
                  <div key={i} className="nm-flow-card" onClick={() => handleFocusNode(typeof e.source === 'object' ? e.source.id : e.source)}>
                    <div className="route">{(src.label||src.id||'').slice(0,22)} → {(dst.label||dst.id||'').slice(0,22)}</div>
                    <div className="qty">{fmt(e.qty_kg||0)} kg · {e.count||0} docs</div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Graph */}
        <div className="nm-graph-container">
          {loading && <div className="nm-loading"><div className="nm-loader" /><div className="nm-loader-text">Building supply chain graph…</div></div>}
          {error && <div className="nm-error"><div className="nm-error-icon">⚠️</div><div className="nm-error-title">Could not load graph data</div>
            <div className="nm-error-desc">Make sure the backend is running and build_graph.py has been executed.</div>
            <div className="nm-error-code">{error}</div></div>}
          <svg ref={svgRef} className="nm-graph-svg" />
          <div className="nm-zoom-controls">
            <button className="nm-zoom-btn" onClick={zoomIn}>+</button>
            <button className="nm-zoom-btn" onClick={zoomOut}>−</button>
            <button className="nm-zoom-btn" onClick={resetZoom}>⊙</button>
          </div>
        </div>

        {/* Info panel */}
        {selectedNode && <NetworkInfoPanel node={selectedNode} graphData={graphData} currentView={currentView}
          onClose={() => setSelectedNode(null)} onFocusNode={handleFocusNode} />}
      </main>

      {/* Tooltips */}
      <div id="nm-tooltip" className="nm-tooltip" />
      <div id="nm-edge-tooltip" className="nm-edge-tooltip" />
    </div>
  );
}
