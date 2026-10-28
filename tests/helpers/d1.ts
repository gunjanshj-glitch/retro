/**
 * A real SQLite behind the D1 interface, so Worker tests run the actual
 * migrations and the actual SQL rather than a hand-faked answer per query.
 * Only the surface the Worker uses is implemented: prepare/bind/first/run/all
 * and batch.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// Loaded at runtime: Vite does not know `node:sqlite` as a builtin and refuses to bundle it.
// (@types/node here predates it, so the little we use is typed by hand.)
type Sqlite = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...values: unknown[]): unknown;
    all(...values: unknown[]): unknown[];
    run(...values: unknown[]): { changes: number | bigint };
  };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Sqlite };

type Bound = (string | number | null | bigint)[];

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  const dir = path.resolve(__dirname, "../../workers/api/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(path.join(dir, file), "utf8"));
  }

  function statement(sql: string, values: Bound = []) {
    const st = {
      sql,
      values,
      bind(...v: unknown[]) {
        return statement(sql, v.map((x) => (x === undefined ? null : x)) as Bound);
      },
      async first<T>() {
        return (db.prepare(sql).get(...values) as T | undefined) ?? null;
      },
      async run() {
        const r = db.prepare(sql).run(...values);
        return { success: true, results: [], meta: { changes: Number(r.changes) } };
      },
      async all<T>() {
        return { success: true, results: db.prepare(sql).all(...values) as T[], meta: {} };
      },
    };
    return st;
  }

  const database = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };

  return { db, database: database as unknown as D1Database };
}
