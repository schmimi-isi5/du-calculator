<!-- Shared engineering conventions live in .claude/rules/ — see README for the layout. -->

## Project Overview

- **Project Name**: ISIFIVE DU Calculator
- **Description**: Analyzes a real git repository and a customer requirement, produces an evidence-based technical profile and Requirement Impact Analysis via an LLM, and deterministically computes a Development Unit (DU) class, count, and price from the AI's per-dimension scores. The AI analyzes and scores; the application decides the DU. Before scoring, an Assumption & Clarification Engine resolves as much as possible itself (facts, safe derivations, documented assumptions) and only asks the user a small, prioritized set of questions that would genuinely change the result. Every scoring decision is persisted with the requirement, resolved context, and assumptions that produced it, forming a traceable history.

## Tech Stack

- **Backend**: Node.js 22, TypeScript, Express, `simple-git` (real git clone/read), `@anthropic-ai/sdk` + Zod (structured AI output), `pg` (Postgres, no ORM)
- **Frontend**: React 18 + Vite, plain CSS (ISIFIVE branding: `#61a60e` / `#007481`)
- **Database**: PostgreSQL 16 (repository snapshots + scoring history; raw file excerpts used during scoring stay in-memory only, never persisted)
- **AI Provider**: swappable via the `AIProvider` interface (`backend/src/ai/getAIProvider.ts`). Repository analysis uses the single legacy `AI_PROVIDER` pointer (`anthropic` default, or `openai`/`openrouter`/`local`). Every other AI call (context resolution, scoring) is chosen **per requirement** from the central Model Registry (`backend/src/domain/models.ts`) spanning Anthropic, OpenAI, DeepSeek, Google Gemini, Alibaba Qwen, local Ollama, and OpenRouter (an operator-configured gateway to many more models, see below) - see the "Multi-LLM Model Registry" convention below. Every call is logged with tokens and estimated cost (`backend/src/ai/pricing.ts`, `store/AIUsageStore.ts`), viewable in the frontend's "KI-Kosten" tab
- **Infrastructure**: Docker Compose (Postgres + backend + nginx-served frontend), deployable as-is on Coolify

## Project Structure

```
backend/
  src/
    ai/         AIProvider interface, AnthropicProvider, OpenAICompatibleProvider, prompts (incl. context resolution), pricing, usageTracker, providerAvailability, llmErrors
    api/        Express routes (repository, requirement-context, requirement/scoring, history, ai-usage)
    context/    Repository file filtering + budgeted context building
    db/         Postgres connection pool + schema/migration
    domain/     Shared types and Zod schemas
    git/        GitRepositoryService (real clone/read), input validation
    scoring/    Deterministic DU Engine + clarificationGate (assumption/clarification orchestration)
    store/      PostgresScoringStore (snapshots, requirement contexts, scoring results) + AIUsageStore (cost log)
frontend/
  src/
    api/        Fetch client for the backend
    components/ RepositoryPanel, RequirementPanel, RequirementContextPanel, ScoringPanel, ResultHero, HistoryPanel, AIUsageDashboard
docker-compose.yml   Postgres + backend + frontend, Coolify-deployable as-is
```

## Essential Commands

