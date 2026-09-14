// Minimal structured logging. No external dependency needed for an MVP -
// every log line is a single JSON object with timestamp, level, message,
// and context, which is enough to grep/ship to any log aggregator later.

type Level = "info" | "warn" | "error";

function log(level: Level, message: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};
