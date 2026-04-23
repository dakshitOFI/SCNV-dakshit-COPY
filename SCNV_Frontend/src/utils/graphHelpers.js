// Graph helper utilities for the Network Visibility Map

export const EDGE_COLORS = {
  milk_intake: '#f5a623',
  procurement: '#f472b6',
  sto_transfer: '#3be8b0',
  sales_delivery: '#a78bfa',
  transformation: '#e8431f'
};

export const NODE_COLORS = {
  plant: '#22c55e',
  vendor: '#f5a623',
  customer: '#a78bfa',
  material: '#e8431f'
};

export const NODE_FILLS = {
  plant: '#062c16',
  vendor: '#1c1606',
  customer: '#1b0d2e',
  material: '#2b1d0d'
};

export const NODE_ICONS = { plant: '🏭', vendor: '🐄', customer: '🏪', material: '📦' };

export const EDGE_TYPE_LABELS = {
  milk_intake: '🥛 Milk Intake',
  procurement: '📦 Procurement PO',
  sto_transfer: '🔄 STO Transfer',
  sales_delivery: '🚚 Sales Delivery',
  transformation: '🔄 Transformation'
};

export function fmt(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toString();
}

export function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  const A = 0x1F1E6;
  return String.fromCodePoint(A + code.charCodeAt(0) - 65, A + code.charCodeAt(1) - 65);
}

export function computeDegrees(edges) {
  const degree = {};
  edges.forEach(e => {
    const s = typeof e.source === 'object' ? e.source.id : e.source;
    const t = typeof e.target === 'object' ? e.target.id : e.target;
    degree[s] = (degree[s] || 0) + 1;
    degree[t] = (degree[t] || 0) + 1;
  });
  return degree;
}

export function nodeRadius(node, degree) {
  const d = degree[node.id] || 1;
  const base = node.type === 'plant' ? 14 : node.type === 'vendor' ? 12 : node.type === 'material' ? 8 : 10;
  return Math.min(base + Math.sqrt(d) * 2, 36);
}

export function getStats(nodes, edges) {
  const nPlant = nodes.filter(n => n.type === 'plant').length;
  const nVendor = nodes.filter(n => n.type === 'vendor').length;
  const nCust = nodes.filter(n => n.type === 'customer').length;
  const milkKg = edges.filter(e => e.type === 'milk_intake').reduce((s, e) => s + (e.qty_kg || 0), 0);
  const procKg = edges.filter(e => e.type === 'procurement').reduce((s, e) => s + (e.qty_kg || 0), 0);
  const stoKg = edges.filter(e => e.type === 'sto_transfer').reduce((s, e) => s + (e.qty_kg || 0), 0);
  const delKg = edges.filter(e => e.type === 'sales_delivery').reduce((s, e) => s + (e.qty_kg || 0), 0);
  return { nPlant, nVendor, nCust, nEdge: edges.length, milkKg, procKg, stoKg, delKg,
    eMilk: edges.filter(e => e.type === 'milk_intake').length,
    eProc: edges.filter(e => e.type === 'procurement').length,
    eSto: edges.filter(e => e.type === 'sto_transfer').length,
    eDel: edges.filter(e => e.type === 'sales_delivery').length
  };
}
