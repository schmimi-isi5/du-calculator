import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // config.ts fails fast on a missing DATABASE_URL; unit tests never talk
    // to a real database, so a placeholder is enough to satisfy the module
    // load without making DB tests depend on a running Postgres.
    env: { DATABASE_URL: "postgres://test:test@localhost:5432/test" },
  },
});
