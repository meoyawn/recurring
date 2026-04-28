# Project Spikes

Spikes are research notes, experiments, and decision records that may inform
implementation.

Prefer this layout:

- `backend/`: Go API, database, runtime, and server-side integration decisions.
- `frontend/`: SolidStart, Cloudflare Workers, UI runtime, and frontend tests.
- `observability/`: logging, metrics, tracing, and collector decisions.
- `product/`: user-facing feature and workflow research.
- `tooling/`: repository workflow, linting, task runners, and review tooling.

Each spike should state its current status near the top:

- `Status: exploratory`
- `Status: adopted`
- `Status: superseded`
