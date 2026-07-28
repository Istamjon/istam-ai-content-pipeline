import "dotenv/config";
import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.env.DB_PATH || "./data/app.db");
const db = new Database(dbPath);
const today = new Date().toISOString().slice(0, 10);
// Active providers: nanobanana* + skywork*
// (cloudflare/horde removed from pipeline — legacy DB rows untouched)
const r = db
  .prepare(
    `DELETE FROM image_provider_usage
     WHERE date = ?
       AND provider IN ('nanobanana','nanobanana2','nanobanana3','skywork','skywork2','skywork3','skywork4','skywork5')`,
  )
  .run(today);
const r2 = db.prepare("DELETE FROM image_daily_usage WHERE date = ?").run(today);
console.log("cleared soft image budgets for", today, {
  provider_rows: r.changes,
  daily_rows: r2.changes,
});
db.close();
