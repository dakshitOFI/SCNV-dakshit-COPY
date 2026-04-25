"""
Network Visibility Map API.

Builds graph data directly from PostgreSQL SAP tables so the frontend can
render the same D3 map without relying on a static JSON export.
"""

from collections import defaultdict
from datetime import datetime, timedelta
import os

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import create_engine, text

router = APIRouter()

load_dotenv(os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.env")))
DB_URL = os.getenv("DATABASE_URL")

# Cache to avoid recomputing large aggregates on every request.
CACHE_TTL_SECONDS = 300
_GRAPH_CACHE = {"expires_at": datetime.min, "data": None}


def _clean_code(value: str) -> str:
    return (value or "").strip()


def _prefixed(code: str, prefix: str) -> str:
    raw = _clean_code(code)
    if not raw:
        return ""
    return raw if raw.startswith(prefix) else f"{prefix}{raw}"


def _safe_qty(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _get_engine():
    if not DB_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured.")
    try:
        return create_engine(DB_URL, pool_pre_ping=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB initialization failed: {exc}")


def _build_graph_from_db() -> dict:
    engine = _get_engine()

    # Keep labels stable and compact while preserving existing frontend contract.
    nodes_by_id = {}
    edges_by_key = defaultdict(lambda: {"qty_kg": 0.0, "count": 0, "mats": set(), "avg_fat_sum": 0.0, "avg_fat_n": 0})
    batch_nodes_by_id = {}
    batch_edges_by_key = defaultdict(lambda: {"qty_kg": 0.0, "count": 0})
    plant_usage = set()
    vendor_usage = set()
    customer_usage = set()

    with engine.connect() as conn:
        # Master data for node enrichment
        plant_rows = conn.execute(text("""
            SELECT werks, name1, land1, ort01
            FROM public.t001w
            WHERE COALESCE(werks, '') <> ''
        """)).mappings().all()
        plants = {
            _clean_code(r["werks"]): {
                "label": (r["name1"] or "").strip() or _clean_code(r["werks"]),
                "country": (r["land1"] or "").strip(),
                "city": (r["ort01"] or "").strip(),
            }
            for r in plant_rows
        }

        vendor_rows = conn.execute(text("""
            SELECT lifnr, name1, land1, ort01
            FROM public.lfa1
            WHERE COALESCE(lifnr, '') <> ''
        """)).mappings().all()
        vendors = {
            _clean_code(r["lifnr"]): {
                "label": (r["name1"] or "").strip() or _clean_code(r["lifnr"]),
                "country": (r["land1"] or "").strip(),
                "city": (r["ort01"] or "").strip(),
            }
            for r in vendor_rows
        }

        customer_rows = conn.execute(text("""
            SELECT kunnr, name1, land1, ort01
            FROM public.kna1
            WHERE COALESCE(kunnr, '') <> ''
        """)).mappings().all()
        customers = {
            _clean_code(r["kunnr"]): {
                "label": (r["name1"] or "").strip() or _clean_code(r["kunnr"]),
                "country": (r["land1"] or "").strip(),
                "city": (r["ort01"] or "").strip(),
            }
            for r in customer_rows
        }

        # 1) Milk intake/vendor issuing: vendor -> plant.
        # Align to the mapping intent: focus on GR-like movement 101 with vendor context.
        milk_rows = conn.execute(text("""
            SELECT
                lifnr,
                werks,
                COALESCE(matnr, '') AS matnr,
                SUM(
                    CASE
                        WHEN bwart = '101' AND menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric
                        WHEN bwart = '102' AND menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN -1 * menge::numeric
                        ELSE 0
                    END
                ) AS qty_kg,
                COUNT(*) AS doc_count
            FROM public.mseg
            WHERE COALESCE(lifnr, '') <> ''
              AND COALESCE(werks, '') <> ''
              AND bwart IN ('101', '102')
            GROUP BY lifnr, werks, COALESCE(matnr, '')
        """)).mappings().all()

        for r in milk_rows:
            src_code = _clean_code(r["lifnr"])
            dst_code = _clean_code(r["werks"])
            if not src_code or not dst_code:
                continue
            src = _prefixed(src_code, "VDR_")
            dst = _prefixed(dst_code, "PLT_")
            key = (src, dst, "milk_intake")
            agg = edges_by_key[key]
            agg["qty_kg"] += _safe_qty(r["qty_kg"])
            agg["count"] += int(r["doc_count"] or 0)
            if r["matnr"]:
                agg["mats"].add(_clean_code(r["matnr"]))
            vendor_usage.add(src_code)
            plant_usage.add(dst_code)

        # 2) Procurement: vendor -> plant from EKKO + EKPO.
        procurement_rows = conn.execute(text("""
            SELECT
                e.lifnr,
                p.werks,
                COALESCE(p.matnr, '') AS matnr,
                SUM(CASE WHEN p.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN p.menge::numeric ELSE 0 END) AS qty_kg,
                COUNT(DISTINCT e.ebeln) AS doc_count
            FROM public.ekko e
            JOIN public.ekpo p ON p.ebeln = e.ebeln
            WHERE COALESCE(e.lifnr, '') <> ''
              AND COALESCE(p.werks, '') <> ''
            GROUP BY e.lifnr, p.werks, COALESCE(p.matnr, '')
        """)).mappings().all()

        for r in procurement_rows:
            src_code = _clean_code(r["lifnr"])
            dst_code = _clean_code(r["werks"])
            if not src_code or not dst_code:
                continue
            src = _prefixed(src_code, "VDR_")
            dst = _prefixed(dst_code, "PLT_")
            key = (src, dst, "procurement")
            agg = edges_by_key[key]
            agg["qty_kg"] += _safe_qty(r["qty_kg"])
            agg["count"] += int(r["doc_count"] or 0)
            if r["matnr"]:
                agg["mats"].add(_clean_code(r["matnr"]))
            vendor_usage.add(src_code)
            plant_usage.add(dst_code)

        # 3) STO transfer: plant -> plant from MSEG receiving/supplying plant fields.
        sto_rows = conn.execute(text("""
            SELECT
                werks AS source_plant,
                umwrk AS target_plant,
                COALESCE(matnr, '') AS matnr,
                SUM(CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric ELSE 0 END) AS qty_kg,
                COUNT(*) AS doc_count
            FROM public.mseg
            WHERE COALESCE(werks, '') <> ''
              AND COALESCE(umwrk, '') <> ''
              AND werks <> umwrk
            GROUP BY werks, umwrk, COALESCE(matnr, '')
        """)).mappings().all()

        for r in sto_rows:
            src_code = _clean_code(r["source_plant"])
            dst_code = _clean_code(r["target_plant"])
            if not src_code or not dst_code:
                continue
            src = _prefixed(src_code, "PLT_")
            dst = _prefixed(dst_code, "PLT_")
            key = (src, dst, "sto_transfer")
            agg = edges_by_key[key]
            agg["qty_kg"] += _safe_qty(r["qty_kg"])
            agg["count"] += int(r["doc_count"] or 0)
            if r["matnr"]:
                agg["mats"].add(_clean_code(r["matnr"]))
            plant_usage.add(src_code)
            plant_usage.add(dst_code)

        # 4) Customer mapping: plant -> customer from GI-to-customer movement lines.
        # This follows the provided logic intent (movement 601 as Goods Issued To Customer).
        sales_rows = conn.execute(text("""
            SELECT
                m.werks,
                m.kunnr,
                COALESCE(m.matnr, '') AS matnr,
                SUM(
                    CASE
                        WHEN m.bwart = '601' AND m.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN m.menge::numeric
                        WHEN m.bwart = '602' AND m.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN -1 * m.menge::numeric
                        ELSE 0
                    END
                ) AS qty_kg,
                COUNT(*) AS doc_count
            FROM public.mseg m
            WHERE COALESCE(m.werks, '') <> ''
              AND COALESCE(m.kunnr, '') <> ''
              AND COALESCE(m.matnr, '') <> ''
              AND COALESCE(m.charg, '') <> ''
              AND COALESCE(m.lgort, '') <> ''
              AND m.bwart IN ('601', '602')
              AND m.werks NOT IN ('3779','3973','3690','3736','3101','3159','3969','3158','3528','3423','3111','3778','3432','3013','3234','3110')
            GROUP BY m.werks, m.kunnr, COALESCE(m.matnr, '')
        """)).mappings().all()

        for r in sales_rows:
            src_code = _clean_code(r["werks"])
            dst_code = _clean_code(r["kunnr"])
            if not src_code or not dst_code:
                continue
            src = _prefixed(src_code, "PLT_")
            dst = _prefixed(dst_code, "CST_")
            key = (src, dst, "sales_delivery")
            agg = edges_by_key[key]
            agg["qty_kg"] += _safe_qty(r["qty_kg"])
            agg["count"] += int(r["doc_count"] or 0)
            if r["matnr"]:
                agg["mats"].add(_clean_code(r["matnr"]))
            plant_usage.add(src_code)
            customer_usage.add(dst_code)

        # BOM mode data: use same logic as legacy script from MSEG 261 -> 101 per order.
        mat_type_rows = conn.execute(text("""
            SELECT matnr, mtart
            FROM public.mara
            WHERE COALESCE(matnr, '') <> ''
        """)).mappings().all()
        mat_types = {_clean_code(r["matnr"]): _clean_code(r["mtart"]) for r in mat_type_rows}

        bom_flow_rows = conn.execute(text("""
            SELECT i.matnr AS src_matnr, o.matnr AS dst_matnr, COUNT(*) AS flow_count
            FROM public.mseg i
            JOIN public.mseg o ON o.aufnr = i.aufnr
            WHERE COALESCE(i.aufnr, '') <> ''
              AND i.bwart = '261'
              AND o.bwart = '101'
              AND COALESCE(i.matnr, '') <> ''
              AND COALESCE(o.matnr, '') <> ''
            GROUP BY i.matnr, o.matnr
            ORDER BY COUNT(*) DESC
            LIMIT 500
        """)).mappings().all()

        # Dashboard KPIs from DB (not derived from rendered subset).
        kpi_row = conn.execute(text("""
            SELECT
              (SELECT COUNT(DISTINCT charg)
               FROM public.mseg
               WHERE COALESCE(charg, '') <> ''
                 AND COALESCE(lifnr, '') <> ''
                 AND bwart IN ('101', '102')) AS batches_received_from_vendor,
              (SELECT COUNT(DISTINCT charg)
               FROM public.mseg
               WHERE COALESCE(charg, '') <> ''
                 AND COALESCE(aufnr, '') <> ''
                 AND bwart IN ('101', '102')) AS batches_produced_at_plant,
              (SELECT COUNT(DISTINCT charg)
               FROM public.mseg
               WHERE COALESCE(charg, '') <> ''
                 AND COALESCE(kunnr, '') <> ''
                 AND bwart IN ('601', '602')) AS batches_shipped_to_customer,
              (SELECT COUNT(DISTINCT charg)
               FROM public.mseg
               WHERE COALESCE(charg, '') <> ''
                 AND bwart IN ('641', '643')) AS sto_batches_transfers_out,
              (SELECT COUNT(DISTINCT charg)
               FROM public.mseg
               WHERE COALESCE(charg, '') <> ''
                 AND COALESCE(umwrk, '') <> ''
                 AND bwart IN ('101', '102', '644')) AS sto_batches_transfers_in,
              (SELECT COUNT(DISTINCT aufnr)
               FROM public.mseg
               WHERE COALESCE(aufnr, '') <> '') AS production_orders,
              (SELECT COUNT(DISTINCT ebeln)
               FROM public.ekko
               WHERE COALESCE(ebeln, '') <> '') AS purchase_orders,
              (SELECT COUNT(DISTINCT vbeln)
               FROM public.vbak
               WHERE COALESCE(vbeln, '') <> '') AS sales_orders
        """)).mappings().first()

        # Batch-view graph (batch-to-batch flow without plant/vendor/customer nodes).
        # 1) STO batch transfers out (source plant batch -> receiving plant batch)
        sto_batch_rows = conn.execute(text("""
            SELECT
              m.charg AS batch_id,
              m.werks AS source_plant,
              COALESCE(NULLIF(m.umwrk, ''), NULLIF(m.umlgo, '')) AS receiving_plant,
              SUM(CASE WHEN m.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN m.menge::numeric ELSE 0 END) AS qty_kg,
              COUNT(*) AS doc_count
            FROM public.mseg m
            WHERE COALESCE(m.charg, '') <> ''
              AND COALESCE(m.werks, '') <> ''
              AND COALESCE(m.umwrk, '') <> ''
              AND m.bwart IN ('641', '643', '644')
            GROUP BY m.charg, m.werks, COALESCE(NULLIF(m.umwrk, ''), NULLIF(m.umlgo, ''))
        """)).mappings().all()

        for r in sto_batch_rows:
            batch_id = _clean_code(r["batch_id"])
            src_plant = _clean_code(r["source_plant"])
            dst_plant = _clean_code(r["receiving_plant"])
            if not batch_id or not src_plant or not dst_plant:
                continue
            src_id = f"BAT_{batch_id}_{src_plant}"
            dst_id = f"BAT_{batch_id}_{dst_plant}"
            batch_nodes_by_id[src_id] = {"id": src_id, "label": f"{batch_id} @ {src_plant}", "type": "batch"}
            batch_nodes_by_id[dst_id] = {"id": dst_id, "label": f"{batch_id} @ {dst_plant}", "type": "batch"}
            key = (src_id, dst_id, "sto_transfer")
            batch_edges_by_key[key]["qty_kg"] += _safe_qty(r["qty_kg"])
            batch_edges_by_key[key]["count"] += int(r["doc_count"] or 0)

        # 2) Production batch transformation (consumed batch -> produced batch by production order)
        prod_batch_rows = conn.execute(text("""
            SELECT
              gi.charg AS src_batch,
              COALESCE(NULLIF(gi.werks, ''), 'UNK') AS src_plant,
              gr.charg AS dst_batch,
              COALESCE(NULLIF(gr.werks, ''), 'UNK') AS dst_plant,
              SUM(CASE WHEN gi.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN gi.menge::numeric ELSE 0 END) AS qty_kg,
              COUNT(*) AS doc_count
            FROM public.mseg gi
            JOIN public.mseg gr
              ON gr.aufnr = gi.aufnr
            WHERE COALESCE(gi.aufnr, '') <> ''
              AND gi.bwart = '261'
              AND gr.bwart = '101'
              AND COALESCE(gi.charg, '') <> ''
              AND COALESCE(gr.charg, '') <> ''
            GROUP BY gi.charg, COALESCE(NULLIF(gi.werks, ''), 'UNK'), gr.charg, COALESCE(NULLIF(gr.werks, ''), 'UNK')
            ORDER BY doc_count DESC
            LIMIT 6000
        """)).mappings().all()

        for r in prod_batch_rows:
            src_batch = _clean_code(r["src_batch"])
            dst_batch = _clean_code(r["dst_batch"])
            src_plant = _clean_code(r["src_plant"])
            dst_plant = _clean_code(r["dst_plant"])
            if not src_batch or not dst_batch:
                continue
            src_id = f"BAT_{src_batch}_{src_plant}"
            dst_id = f"BAT_{dst_batch}_{dst_plant}"
            batch_nodes_by_id[src_id] = {"id": src_id, "label": f"{src_batch} @ {src_plant}", "type": "batch"}
            batch_nodes_by_id[dst_id] = {"id": dst_id, "label": f"{dst_batch} @ {dst_plant}", "type": "batch"}
            key = (src_id, dst_id, "transformation")
            batch_edges_by_key[key]["qty_kg"] += _safe_qty(r["qty_kg"])
            batch_edges_by_key[key]["count"] += int(r["doc_count"] or 0)

    # Build edge list compatible with existing frontend.
    edges = []
    for (source, target, edge_type), agg in edges_by_key.items():
        mats = sorted(m for m in agg["mats"] if m)
        avg_fat_pct = round(agg["avg_fat_sum"] / agg["avg_fat_n"], 2) if agg["avg_fat_n"] > 0 else None
        qty_kg = float(round(agg["qty_kg"], 3))
        edges.append(
            {
                "source": source,
                "target": target,
                "type": edge_type,
                "qty_kg": qty_kg,
                "qty_label": f"{round(qty_kg / 1000, 1)}t" if qty_kg else "0t",
                "count": int(agg["count"]),
                "avg_fat_pct": avg_fat_pct,
                "label": f"{round(qty_kg / 1000, 1)}t" if qty_kg else "0t",
                "mats": mats,
            }
        )

    # Create only nodes that are referenced by edges to keep rendering manageable.
    for plant_code in plant_usage:
        pid = _prefixed(plant_code, "PLT_")
        meta = plants.get(plant_code, {})
        nodes_by_id[pid] = {
            "id": pid,
            "label": meta.get("label", plant_code),
            "type": "plant",
            "country": meta.get("country", ""),
            "city": meta.get("city", ""),
        }
    for vendor_code in vendor_usage:
        vid = _prefixed(vendor_code, "VDR_")
        meta = vendors.get(vendor_code, {})
        nodes_by_id[vid] = {
            "id": vid,
            "label": meta.get("label", vendor_code),
            "type": "vendor",
            "country": meta.get("country", ""),
            "city": meta.get("city", ""),
        }
    for customer_code in customer_usage:
        cid = _prefixed(customer_code, "CST_")
        meta = customers.get(customer_code, {})
        nodes_by_id[cid] = {
            "id": cid,
            "label": meta.get("label", customer_code),
            "type": "customer",
            "country": meta.get("country", ""),
            "city": meta.get("city", ""),
        }

    # BOM nodes/edges
    bom_nodes_dict = {}
    bom_edges = []
    for r in bom_flow_rows:
        src_mat = _clean_code(r["src_matnr"])
        dst_mat = _clean_code(r["dst_matnr"])
        if not src_mat or not dst_mat:
            continue

        def add_bom_node(matnr: str) -> str:
            if matnr in bom_nodes_dict:
                return bom_nodes_dict[matnr]["id"]
            mtype = mat_types.get(matnr, "UNKNOWN")
            clean_id = matnr.lstrip("0") or matnr
            type_label = "Raw Milk" if mtype == "ZROH" else "Semi-Finished" if mtype == "ZHAL" else "Finished Product" if mtype == "ZFER" else "Material"
            node_id = f"MAT_{clean_id}"
            bom_nodes_dict[matnr] = {
                "id": node_id,
                "label": f"{type_label} ({clean_id})",
                "type": "material",
                "mat_type": mtype,
            }
            return node_id

        src_id = add_bom_node(src_mat)
        dst_id = add_bom_node(dst_mat)
        flow_count = int(r["flow_count"] or 0)
        bom_edges.append(
            {
                "source": src_id,
                "target": dst_id,
                "type": "transformation",
                "count": flow_count,
                "label": f"{flow_count} orders",
            }
        )

    # Sort for deterministic frontend behavior.
    nodes = sorted(nodes_by_id.values(), key=lambda n: n["id"])
    edges.sort(key=lambda e: (e["type"], e["source"], e["target"]))

    return {
        "nodes": nodes,
        "edges": edges,
        "bom_nodes": sorted(bom_nodes_dict.values(), key=lambda n: n["id"]),
        "bom_edges": bom_edges,
        "batch_nodes": sorted(batch_nodes_by_id.values(), key=lambda n: n["id"]),
        "batch_edges": sorted(
            [
                {
                    "source": src,
                    "target": dst,
                    "type": edge_type,
                    "qty_kg": float(round(v["qty_kg"], 3)),
                    "count": int(v["count"]),
                    "label": f"{int(v['count'])} docs",
                }
                for (src, dst, edge_type), v in batch_edges_by_key.items()
            ],
            key=lambda e: (e["type"], e["source"], e["target"])
        ),
        "kpis": {
            "batches_received_from_vendor": int(kpi_row["batches_received_from_vendor"] or 0),
            "batches_produced_at_plant": int(kpi_row["batches_produced_at_plant"] or 0),
            "batches_shipped_to_customer": int(kpi_row["batches_shipped_to_customer"] or 0),
            "sto_batches_transfers_out": int(kpi_row["sto_batches_transfers_out"] or 0),
            "sto_batches_transfers_in": int(kpi_row["sto_batches_transfers_in"] or 0),
            "production_orders": int(kpi_row["production_orders"] or 0),
            "purchase_orders": int(kpi_row["purchase_orders"] or 0),
            "sales_orders": int(kpi_row["sales_orders"] or 0),
        },
    }


@router.get("/graph-data")
async def get_graph_data():
    """
    Returns the full network graph data (nodes + edges) for the
    FrieslandCampina supply chain network visibility map.
    No auth required for internal dashboard use.
    """
    try:
        now = datetime.utcnow()
        if _GRAPH_CACHE["data"] is not None and now < _GRAPH_CACHE["expires_at"]:
            data = _GRAPH_CACHE["data"]
        else:
            data = _build_graph_from_db()
            _GRAPH_CACHE["data"] = data
            _GRAPH_CACHE["expires_at"] = now + timedelta(seconds=CACHE_TTL_SECONDS)
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/graph-stats")
async def get_graph_stats():
    """
    Returns high-level statistics about the network graph.
    """
    try:
        now = datetime.utcnow()
        if _GRAPH_CACHE["data"] is not None and now < _GRAPH_CACHE["expires_at"]:
            data = _GRAPH_CACHE["data"]
        else:
            data = _build_graph_from_db()
            _GRAPH_CACHE["data"] = data
            _GRAPH_CACHE["expires_at"] = now + timedelta(seconds=CACHE_TTL_SECONDS)

        nodes = data.get("nodes", [])
        edges = data.get("edges", [])

        # Node counts by type
        node_types = {}
        for n in nodes:
            t = n.get("type", "unknown")
            node_types[t] = node_types.get(t, 0) + 1

        # Edge counts by type
        edge_types = {}
        total_qty = 0
        for e in edges:
            t = e.get("type", "unknown")
            edge_types[t] = edge_types.get(t, 0) + 1
            total_qty += e.get("qty_kg", 0)

        # Total milk kg
        milk_kg = sum(
            e.get("qty_kg", 0) for e in edges if e.get("type") == "milk_intake"
        )
        sto_kg = sum(
            e.get("qty_kg", 0) for e in edges if e.get("type") == "sto_transfer"
        )
        delivery_kg = sum(
            e.get("qty_kg", 0) for e in edges if e.get("type") == "sales_delivery"
        )

        return {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "node_types": node_types,
            "edge_types": edge_types,
            "total_qty_kg": round(total_qty, 0),
            "milk_intake_kg": round(milk_kg, 0),
            "sto_transfer_kg": round(sto_kg, 0),
            "delivery_kg": round(delivery_kg, 0),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
