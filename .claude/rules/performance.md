# Performance & Scalability

These are **principles**, not values. Each maps to a mechanism that differs per stack (database
engine, language, framework, runtime) — the rule states *what to bound and what to verify*, you fill
in the *how* for your stack. Overarching rule: **measure, don't guess.**

## Core principles

- **Measure before you tune — measure one unit, then extrapolate the fleet.** Guessing is unreliable;
  measure a single instance's real footprint (memory, connections, cold start) and multiply by the
  expected number of instances. Estimates are routinely off by multiples.
- **Bound demand on shared backing services.** Any shared, stateful dependency (database, broker,
  cache, rate-limited API) has a finite ceiling. Ensure `instances × per-instance pool size ≤ backend
  ceiling × safety factor`. Size pools explicitly — never leave the default multiplied by fleet size
  to chance. When instances outgrow the ceiling, put a pooler/proxy in front instead of raising limits
  forever.
- **Bound each deployment unit.** Give every unit (container, pod, VM, process, function) explicit
  memory/CPU limits sized from its measured baseline plus headroom, so one runaway can't starve its
  neighbours or take down the host.
- **Ship lean runtime artifacts.** Strip build-time weight (dev dependencies, source, toolchains) from
  what runs in production — smaller artifacts mean less memory, faster cold starts, and a smaller
  attack surface. (multi-stage builds, tree-shaking, AOT/compiled output, slim/distroless base images).
- **Know the per-instance floor; fleet cost is linear in instance count.** An architecture that adds a
  fixed number of always-on processes per app doesn't scale for free. Know each app's floor (memory,
  connections, disk) and weigh shared vs. per-tenant components.
- **Steady-state ≠ burst; know your single points.** Idle behaviour rarely reveals the ceiling —
  ceilings are hit under concurrency. Load-test the burst, not the idle. Identify components shared by
  everything (one database/auth/proxy for all) and plan HA/sharding before they saturate.

## Database

The single hardest-to-generalize area: *which* columns to index depends entirely on the app's real
queries — the rule can only tell you to index your access patterns and verify on the plan, never
prescribe specific indexes.

- **Index what you filter, join, and sort on** — `WHERE`, `JOIN`, and `ORDER BY` columns, plus foreign
  key columns. For composite indexes, column order must match the query's predicates. Add covering
  indexes for hot read paths.
- **Indexes are not free.** Each one slows writes and costs storage. Index for *real* access patterns,
  not speculatively; drop unused indexes.
- **Avoid N+1 queries.** Batch, join, or eager-load instead of querying inside a loop; watch ORM lazy
  loading.
- **Bound result sets.** Paginate or limit every list query — an unbounded `SELECT` scales with data
  growth, not with the page.
- **Select only the columns you need.** Less I/O, and it enables covering indexes.
- **Read the query plan.** Use `EXPLAIN`/`ANALYZE` (or the engine's equivalent) on hot and slow
  queries; a full table scan on a large table is the warning sign — don't guess.
- **Keep transactions short.** Long transactions cause lock contention, a common scaling killer.
- **Use parameterized queries.** Also enables server-side plan caching (and prevents injection — see
  `security.md`).
- **Build indexes online on large tables.** Adding an index can lock the table; use the engine's
  concurrent/online index build during migrations (e.g. `CREATE INDEX CONCURRENTLY`).

## Questions to answer per project

- What shared backing services exist, and what is each one's connection/throughput ceiling? Do the
  client pools sum to under it, with headroom?
- Is every deployment unit memory/CPU-bounded?
- Is the per-instance footprint **measured** (not estimated) and extrapolated to the target fleet size?
- Is the runtime artifact stripped of build-time weight?
- Are all filtered/joined/sorted/foreign-key columns indexed — and verified on the query plan?
- Is every list query paginated? Are there any N+1 paths?
- Which components are single points shared by everything, and how do they behave under burst?
