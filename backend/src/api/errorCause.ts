/**
 * Extracts a loggable representation of an Error's `cause` chain (e.g. the
 * underlying SDK error an AIProviderError wraps), so the original failure
 * reason isn't swallowed behind a generic top-level error message.
 */
export function errorCause(err: unknown): string | unknown {
  if (!(err instanceof Error) || err.cause === undefined) return undefined;
  const cause = err.cause;
  return cause instanceof Error ? cause.stack ?? cause.message : cause;
}
