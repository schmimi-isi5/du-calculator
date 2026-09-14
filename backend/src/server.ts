import cors from "cors";
import express from "express";
import { requirementRouter } from "./api/requirementRoutes.js";
import { repositoryRouter } from "./api/repositoryRoutes.js";
import { config } from "./config.js";
import { logger } from "./logging.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/repository", repositoryRouter);
app.use("/api/requirement", requirementRouter);

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
