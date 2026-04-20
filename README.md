# SCNV Agent — Supply Chain Network Visibility Architecture

The solution combines a user-friendly frontend dashboard, a backend orchestration system, and an AI intelligence layer. It integrates with enterprise data sources like SAP, process mining platforms (Celonis), and graph databases (Neo4j) to collect real-time process data. Together, these components enable automated monitoring, analysis, and intelligent decision-making for supply chain operations.

---

## Architecture Diagram

```mermaid
flowchart TD
    %% Styling
    classDef domainLayer fill:#fafafa,stroke:#d4af37,stroke-width:2px,color:#333;
    classDef component fill:#fff,stroke:#d4af37,stroke-width:1px,color:#000,rx:5px,ry:5px;
    classDef ext_system fill:#e6f3ff,stroke:#4a90e2,stroke-width:1px,color:#333,rx:5px,ry:5px;

    subgraph Frontend [Front End Visibility]
        Direction TB
        React[Vite + React Dashboard]:::component
        RFlow[Interactive Network\nVisualization]:::component
        Alerts[Process Insights\n& Alerts View]:::component
        Auth[Auth / SSO\n(Supabase)]:::component
        
        React --> RFlow
        React --> Alerts
        React --> Auth
    end
    class Frontend domainLayer

    subgraph Backend [Multi-Agent Workflow Engine]
        Direction LR
        API[FastAPI Gateway]:::component
        subgraph GraphEngine ["LangGraph Orchestrator"]
            Direction LR
            Router[Event Router]:::component
            Retrieve[Ingest & Merge\n(Neo4j Context)]:::component
            Analyst[SCM Analyst\n(Flow Check)]:::component
            Tier2[Tier 2 LLM\n(Escalation)]:::component
            Optimize[Deviation Engine\n(Optimizer)]:::component
            Miner[AI RCA Agent\n(Process Miner)]:::component
            
            Router -->|STO Sequence| Retrieve
            Retrieve --> Analyst
            Analyst --> Optimize
            Analyst -.->|Low Confidence| Tier2
            Tier2 -.-> Optimize
            Optimize --> Miner
        end
        API --> Router
    end
    class Backend domainLayer

    subgraph Data [Data Sources Layer]
        Direction LR
        SAP[SAP ERP Systems]:::ext_system
        Neo4j[Neo4j Graph Database]:::ext_system
        Celonis[Celonis EMS]:::ext_system
        Supa[Supabase PostgreSQL]:::ext_system
    end
    class Data domainLayer

    %% Connections
    Data -.->|Provides operational\nand planning data| Backend
    Backend -.->|Automates data ingestion,\n validates workflow,\ndetects deviations,\ngenerates AI insights| Frontend

```

---

## Architecture Components Deep-Dive

### 1. Data Sources Layer
**Provides operational, graph, and planning data.**
- **SAP ERP / Systems:** The primary enterprise data source streaming real-time master data regarding Stock Transfer Orders (STOs), Sales Orders, Plants, and Distribution Centers.
- **Neo4j Graph Database:** Calculates and serves topological network configurations and structural physical lane constraints. 
- **Celonis EMS:** Delivers deep insights into actual process deviations and execution bottlenecks based on event logs.
- **Supabase (PostgreSQL):** Robust relational memory storing user configurations, chat interactions, authentication states, and short-term transactional agent memory.

### 2. Multi-Agent Workflow Engine Layer
**Automates data ingestion, validates workflow logic, detects deviations, generates AI insights, and triggers alerts.**
- **FastAPI API Gateway:** Exposes secure RESTful connections enabling real-time bidirectional communication between the agentic logic and user interfaces.
- **LangGraph Orchestrator:** The deterministic core mapping logic routing events to specialized autonomous sub-agents:
  - **Router:** Parses event queues determining the optimal path (STO, SO, or Cron flows).
  - **SCM Analyst Agent:** Performs triage and verifies baseline physical capabilities of transfer orders.
  - **Tier 2 LLM:** Dynamic escalation agent resolving low-confidence or highly ambiguous planning events.
  - **Deviation Engine (Optimizer):** Computes financial optimizations, lead times, transportation limits, and associated carbon impacts.
  - **AI RCA Agent (Process Miner):** Checks the optimized “happy path” against actual Celonis historical compliance realities.

### 3. Front End Visibility Layer
**Displays real-time workflow insights through interactive dashboards.**
- **Vite + React.js Application:** A swift, modern web client built for high performance and scalability equipped with TailwindCSS.
- **Interactive Visualization (React Flow):** Translates complex supply chain mappings into visual, draggable networks detailing Nodes (DCs, Hubs) and Edges (lanes). 
- **Secure Authentication:** Integrated natively with Supabase for robust JWT-based SSO validation across all API boundaries.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React.js, Vite, React Flow, TailwindCSS |
| **Backend API** | Python 3.10+, FastAPI, Uvicorn |
| **Workflow / Logic** | LangChain, LangGraph, OpenAI (GPT-3.5/4) |
| **Database & Auth**| Supabase (PostgreSQL), Neo4j (Graph) |

---

## 🚀 Quick Run Guide
**Backend Initialization:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # (or .\venv\Scripts\activate on Windows)
pip install -r ../requirements.txt
uvicorn main:app --reload
```

**Frontend Initialization:**
```bash
cd SCNV_Frontend
npm install
npm run dev
```
*(Server opens locally on `localhost:8000` and `localhost:5173` respective to setup)*

---

*Hosts and runs AI workflows efficiently on backend Python servers, manages dynamic memory structures via Neo4j and PostgreSQL, and exposes safe network boundaries through FastAPI protocols.*
