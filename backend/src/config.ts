// Central environment configuration. Fails fast at startup on missing/malformed
// required configuration (DATABASE_URL) - ANTHROPIC_API_KEY is the one
// exception, checked lazily by AnthropicProvider, since cloning a repository
// does not require an AI call.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: "${raw}" must be a positive integer.`);
  }
  return value;
}

function parsePriceEnv(name: string, fallback: number | null): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}: "${raw}" must be a non-negative number.`);
  }
  return value;
}

export const config = {
  port: parseIntEnv("PORT", 4000),
  databaseUrl: requireEnv("DATABASE_URL"),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  pricePerDU: parsePriceEnv("PRICE_PER_DU", 300),
  gitCloneTimeoutMs: parseIntEnv("GIT_CLONE_TIMEOUT_MS", 60_000),
  gitMaxRepoFiles: parseIntEnv("GIT_MAX_REPO_FILES", 5000),
};
