import cors from "cors";
import express from "express";
import { aiUsageRouter } from "./api/aiUsageRoutes.js";
import { requirementContextRouter } from "./api/requirementContextRoutes.js";
import { requirementRouter } from "./api/requirementRoutes.js";
import { repositoryRouter } from "./api/repositoryRoutes.js";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";
import { logger } from "./logging.js";

async function main(): Promise<void> {
  // Fail fast: if the schema can't be created/verified, don't start serving
  // requests against a database the app can't actually use.
  try {
    await runMigrations();
  } catch (err) {
    logger.error("Database migration failed at startup", { error: String(err) });
    process.exit(1);
  }

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/repository", repositoryRouter);
  app.use("/api/requirement-context", requirementContextRouter);
  app.use("/api/requirement", requirementRouter);
  app.use("/api/ai-usage", aiUsageRouter);

  // Centralized error handler: never leak internal stack traces to the
  // client, but always log server-side so failures are diagnosable.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error("Unhandled request error", { error: String(err) });
      res.status(500).json({ error: "Internal server error." });
    },
  );

  app.listen(config.port, () => {
    logger.info(`DU Calculator backend listening on port ${config.port}`);
  });
}

main();
