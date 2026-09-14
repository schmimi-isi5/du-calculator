# Code Quality

## Style & Structure

- Write clean, readable code. Optimize for the next developer's comprehension, not cleverness.
- Follow existing patterns in the codebase before introducing new ones — consistency beats "better" in isolation.
- Keep functions and methods focused on a single responsibility. If you need the word "and" to describe what it does, split it.
- Don't Repeat Yourself (DRY), but don't over-abstract either. Duplication is cheaper than the wrong abstraction — wait until you see the real pattern before extracting.
- Prefer explicit over implicit. Magic behavior is hard to debug and harder to onboard into.
- Delete dead code. Commented-out code is not a backup strategy — that's what version control is for.

## Naming

- Follow the language's defacto naming style — don't invent a custom one. Consistency with the ecosystem matters more than personal preference.
- Use descriptive names that reveal intent. A reader should understand purpose without jumping to the definition.
- Prefix booleans with `is`, `has`, `should`, `can` — it makes conditionals read like English.
- Avoid abbreviations unless universally understood (`id`, `url`, `api`). Saving a few characters isn't worth the cognitive cost.
- Constants should be visually distinct (e.g., `UPPER_SNAKE_CASE` in most languages) so they're immediately recognizable as fixed values.

## Error Handling

- Never swallow errors silently. An unlogged, unhandled error is a hidden bug.
- Use structured error types or codes for programmatic handling — don't rely on parsing error message strings.
- Include context in error messages: what was attempted, what went wrong, and what input caused it. "Something went wrong" helps no one.
- Distinguish between user-facing errors (friendly, actionable) and internal errors (detailed, for debugging).
- Fail fast on invalid state. The further bad data travels, the harder the bug is to trace.

## Logging

- Use structured logging (e.g., JSON format) with consistent fields: `timestamp`, `level`, `message`, and relevant context.
- Log levels have meaning — use them consistently: `error` (something is broken), `warn` (degraded but functional), `info` (key business events), `debug` (development only, never in production noise).
- Include correlation or request IDs so you can trace a single operation across services and logs.
- Never log sensitive data: passwords, tokens, PII, secrets. When in doubt, redact.
- Log at the right granularity — enough to diagnose issues, not so much that signal drowns in noise.
