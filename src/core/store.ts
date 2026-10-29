/**
 * Store port. Documents are flat JSON objects in named collections.
 * The shape fits document stores and SQL alike: equality filters, one
 * orderBy, a limit, cursor paging. No joins.
 */
export type Scalar = string | number | boolean | null;
export type Doc = Record<string, unknown>;

export interface Query {
  /** Equality filters on top-level scalar fields. */
  where?: Record<string, Scalar>;
  /** One sort field. Ties break by id, in the same direction. */
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
  /** Opaque value from a previous page. */
  cursor?: string;
}

export interface Page {
  items: { id: string; doc: Doc }[];
  nextCursor: string | null;
}

export interface Store {
  get(collection: string, id: string): Promise<Doc | null>;
  /** Insert or replace. */
  put(collection: string, id: string, doc: Doc): Promise<void>;
  /** Insert only. Returns false when the id exists. Atomic. */
  create(collection: string, id: string, doc: Doc): Promise<boolean>;
  /** Replace only when the stored doc still equals `expected`. Equality is structural: key order does not matter. Atomic. */
  replaceIf(collection: string, id: string, expected: Doc, next: Doc): Promise<boolean>;
  delete(collection: string, id: string): Promise<void>;
  /** Delete many ids in one round trip where the backend allows. Missing ids are ignored. An empty list does nothing. */
  deleteMany(collection: string, ids: string[]): Promise<void>;
  query(collection: string, query?: Query): Promise<Page>;
}

export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 50;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("limit must be an integer of 1 or more");
  }
  return Math.min(limit, MAX_LIMIT);
}

export function encodeCursor(value: Scalar, id: string): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify([value, id]))));
}

export function decodeCursor(cursor: string): [Scalar, string] {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(escape(atob(cursor))));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[1] === "string" &&
      (parsed[0] === null || ["string", "number", "boolean"].includes(typeof parsed[0]))
    ) {
      return [parsed[0] as Scalar, parsed[1]];
    }
  } catch {
    // fall through
  }
  throw new RangeError("bad cursor");
}

function compare(a: Scalar, b: Scalar): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/** JSON with object keys sorted, so equal docs give equal text. Adapters that compare text use it. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function sameDoc(a: Doc, b: Doc): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** In-memory adapter. Also the reference for the contract suite. */
export class MemoryStore implements Store {
  private readonly data = new Map<string, Map<string, Doc>>();

  private coll(name: string): Map<string, Doc> {
    let c = this.data.get(name);
    if (!c) {
      c = new Map();
      this.data.set(name, c);
    }
    return c;
  }

  async get(collection: string, id: string): Promise<Doc | null> {
    const doc = this.coll(collection).get(id);
    return doc ? structuredClone(doc) : null;
  }

  async put(collection: string, id: string, doc: Doc): Promise<void> {
    this.coll(collection).set(id, structuredClone(doc));
  }

  async create(collection: string, id: string, doc: Doc): Promise<boolean> {
    const c = this.coll(collection);
    if (c.has(id)) return false;
    c.set(id, structuredClone(doc));
    return true;
  }

  async replaceIf(collection: string, id: string, expected: Doc, next: Doc): Promise<boolean> {
    const c = this.coll(collection);
    const current = c.get(id);
    if (!current || !sameDoc(current, expected)) return false;
    c.set(id, structuredClone(next));
    return true;
  }

  async delete(collection: string, id: string): Promise<void> {
    this.coll(collection).delete(id);
  }

  async deleteMany(collection: string, ids: string[]): Promise<void> {
    const c = this.coll(collection);
    for (const id of ids) c.delete(id);
  }

  async query(collection: string, query: Query = {}): Promise<Page> {
    const limit = clampLimit(query.limit);
    const field = query.orderBy?.field;
    const dir = query.orderBy?.direction === "desc" ? -1 : 1;
    const where = Object.entries(query.where ?? {});
    const key = (id: string, doc: Doc): Scalar => (field ? (doc[field] as Scalar) ?? null : id);
    let rows = [...this.coll(collection)]
      .filter(([, doc]) => where.every(([k, v]) => (doc[k] ?? null) === v))
      .sort(([ia, a], [ib, b]) => dir * (compare(key(ia, a), key(ib, b)) || compare(ia, ib)));
    if (query.cursor !== undefined) {
      const [cv, cid] = decodeCursor(query.cursor);
      const kind = (v: Scalar) => (v === null ? "null" : typeof v);
      // A cursor from another field type would give an arbitrary cut. Refuse it.
      if (rows.some(([id, doc]) => key(id, doc) !== null && cv !== null && kind(key(id, doc)) !== kind(cv))) {
        throw new RangeError("bad cursor");
      }
      rows = rows.filter(([id, doc]) => dir * (compare(key(id, doc), cv) || compare(id, cid)) > 0);
    }
    const slice = rows.slice(0, limit + 1);
    const hasMore = slice.length > limit;
    const items = slice.slice(0, limit).map(([id, doc]) => ({ id, doc: structuredClone(doc) }));
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(key(last.id, last.doc), last.id) : null,
    };
  }
}
