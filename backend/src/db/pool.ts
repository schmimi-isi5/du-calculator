import pg from "pg";
import { config } from "../config.js";

// A single shared pool for the process. `pg` handles connection reuse and
// queuing internally - no need to manage connections manually here.
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
