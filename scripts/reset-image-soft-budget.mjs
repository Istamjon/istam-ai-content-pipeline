import "dotenv/config";
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.env.DB_PATH || "./data/app.db");
const db = new Database(dbPath);
const today = new Date().toISOString().slice(0, 10);
const r = db
  .prepare(
    `DELETE FROM image_provider_usage
     WHERE date = ?
       AND provider IN ('cloudflare','cloudflare2','cloudflare3','horde','nanobanana')`,
  )
  .run(today);
const r2 = db.prepare("DELETE FROM image_daily_usage WHERE date = ?").run(today);
console.log("cleared soft image budgets for", today, {
  provider_rows: r.changes,
  daily_rows: r2.changes,
});
db.close();
