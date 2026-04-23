import pandas as pd
import json
import collections
import os

data_dir = r'c:\Users\abcom\OneDrive - Ofi Benelux B.V\Desktop\my-postgres-project\data'

print("Loading MARA for material types...")
mara_df = pd.read_csv(os.path.join(data_dir, 'MARA.csv'), usecols=['MATNR', 'MTART'], dtype=str)
# Strip leading zeros for display, keep original for mapping
mara_df['MATNR_CLEAN'] = mara_df['MATNR'].str.lstrip('0')
mat_types = dict(zip(mara_df['MATNR'], mara_df['MTART']))
mat_clean = dict(zip(mara_df['MATNR'], mara_df['MATNR_CLEAN']))

print("Loading material descriptions...")
try:
    ekpo_df = pd.read_csv(os.path.join(data_dir, 'EKPO.csv'), usecols=['MATNR', 'TXZ01'], dtype=str).dropna()
    mat_desc = dict(zip(ekpo_df['MATNR'], ekpo_df['TXZ01']))
except Exception:
    mat_desc = {}

try:
    vbap_df = pd.read_csv(os.path.join(data_dir, 'VBAP.csv'), usecols=['MATNR', 'ARKTX'], dtype=str).dropna()
    mat_desc.update(dict(zip(vbap_df['MATNR'], vbap_df['ARKTX'])))
except Exception:
    pass

print("Loading MSEG for BOM flows...")
mseg_df = pd.read_csv(os.path.join(data_dir, 'MSEG.csv'), usecols=['AUFNR', 'BWART', 'MATNR'], dtype=str)
mseg_prod = mseg_df[mseg_df['BWART'].isin(['101', '261']) & mseg_df['AUFNR'].notna()]

print("Building flows...")
grouped = mseg_prod.groupby('AUFNR')

flow_counts = collections.defaultdict(int)

for aufnr, group in grouped:
    in_mats = group[group['BWART'] == '261']['MATNR'].dropna().unique()
    out_mats = group[group['BWART'] == '101']['MATNR'].dropna().unique()
    
    if len(in_mats) > 0 and len(out_mats) > 0:
        for i in in_mats:
            for o in out_mats:
                flow_counts[(i, o)] += 1

print(f"Found {len(flow_counts)} unique material transformation flows.")

# Top N flows to keep the graph readable
TOP_BOM = 500
sorted_flows = sorted(flow_counts.items(), key=lambda x: x[1], reverse=True)[:TOP_BOM]

bom_nodes_dict = {}
bom_edges = []

def add_bom_node(matnr):
    if matnr not in bom_nodes_dict:
        mtype = mat_types.get(matnr, 'UNKNOWN')
        clean_id = mat_clean.get(matnr, matnr)
        desc = mat_desc.get(matnr)
        
        type_label = "Raw Milk" if mtype == 'ZROH' else "Semi-Finished" if mtype == 'ZHAL' else "Finished Product" if mtype == 'ZFER' else "Material"
        
        label = f"{desc} ({clean_id})" if desc else f"{type_label} ({clean_id})"
        
        bom_nodes_dict[matnr] = {
            'id': 'MAT_' + clean_id,
            'label': label,
            'type': 'material',
            'mat_type': mtype
        }
    return bom_nodes_dict[matnr]['id']

for (src, dst), count in sorted_flows:
    src_id = add_bom_node(src)
    dst_id = add_bom_node(dst)
    bom_edges.append({
        'source': src_id,
        'target': dst_id,
        'type': 'transformation',
        'count': count,
        'label': f"{count} orders"
    })

print(f"BOM Nodes: {len(bom_nodes_dict)}, BOM Edges: {len(bom_edges)}")

# Update existing network_graph_data.json
out_path = os.path.join(data_dir, 'network_graph_data.json')
if os.path.exists(out_path):
    with open(out_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
else:
    data = {'nodes': [], 'edges': []}

data['bom_nodes'] = list(bom_nodes_dict.values())
data['bom_edges'] = bom_edges

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)

print("Updated network_graph_data.json with BOM data.")
