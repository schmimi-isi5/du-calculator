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

## Multi-LLM Model Selection

Every requirement submission lets the user pick which model does the AI analysis and scoring -
a per-request choice, not a fixed deployment setting. The architecture lives in
`backend/src/domain/models.ts` (the Model Registry), `backend/src/ai/getAIProvider.ts`
(`getAIProviderForModel`, resolving a registry entry to a live `AIProvider` instance), and
`backend/src/ai/OpenAICompatibleProvider.ts` (one shared adapter for every OpenAI-wire-compatible
provider). No application code outside these files ever contains a provider-specific API call or a
hard-coded model string.

### Supported Providers

| Provider | Adapter | Notes |
|---|---|---|
| Anthropic | `AnthropicProvider` | Structured output via `beta.messages.parse` + Zod. |
| OpenAI | `OpenAICompatibleProvider` | Native OpenAI chat completions. |
| DeepSeek | `OpenAICompatibleProvider` | OpenAI-compatible endpoint (`api.deepseek.com`). |
| Google Gemini | `OpenAICompatibleProvider` | Google's official OpenAI-compatible endpoint. |
| Alibaba Qwen | `OpenAICompatibleProvider` | DashScope's OpenAI-compatible mode. |
| Ollama (local) | `OpenAICompatibleProvider` | Local server, no API key, configurable base URL. |

### Supported Models

The full, current list is always `MODEL_REGISTRY` in `backend/src/domain/models.ts` (also served
live at `GET /api/ai-usage/models`) - at the time of writing: DeepSeek V4.1 Flash, GPT-6 Astra,
GPT-5.6 Luna, Gemini 3.8 Flash, Claude Fable 5, Claude Sonnet 5, Claude Opus 5, Qwen3 Coder Next,
and Qwen3 Coder 30B (local, via Ollama).

### Environment Variables

See `env.example` for the full, commented list. Beyond the legacy `AI_PROVIDER`/`AI_MODEL`
single-active-provider pointer (still used for repository analysis, which has no per-request model
choice), each registry provider is configured independently and only needs its own key to appear in
the picker:

`DEEPSEEK_API_KEY`, `GOOGLE_AI_API_KEY`, `QWEN_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`OLLAMA_BASE_URL`, `DEFAULT_LLM_MODEL`, `LLM_ALLOW_PREMIUM_FALLBACK`.

A provider with no key configured simply has no available models in the picker (they're still shown,
disabled, in the UI) - nothing else breaks.

### Local Ollama Setup

Set `OLLAMA_BASE_URL` to your Ollama server's address (e.g. `http://192.168.10.139:11434`) - never
hard-coded, and inside Docker Compose `localhost` means the container itself, not your host machine.
No API key is needed. `GET /api/ai-usage/ollama-status` live-checks reachability (`/api/tags`) so the
UI can mark the local model unavailable without it disappearing from the picker.

### Manual Model Selection

Sending an explicit `model` id to `POST /api/requirement-context` always uses exactly that model -
never a different provider on failure (spec: no silent cloud fallback for a deliberate manual pick).
An id must be one this deployment can actually call right now (`isSelectableModel` in
`domain/models.ts`); otherwise the request is rejected with a 400 before any AI call is made.

### Auto Mode

Sending `model: "auto"` runs a small, deterministic, rule-based router
(`resolveAutoModel` in `domain/models.ts`) - no LLM ever decides which other LLM to use. Today's
rules: `localOnly` -> local Qwen (no exceptions); a large repository context -> Gemini 3.8 Flash; a
"thorough" quality level -> GPT-6 Astra; a "quick" quality level -> GPT-5.6 Luna; otherwise ->
DeepSeek V4.1 Flash. Omitting `model` entirely uses a *different*, simpler mechanism - the
zero-config default fallback chain (`resolveDefaultModel`) - since "nothing chosen" and "explicitly
optimize for me" are different intents.

### Cost Tracking

Every call is priced from `MODEL_REGISTRY`'s `inputPricePerMillion`/`outputPricePerMillion` fields
(`backend/src/ai/pricing.ts`) - prices live in exactly one place, never duplicated in a provider
adapter or a UI component. The local Ollama model is always priced at `$0` API cost - explicitly the
*API* cost, not total cost of ownership (electricity, hardware, ...). A model with no known price logs
its usage with `costUsd: null` ("unknown") rather than a guessed number.

### Adding another Provider

1. Add the provider name to `AIProviderName` (`backend/src/domain/types.ts`).
2. Add a `case` to `buildProviderInstance` in `ai/getAIProvider.ts` constructing an
   `OpenAICompatibleProvider` with that provider's base URL/API key (or a new adapter class if it
   isn't OpenAI-wire-compatible).
3. Add the credential/base-URL fields to `config.ts` and `ai/providerAvailability.ts`.
4. Add at least one `MODEL_REGISTRY` entry for it.

### Adding another Model

Add one entry to `MODEL_REGISTRY` in `backend/src/domain/models.ts` - for an already-supported
provider, that's the *only* change required; no other file needs to know the model exists.

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
