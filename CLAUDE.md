<!-- Shared engineering conventions live in .claude/rules/ — see README for the layout. -->

## Project Overview

- **Project Name**: ISIFIVE DU Calculator
- **Description**: Analyzes a real git repository and a customer requirement, produces an evidence-based technical profile and Requirement Impact Analysis via an LLM, and deterministically computes a Development Unit (DU) class, count, and price from the AI's per-dimension scores. The AI analyzes and scores; the application decides the DU. Every scoring decision is persisted with the requirement that produced it, forming a traceable history.

## Tech Stack

- **Backend**: Node.js 22, TypeScript, Express, `simple-git` (real git clone/read), `@anthropic-ai/sdk` + Zod (structured AI output), `pg` (Postgres, no ORM)
- **Frontend**: React 18 + Vite, plain CSS (ISIFIVE branding: `#61a60e` / `#007481`)
- **Database**: PostgreSQL 16 (repository snapshots + scoring history; raw file excerpts used during scoring stay in-memory only, never persisted)
- **AI Provider**: Anthropic Claude (`claude-opus-5`) via a swappable `AIProvider` interface - a future `KonturosProvider` can replace it without touching git access, DU mapping, or pricing
- **Infrastructure**: Docker Compose (Postgres + backend + nginx-served frontend), deployable as-is on Coolify

## Project Structure

```
backend/
  src/
    ai/         AIProvider interface, AnthropicProvider, prompts
    api/        Express routes (repository, requirement/scoring, history)
    context/    Repository file filtering + budgeted context building
    db/         Postgres connection pool + schema/migration
    domain/     Shared types and Zod schemas
    git/        GitRepositoryService (real clone/read), input validation
    scoring/    Deterministic DU Engine (weights, class/DU/price mapping)
    store/      PostgresScoringStore (persisted history) + RepositoryContextCache (transient)
frontend/
  src/
    api/        Fetch client for the backend
    components/ RepositoryPanel, RequirementPanel, ScoringPanel, ResultHero, HistoryPanel
docker-compose.yml   Postgres + backend + frontend, Coolify-deployable as-is
```

## Essential Commands

- **Install dependencies**: `cd backend && npm install`, `cd frontend && npm install`
- **Run locally (backend)**: `cd backend && cp env.example .env` (fill in `ANTHROPIC_API_KEY` and `DATABASE_URL`), then `npm run dev`
- **Run locally (frontend)**: `cd frontend && npm run dev`
- **Run tests**: `cd backend && npm test`
- **Typecheck**: `npm run typecheck` in either package
- **Build**: `npm run build` in either package
- **Full stack via Docker**: `cp env.example .env` at the repo root, fill in `POSTGRES_PASSWORD` and `ANTHROPIC_API_KEY`, then `docker compose up --build`
- **Deploy**: point Coolify at this repo's `docker-compose.yml`; set `POSTGRES_PASSWORD` and `ANTHROPIC_API_KEY` as environment variables in Coolify's UI (no `.env` file needed there)

## Project-Specific Conventions

- The AI never states a DU number, class, or price - only per-dimension scores (1-5), evidence, confidence, and descriptive text. `backend/src/scoring/duEngine.ts` is the only place DU/class/price are computed, and it is pure and fully unit-tested.
- Every AI-generated `summary`, `rationale`, and `overallAssessment` is bilingual (`{ en, de }`) - written independently in each language, not machine-translated. See `backend/src/domain/schemas.ts` and the `BILINGUAL_RULE` in `backend/src/ai/prompts.ts`.
- Repository content and AI evidence must be attributable: every `RepositoryFinding` carries a `VERIFIED | INFERRED | UNKNOWN` status per `backend/src/domain/types.ts`.
- Domain history (repository snapshots, scoring results) is persisted in Postgres via `ScoringStore`. The raw `RepositoryContext` (file excerpts sent to the AI) is intentionally NOT persisted - it lives only in `RepositoryContextCache` for the duration of a session, since it can be large and is cheap to rebuild by re-analyzing.
- Backend fails fast on invalid/missing required configuration (`DATABASE_URL`) at startup; `ANTHROPIC_API_KEY` is the one exception, checked lazily on first AI call, since cloning a repository doesn't need it.
