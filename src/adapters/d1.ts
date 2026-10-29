import {
  canonicalJson,
  clampLimit,
  decodeCursor,
  encodeCursor,
  type Doc,
  type Page,
  type Query,
  type Scalar,
  type Store,
} from "../core/store.js";

/** The slice of the Cloudflare D1 binding this adapter uses. */
export interface D1Statement {
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): D1Statement };
  /** Runs the statements in one round trip, as one transaction. Takes statements from `bind`. */
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

// One batch is one Worker subrequest. Keep each batch small and bounded.
const BATCH_SIZE = 100;

const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SCHEMA = `CREATE TABLE IF NOT EXISTS notify_docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  doc TEXT NOT NULL,
  PRIMARY KEY (collection, id)
)`;

function field(name: string): string {
  if (!FIELD.test(name)) throw new RangeError("bad field name");
  return `json_extract(doc, '$.${name}')`;
}

function bindable(v: Scalar): string | number | null {
  return typeof v === "boolean" ? (v ? 1 : 0) : v;
}

const TYPES: Record<string, string[]> = {
  number: ["integer", "real"],
  string: ["text"],
  boolean: ["true", "false"],
};

// Indexes for the inbox list (by recipient, newest first) and the retention sweep (oldest first).
const INDEXES = [
  `CREATE INDEX IF NOT EXISTS notify_by_recipient ON notify_docs (collection, json_extract(doc, '$.recipientKey'), json_extract(doc, '$.createdAt'), id)`,
  `CREATE INDEX IF NOT EXISTS notify_by_created ON notify_docs (collection, json_extract(doc, '$.createdAt'), id)`,
];

/** Create the table and indexes. Safe to run on every start. */
export async function migrateD1(db: D1Like): Promise<void> {
  for (const sql of [SCHEMA, ...INDEXES]) await db.prepare(sql).bind().run();
}

/** Store adapter for Cloudflare D1. Run `migrateD1` once first. */
export class D1Store implements Store {
  constructor(private readonly db: D1Like) {}

  async get(collection: string, id: string): Promise<Doc | null> {
    const row = await this.db
      .prepare("SELECT doc FROM notify_docs WHERE collection = ? AND id = ?")
      .bind(collection, id)
      .first<{ doc: string }>();
    return row ? (JSON.parse(row.doc) as Doc) : null;
  }

  async put(collection: string, id: string, doc: Doc): Promise<void> {
    await this.db
      .prepare("INSERT OR REPLACE INTO notify_docs (collection, id, doc) VALUES (?, ?, ?)")
      .bind(collection, id, canonicalJson(doc))
      .run();
  }

  async create(collection: string, id: string, doc: Doc): Promise<boolean> {
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO notify_docs (collection, id, doc) VALUES (?, ?, ?)")
      .bind(collection, id, canonicalJson(doc))
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async replaceIf(collection: string, id: string, expected: Doc, next: Doc): Promise<boolean> {
    const res = await this.db
      .prepare("UPDATE notify_docs SET doc = ? WHERE collection = ? AND id = ? AND doc = ?")
      .bind(canonicalJson(next), collection, id, canonicalJson(expected))
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async delete(collection: string, id: string): Promise<void> {
    await this.db.prepare("DELETE FROM notify_docs WHERE collection = ? AND id = ?").bind(collection, id).run();
  }

  async deleteMany(collection: string, ids: string[]): Promise<void> {
    const sql = this.db.prepare("DELETE FROM notify_docs WHERE collection = ? AND id = ?");
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      await this.db.batch(ids.slice(i, i + BATCH_SIZE).map((id) => sql.bind(collection, id)));
    }
  }

  async query(collection: string, query: Query = {}): Promise<Page> {
    const limit = clampLimit(query.limit);
    const desc = query.orderBy?.direction === "desc";
    const key = query.orderBy ? field(query.orderBy.field) : "id";
    const conds = ["collection = ?"];
    const args: unknown[] = [collection];
    for (const [name, value] of Object.entries(query.where ?? {})) {
      if (value === null) conds.push(`${field(name)} IS NULL`);
      else {
        // Match the JSON type too, as the memory adapter does with ===.
        const types = TYPES[typeof value] ?? [];
        conds.push(`${field(name)} = ? AND json_type(doc, '$.${name}') IN (${types.map(() => "?").join(",")})`);
        args.push(bindable(value), ...types);
      }
    }
    if (query.cursor !== undefined) {
      const [cv, cid] = decodeCursor(query.cursor);
      if (query.orderBy && cv !== null) {
        const allowed = TYPES[typeof cv] ?? [];
        const marks = allowed.map(() => "?").join(",");
        const bad = await this.db
          .prepare(
            `SELECT 1 AS x FROM notify_docs WHERE ${conds.join(" AND ")} AND ${key} IS NOT NULL AND json_type(doc, '$.${query.orderBy.field}') NOT IN (${marks}) LIMIT 1`,
          )
          .bind(...args, ...allowed)
          .first();
        if (bad) throw new RangeError("bad cursor");
      }
      const idCmp = desc ? "<" : ">";
      if (!query.orderBy) {
        conds.push(`id ${idCmp} ?`);
        args.push(cid);
      } else if (cv === null) {
        // Nulls sort first. After a null row: asc keeps all non-null rows, desc keeps only later nulls.
        conds.push(desc ? `(${key} IS NULL AND id < ?)` : `(${key} IS NOT NULL OR id > ?)`);
        args.push(cid);
      } else if (desc) {
        conds.push(`(${key} < ? OR ${key} IS NULL OR (${key} = ? AND id < ?))`);
        args.push(bindable(cv), bindable(cv), cid);
      } else {
        conds.push(`(${key} > ? OR (${key} = ? AND id > ?))`);
        args.push(bindable(cv), bindable(cv), cid);
      }
    }
    const dir = desc ? "DESC" : "ASC";
    const sql = `SELECT id, doc FROM notify_docs WHERE ${conds.join(" AND ")} ORDER BY ${key} ${dir}, id ${dir} LIMIT ?`;
    const { results } = await this.db
      .prepare(sql)
      .bind(...args, limit + 1)
      .all<{ id: string; doc: string }>();
    const rows = results.slice(0, limit).map((r) => ({ id: r.id, doc: JSON.parse(r.doc) as Doc }));
    const last = rows[rows.length - 1];
    const lastKey = last && query.orderBy ? ((last.doc[query.orderBy.field] as Scalar) ?? null) : (last?.id ?? null);
    return {
      items: rows,
      nextCursor: results.length > limit && last ? encodeCursor(lastKey, last.id) : null,
    };
  }
}