- **Install dependencies**: `cd backend && npm install`, `cd frontend && npm install`
- **Run locally (backend)**: `cd backend && cp env.example .env` (fill in `DATABASE_URL` and the credential for whichever `AI_PROVIDER` you use - `ANTHROPIC_API_KEY` by default), then `npm run dev`
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
- Domain history (repository snapshots, requirement contexts, scoring results) is persisted in Postgres via `ScoringStore`, including the file excerpts a repository was analyzed with - so an already-analyzed repository can be reused for a new requirement without re-cloning or re-running the AI analysis.
- Backend fails fast on invalid/missing required configuration (`DATABASE_URL`) at startup; AI provider credentials/model are the one exception, checked lazily by `getAIProvider()` on first AI call, since cloning a repository doesn't need one.
- Every AI call is priced and logged to `ai_usage_log` regardless of provider (`ai/usageTracker.ts`). A (provider, model) pair with no known price (e.g. an unlisted OpenRouter model, no `AI_CUSTOM_INPUT_PRICE_PER_MTOK`/`AI_CUSTOM_OUTPUT_PRICE_PER_MTOK` set) is logged with `costUsd: null` - shown as "unknown" in the dashboard, never guessed. Cache economics (`ai/pricing.ts`) are provider-specific, not a shared constant - Anthropic's explicit `cache_control` breakpoints (`AnthropicProvider`) carry a write surcharge and a steep read discount; OpenAI's automatic caching has neither.
- `ai/prompts.ts` builders return `{ system, stableContext, volatile }`, not a single string: `stableContext` (the repository profile + file excerpts, often tens of thousands of tokens) is byte-identical across a clarification round's repeated calls and across a re-score of the same requirement, so `AnthropicProvider` places an explicit 1-hour `cache_control` breakpoint after it.
- "A missing piece of information is not automatically a question." The AI classifies every information gap (FACT/DERIVED/ASSUMPTION/CLARIFICATION_REQUIRED/UNKNOWN_NON_BLOCKING, see `domain/types.ts`); `scoring/clarificationGate.ts` - pure, deterministic, no LLM calls - decides which of those actually become a question (capped per round, and no new question at all once a round ceiling is reached - both numbers come from the run's `QualityLevel`, see below). Assumptions are never presented as facts, always carry a confidence and a basis, and a user can CONFIRM/REJECT/EDIT one at any time (re-score explicitly afterward - editing an assumption does not auto-spend a new AI call).
- **`QualityLevel` (`quick` | `standard` | `thorough`, `domain/qualityLevels.ts`) is a per-run choice, not a fixed setting** - trades thoroughness for turnaround. Chosen once when a requirement is first submitted (`RequirementPanel`'s Qualitätsstufe picker: Grobschätzung/Standardschätzung/Feinschätzung), then fixed on that `RequirementContext` for its whole lifetime - every later clarification round and the final scoring reuse it (`RequirementContext.qualityLevel`/`ScoringResult.qualityLevel`), so a run never drifts between depths partway through. `QUALITY_PROFILES` maps each level to: effort for `resolveRequirementContext`/`assessRequirement` (Anthropic only - repository analysis has no per-run lever, since its file excerpts are fixed before any requirement exists), `maxClarificationsPerRound`/`maxResolutionRounds` for the clarification gate, and a `rationaleGuidance` prompt fragment that asks the model to visibly scale rationale depth, not just internal thinking time. `AIProvider.assessRequirement` merges impact analysis and DU scoring into one AI call regardless of level (splitting them bought no independence, only a second full generation pass) and the repository context budget (`RepositoryContextBuilder.ts`) is likewise level-independent (fixed at analysis time, before a requirement's chosen level exists).
- **Multi-LLM Model Registry (`domain/models.ts`) is a per-run pick, like `QualityLevel`** - fixed on the `RequirementContext`/`ScoringResult` for their whole lifetime once resolved (`RequirementContext.model`/`ScoringResult.model` always store a *concrete* registry id, never the literal `"auto"`). `MODEL_REGISTRY` is the single source of truth for every *curated* model the app can call - id, provider, wire-level `apiModel` string, display metadata, and pricing; nothing outside this file may hard-code a model string. Seven providers are supported, six of them (`openai`/`deepseek`/`google`/`qwen`/`ollama`/`openrouter`) sharing one `OpenAICompatibleProvider` adapter instance each (only baseURL/apiKey differ - see `ai/getAIProvider.ts` `getAIProviderForModel`), plus `AnthropicProvider` for `anthropic`. Each provider's availability depends only on its own credential (`ai/providerAvailability.ts`), fully decoupled from the legacy single-active `AI_PROVIDER` pointer, which still exists only for repository analysis (no per-run model choice there) and for the legacy `local` value (predating the registry - `ollama` is its registry-native equivalent). **OpenRouter is not part of the curated `MODEL_REGISTRY` array** - it's a gateway to hundreds of models, not a fixed catalog, so its entries are built dynamically from the operator-configured `OPENROUTER_MODELS` env var (`buildOpenRouterEntries`) and appended to `MODEL_REGISTRY` at request time (`buildEffectiveRegistry`, exposed via `ai/providerAvailability.ts` `currentModelRegistry()`); every registry-lookup function (`getModelById`, `listAvailableModels`, `isSelectableModel`, `resolveDefaultModel`, `resolveAutoModel`) takes the registry to search as an explicit trailing parameter (defaulting to the static `MODEL_REGISTRY` for tests) rather than hard-coding which list to use, specifically so the API layer can pass the OpenRouter-inclusive registry while `domain/models.ts` itself stays config-free and pure. `POST /api/requirement-context`'s `model` field accepts a concrete registry id (validated, rejected with 400 if unconfigured/unavailable), the literal `"auto"` (resolved via `resolveAutoModel`'s deterministic, non-LLM rule table - see `AUTO_ROUTING_RULES`), or nothing at all (resolved via `resolveDefaultModel`'s separate, simpler fallback chain - "no model given" and "explicitly optimize for me" are different intents, not the same code path). `privacyMode: "local-only"` forces the local Ollama model with no cloud fallback, ever, and is request-scoped only (never persisted - no DB migration needed for it). An explicit manual pick is never silently substituted for a different provider on failure (`resolveModelSelection` in `api/requirementContextService.ts`); only Auto's rule table may fall back. See `README.md`'s "Multi-LLM Model Selection" section for the full provider/model list and extension points.
