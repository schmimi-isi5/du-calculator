# ISIFIVE DU Calculator

Analyzes a real git repository and a customer requirement, and produces a deterministic
Development Unit (DU) estimate grounded in AI-generated, evidence-based analysis.

The AI **analyzes and scores**; the application **decides**. The eight scoring dimensions,
their evidence, confidence, and bilingual (EN/DE) rationale come from the LLM - the weighted
score, DU class, Development Unit count, and price are computed deterministically in
`backend/src/scoring/duEngine.ts` and never stated by the model itself. Every scored requirement
is persisted with the repository snapshot it was scored against, forming a traceable history of
which requirement led to which DU decision.

See `CLAUDE.md` for the full architecture, stack, and conventions.

## Quick Start (local, without Docker)

```bash
# Backend
cd backend
npm install
cp env.example .env   # fill in ANTHROPIC_API_KEY and DATABASE_URL (a local Postgres)
npm run dev            # http://localhost:4000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev             # http://localhost:5173, proxies /api to the backend
```

## Quick Start (Docker Compose)

```bash
cp env.example .env     # fill in POSTGRES_PASSWORD and ANTHROPIC_API_KEY
docker compose up --build
# App: http://localhost:8080
```

This starts three services: `postgres`, `backend`, and `frontend` (nginx serving the built
SPA and proxying `/api/*` to `backend`). Postgres data persists in the `postgres_data` volume.

## Deploying to Coolify

1. Create a new **Docker Compose** resource in Coolify pointing at this repository.
2. Coolify will use `docker-compose.yml` at the repo root as-is.
3. Set these as environment variables in Coolify's UI (no `.env` file needed there):
   - `POSTGRES_PASSWORD` (required)
   - `ANTHROPIC_API_KEY` (required)
   - `POSTGRES_USER`, `POSTGRES_DB`, `PRICE_PER_DU`, `FRONTEND_PORT` (all optional, have defaults)
4. Deploy. The `backend` service runs its own schema setup on startup - no separate migration step.

## Tests

```bash
cd backend
npm test          # Vitest - deterministic DU Engine, filtering rules, input validation
npm run typecheck
```

The AI integration itself is verified by running the app against a real repository and a real
`ANTHROPIC_API_KEY` - there is no mocked repository or AI response anywhere in this codebase.

---

*This repository originated from the team's shared CLAUDE.md/rules template; see `.claude/rules/`
for the underlying engineering conventions this project follows.*
