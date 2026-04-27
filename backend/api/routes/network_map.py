"""
Network Visibility Map API.

Builds graph data directly from PostgreSQL SAP tables so the frontend can
render the same D3 map without relying on a static JSON export.
"""

from collections import defaultdict
from datetime import datetime, timedelta
import os
from typing import Optional

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
        # 1) STO batch transfers out (source plant batch -> receiving plant batch).
        # Only 641 (cross-company GI) and 643 (same-company GI) — 644 is the reversal of 643 and must be excluded.
        # Destination is always umwrk (receiving plant); umlgo is a storage location field and must not be used here.
        sto_batch_rows = conn.execute(text("""
            SELECT
              m.charg AS batch_id,
              m.werks AS source_plant,
              m.umwrk AS receiving_plant,
              SUM(CASE WHEN m.menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN m.menge::numeric ELSE 0 END) AS qty_kg,
              COUNT(*) AS doc_count
            FROM public.mseg m
            WHERE COALESCE(m.charg, '') <> ''
              AND COALESCE(m.werks, '') <> ''
              AND COALESCE(m.umwrk, '') <> ''
              AND m.bwart IN ('641', '643')
            GROUP BY m.charg, m.werks, m.umwrk
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

        # 2) Production batch transformation (consumed batch -> produced batch by production order).
        # Pre-aggregate both sides in CTEs before joining to avoid Cartesian quantity double-counting.
        # Without CTEs, a single GI row joined to N GR document lines produces N copies of gi.menge,
        # causing SUM(gi.menge) to be multiplied by N — yielding wrong quantities.
        prod_batch_rows = conn.execute(text("""
            WITH gi_agg AS (
                SELECT
                  aufnr,
                  charg,
                  COALESCE(NULLIF(werks, ''), 'UNK') AS werks,
                  SUM(CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric ELSE 0 END) AS qty_kg,
                  COUNT(*) AS gi_count
                FROM public.mseg
                WHERE COALESCE(aufnr, '') <> ''
                  AND bwart = '261'
                  AND COALESCE(charg, '') <> ''
                GROUP BY aufnr, charg, COALESCE(NULLIF(werks, ''), 'UNK')
            ),
            gr_dist AS (
                SELECT DISTINCT
                  aufnr,
                  charg,
                  COALESCE(NULLIF(werks, ''), 'UNK') AS werks
                FROM public.mseg
                WHERE COALESCE(aufnr, '') <> ''
                  AND bwart = '101'
                  AND COALESCE(charg, '') <> ''
            )
            SELECT
              gi.charg AS src_batch,
              gi.werks  AS src_plant,
              gr.charg  AS dst_batch,
              gr.werks  AS dst_plant,
              gi.qty_kg,
              gi.gi_count AS doc_count
            FROM gi_agg gi
            JOIN gr_dist gr ON gr.aufnr = gi.aufnr
            ORDER BY gi.qty_kg DESC
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

        # Batch-to-customer linkage: which batch nodes were shipped to which customer.
        # Only movement 601 (goods issue to customer) — 602 is the reversal and must be excluded
        # to avoid mapping customers to batches that were actually returned/cancelled.
        batch_cust_rows = conn.execute(text("""
            SELECT
              kunnr,
              charg AS batch_id,
              werks,
              COUNT(*) AS doc_count
            FROM public.mseg
            WHERE COALESCE(kunnr, '') <> ''
              AND COALESCE(charg, '') <> ''
              AND COALESCE(werks, '') <> ''
              AND bwart = '601'
            GROUP BY kunnr, charg, werks
        """)).mappings().all()

        batch_customer_map = defaultdict(list)
        for r in batch_cust_rows:
            cust_code = _clean_code(r["kunnr"])
            batch_id = _clean_code(r["batch_id"])
            plant = _clean_code(r["werks"])
            if not cust_code or not batch_id or not plant:
                continue
            cust_id = _prefixed(cust_code, "CST_")
            batch_node_id = f"BAT_{batch_id}_{plant}"
            batch_customer_map[cust_id].append(batch_node_id)

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
        "batch_customer_map": {k: list(set(v)) for k, v in batch_customer_map.items()},
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


# ── Focused endpoints for the Network Visibility page ──────────────────────────

@router.get("/summary")
async def get_summary():
    """KPI counts: distinct vendors/plants/customers + total GR and GI volumes."""
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            row = conn.execute(text("""
                SELECT
                    (SELECT COUNT(DISTINCT lifnr)
                     FROM public.mseg
                     WHERE COALESCE(lifnr,'') <> '' AND bwart = '101') AS vendors,
                    (SELECT COUNT(DISTINCT werks)
                     FROM public.t001w
                     WHERE COALESCE(werks,'') <> '') AS plants,
                    (SELECT COUNT(DISTINCT kunnr)
                     FROM public.mseg
                     WHERE COALESCE(kunnr,'') <> '' AND bwart = '601') AS customers,
                    (SELECT COALESCE(SUM(
                         CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$'
                              THEN menge::numeric ELSE 0 END), 0)
                     FROM public.mseg WHERE bwart = '101') AS total_gr_kg,
                    (SELECT COALESCE(SUM(
                         CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$'
                              THEN menge::numeric ELSE 0 END), 0)
                     FROM public.mseg WHERE bwart = '601') AS total_gi_kg
            """)).mappings().first()
            return {
                "vendors": int(row["vendors"] or 0),
                "plants": int(row["plants"] or 0),
                "customers": int(row["customers"] or 0),
                "total_gr_kg": float(row["total_gr_kg"] or 0),
                "total_gi_kg": float(row["total_gi_kg"] or 0),
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/nodes")
async def get_nodes():
    """All vendor/plant/customer nodes (max 300 per type)."""
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            vendor_rows = conn.execute(text("""
                SELECT DISTINCT m.lifnr,
                    COALESCE(v.name1, '') AS name1,
                    COALESCE(v.land1, '') AS land1
                FROM public.mseg m
                LEFT JOIN public.lfa1 v ON v.lifnr = m.lifnr
                WHERE COALESCE(m.lifnr, '') <> '' AND m.bwart = '101'
                LIMIT 300
            """)).mappings().all()

            plant_rows = conn.execute(text("""
                SELECT werks,
                    COALESCE(name1, '') AS name1,
                    COALESCE(land1, '') AS land1
                FROM public.t001w
                WHERE COALESCE(werks, '') <> ''
                LIMIT 300
            """)).mappings().all()

            customer_rows = conn.execute(text("""
                SELECT DISTINCT m.kunnr,
                    COALESCE(c.name1, '') AS name1,
                    COALESCE(c.land1, '') AS land1
                FROM public.mseg m
                LEFT JOIN public.kna1 c ON c.kunnr = m.kunnr
                WHERE COALESCE(m.kunnr, '') <> '' AND m.bwart = '601'
                LIMIT 300
            """)).mappings().all()

            nodes = []
            for r in vendor_rows:
                code = _clean_code(r["lifnr"])
                nodes.append({"id": f"VDR_{code}", "label": r["name1"] or code, "type": "vendor", "country": r["land1"]})
            for r in plant_rows:
                code = _clean_code(r["werks"])
                nodes.append({"id": f"PLT_{code}", "label": r["name1"] or code, "type": "plant", "country": r["land1"]})
            for r in customer_rows:
                code = _clean_code(r["kunnr"])
                nodes.append({"id": f"CST_{code}", "label": r["name1"] or code, "type": "customer", "country": r["land1"]})

            return {"nodes": nodes}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/edges")
async def get_edges(material: Optional[str] = None):
    """
    Flows between nodes with KG quantities.
    Edge types: vendor_plant (101 GR), plant_plant (STO), plant_customer (601 GI).
    Optional ?material= filter.
    """
    engine = _get_engine()
    try:
        params = {"material": material}
        with engine.connect() as conn:
            vp_rows = conn.execute(text("""
                SELECT lifnr AS src, werks AS dst, 'vendor_plant' AS edge_type,
                    SUM(CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric ELSE 0 END) AS qty_kg,
                    COUNT(*) AS doc_count
                FROM public.mseg
                WHERE COALESCE(lifnr,'') <> '' AND COALESCE(werks,'') <> ''
                  AND bwart = '101'
                  AND (:material IS NULL OR matnr = :material)
                GROUP BY lifnr, werks
                ORDER BY qty_kg DESC
                LIMIT 500
            """), params).mappings().all()

            pp_rows = conn.execute(text("""
                SELECT werks AS src, umwrk AS dst, 'plant_plant' AS edge_type,
                    SUM(CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric ELSE 0 END) AS qty_kg,
                    COUNT(*) AS doc_count
                FROM public.mseg
                WHERE COALESCE(werks,'') <> '' AND COALESCE(umwrk,'') <> '' AND werks <> umwrk
                  AND (:material IS NULL OR matnr = :material)
                GROUP BY werks, umwrk
                ORDER BY qty_kg DESC
                LIMIT 500
            """), params).mappings().all()

            pc_rows = conn.execute(text("""
                SELECT werks AS src, kunnr AS dst, 'plant_customer' AS edge_type,
                    SUM(CASE WHEN menge ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN menge::numeric ELSE 0 END) AS qty_kg,
                    COUNT(*) AS doc_count
                FROM public.mseg
                WHERE COALESCE(werks,'') <> '' AND COALESCE(kunnr,'') <> ''
                  AND bwart = '601'
                  AND (:material IS NULL OR matnr = :material)
                GROUP BY werks, kunnr
                ORDER BY qty_kg DESC
                LIMIT 500
            """), params).mappings().all()

        edges = []
        for r in vp_rows:
            edges.append({
                "source": f"VDR_{_clean_code(r['src'])}",
                "target": f"PLT_{_clean_code(r['dst'])}",
                "type": r["edge_type"],
                "qty_kg": _safe_qty(r["qty_kg"]),
                "count": int(r["doc_count"] or 0),
            })
        for r in pp_rows:
            edges.append({
                "source": f"PLT_{_clean_code(r['src'])}",
                "target": f"PLT_{_clean_code(r['dst'])}",
                "type": r["edge_type"],
                "qty_kg": _safe_qty(r["qty_kg"]),
                "count": int(r["doc_count"] or 0),
            })
        for r in pc_rows:
            edges.append({
                "source": f"PLT_{_clean_code(r['src'])}",
                "target": f"CST_{_clean_code(r['dst'])}",
                "type": r["edge_type"],
                "qty_kg": _safe_qty(r["qty_kg"]),
                "count": int(r["doc_count"] or 0),
            })
        return {"edges": edges}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/materials")
async def get_materials():
    """Searchable material list for dropdown (distinct matnr from mseg)."""
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT DISTINCT matnr
                FROM public.mseg
                WHERE COALESCE(matnr, '') <> ''
                ORDER BY matnr
                LIMIT 1000
            """)).mappings().all()
            return {
                "materials": [
                    {"id": _clean_code(r["matnr"]), "label": _clean_code(r["matnr"])}
                    for r in rows
                ]
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/batches")
async def get_batches(material: Optional[str] = None, customer: Optional[str] = None):
    """
    Batch-level drill-down: batch → plant → customer with qty and posting date.
    Optional ?material= and ?customer= filters. Returns up to 200 rows.
    """
    engine = _get_engine()
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT
                    m.charg   AS batch_id,
                    m.werks   AS plant,
                    COALESCE(w.name1, '') AS plant_name,
                    m.kunnr   AS customer,
                    COALESCE(c.name1, '') AS customer_name,
                    m.matnr   AS material,
                    SUM(CASE WHEN m.menge ~ '^-?[0-9]+(\\.[0-9]+)?$'
                             THEN m.menge::numeric ELSE 0 END) AS qty_kg,
                    MAX(h.budat) AS doc_date
                FROM public.mseg m
                LEFT JOIN public.mkpf h ON h.mblnr = m.mblnr AND h.mjahr = m.mjahr
                LEFT JOIN public.t001w w ON w.werks = m.werks
                LEFT JOIN public.kna1  c ON c.kunnr  = m.kunnr
                WHERE m.bwart = '601'
                  AND COALESCE(m.charg,  '') <> ''
                  AND COALESCE(m.kunnr,  '') <> ''
                  AND (:material IS NULL OR m.matnr  = :material)
                  AND (:customer IS NULL OR m.kunnr  = :customer)
                GROUP BY m.charg, m.werks, w.name1, m.kunnr, c.name1, m.matnr
                ORDER BY MAX(h.budat) DESC NULLS LAST
                LIMIT 200
            """), {"material": material, "customer": customer}).mappings().all()

            return {
                "batches": [
                    {
                        "batch_id":      _clean_code(r["batch_id"]),
                        "plant":         _clean_code(r["plant"]),
                        "plant_name":    r["plant_name"],
                        "customer":      _clean_code(r["customer"]),
                        "customer_name": r["customer_name"],
                        "material":      _clean_code(r["material"]),
                        "qty_kg":        _safe_qty(r["qty_kg"]),
                        "doc_date":      str(r["doc_date"]) if r["doc_date"] else None,
                    }
                    for r in rows
                ]
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
