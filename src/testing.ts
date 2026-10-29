import { describe, expect, test } from "vitest";
import { encodeCursor, type Query, type Store } from "./core/store.js";

/**
 * Contract suite for the Store port. Run it on every adapter.
 * `make` must return a fresh store. When two calls share one backing
 * database, the concurrency tests use both handles.
 */
export function storeContract(name: string, make: () => Promise<Store>, makePeer?: (s: Store) => Promise<Store>): void {
  describe(`Store contract: ${name}`, () => {
    test("get returns null for a missing doc, put then get round-trips", async () => {
      const s = await make();
      expect(await s.get("c", "a")).toBeNull();
      await s.put("c", "a", { n: 1, s: "x", t: true, z: null });
      expect(await s.get("c", "a")).toEqual({ n: 1, s: "x", t: true, z: null });
    });

    test("collections are separate", async () => {
      const s = await make();
      await s.put("c1", "a", { v: 1 });
      expect(await s.get("c2", "a")).toBeNull();
    });

    test("create refuses an existing id and keeps the old doc", async () => {
      const s = await make();
      expect(await s.create("c", "a", { v: 1 })).toBe(true);
      expect(await s.create("c", "a", { v: 2 })).toBe(false);
      expect(await s.get("c", "a")).toEqual({ v: 1 });
    });

    test("only one of two racing creates wins", async () => {
      const s = await make();
      const peer = makePeer ? await makePeer(s) : s;
      const results = await Promise.all([s.create("c", "a", { v: 1 }), peer.create("c", "a", { v: 2 })]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    test("replaceIf swaps only when the doc is unchanged", async () => {
      const s = await make();
      await s.put("c", "a", { v: 1 });
      expect(await s.replaceIf("c", "a", { v: 9 }, { v: 2 })).toBe(false);
      expect(await s.replaceIf("c", "a", { v: 1 }, { v: 2 })).toBe(true);
      expect(await s.get("c", "a")).toEqual({ v: 2 });
      expect(await s.replaceIf("c", "missing", { v: 1 }, { v: 2 })).toBe(false);
    });

    test("replaceIf equality ignores key order", async () => {
      const s = await make();
      await s.put("c", "a", { a: 1, b: { x: 1, y: 2 } });
      expect(await s.replaceIf("c", "a", { b: { y: 2, x: 1 }, a: 1 }, { a: 2 })).toBe(true);
    });

    test("only one of two racing replaceIf calls wins", async () => {
      const s = await make();
      const peer = makePeer ? await makePeer(s) : s;
      await s.put("c", "a", { v: 0 });
      const results = await Promise.all([
        s.replaceIf("c", "a", { v: 0 }, { v: 1 }),
        peer.replaceIf("c", "a", { v: 0 }, { v: 2 }),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    test("delete removes a doc and ignores a missing one", async () => {
      const s = await make();
      await s.put("c", "a", { v: 1 });
      await s.delete("c", "a");
      await s.delete("c", "a");
      expect(await s.get("c", "a")).toBeNull();
    });

    test("deleteMany removes the listed docs, ignores missing ids, and keeps the rest", async () => {
      const s = await make();
      await s.deleteMany("c", []);
      for (const id of ["a", "b", "c", "d"]) await s.put("c", id, { v: 1 });
      await s.put("other", "a", { v: 1 });
      await s.deleteMany("c", ["a", "b", "missing", "a"]);
      expect((await s.query("c")).items.map((i) => i.id)).toEqual(["c", "d"]);
      expect(await s.get("other", "a")).toEqual({ v: 1 });
    });

    test("deleteMany handles more ids than one batch", async () => {
      const s = await make();
      const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
      await Promise.all(ids.map((id) => s.put("c", id, { v: 1 })));
      await s.put("c", "keep", { v: 1 });
      await s.deleteMany("c", ids);
      expect((await s.query("c")).items.map((i) => i.id)).toEqual(["keep"]);
    }, 30_000);

    test("query filters on equality, including null", async () => {
      const s = await make();
      await s.put("c", "a", { k: "x", r: null });
      await s.put("c", "b", { k: "x", r: 5 });
      await s.put("c", "c", { k: "y", r: null });
      const ids = async (where: Record<string, string | number | null>) =>
        (await s.query("c", { where, orderBy: { field: "k", direction: "asc" } })).items.map((i) => i.id).sort();
      expect(await ids({ k: "x" })).toEqual(["a", "b"]);
      expect(await ids({ k: "x", r: null })).toEqual(["a"]);
      expect(await ids({ r: 5 })).toEqual(["b"]);
      expect(await ids({ k: "none" })).toEqual([]);
    });

    test("equality filters respect the value type", async () => {
      const s = await make();
      await s.put("c", "t", { f: true, o: { a: 1 } });
      await s.put("c", "u", { f: 1, o: '{"a":1}' });
      await s.put("c", "v", { f: "1", o: [1] });
      const ids = async (where: Record<string, string | number | boolean | null>) =>
        (await s.query("c", { where })).items.map((i) => i.id).sort();
      expect(await ids({ f: true })).toEqual(["t"]);
      expect(await ids({ f: 1 })).toEqual(["u"]);
      expect(await ids({ f: "1" })).toEqual(["v"]);
      expect(await ids({ o: '{"a":1}' })).toEqual(["u"]);
    });

    test("query orders by one field and breaks ties by id", async () => {
      const s = await make();
      for (const [id, n] of [["b", 2], ["a", 2], ["c", 1], ["d", 3]] as const) await s.put("c", id, { n });
      const order = async (direction: "asc" | "desc") =>
        (await s.query("c", { orderBy: { field: "n", direction } })).items.map((i) => i.id);
      expect(await order("asc")).toEqual(["c", "a", "b", "d"]);
      expect(await order("desc")).toEqual(["d", "b", "a", "c"]);
    });

    test("cursor paging walks every doc once, in both directions", async () => {
      const s = await make();
      for (let i = 0; i < 7; i++) await s.put("c", `id${i}`, { n: i % 3 });
      for (const direction of ["asc", "desc"] as const) {
        const seen: string[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const page = await s.query("c", { orderBy: { field: "n", direction }, limit: 3, cursor });
          seen.push(...page.items.map((i) => i.id));
          cursor = page.nextCursor ?? undefined;
          pages++;
        } while (cursor);
        const whole = (await s.query("c", { orderBy: { field: "n", direction }, limit: 50 })).items.map((i) => i.id);
        expect(pages).toBe(3);
        expect(seen).toEqual(whole);
        expect(new Set(seen).size).toBe(7);
      }
    });

    test("cursor paging works with a filter and with no orderBy", async () => {
      const s = await make();
      for (let i = 0; i < 6; i++) await s.put("c", `id${i}`, { g: i % 2 === 0 ? "even" : "odd", n: i });
      const walk = async (query: Query) => {
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await s.query("c", { ...query, limit: 2, cursor });
          seen.push(...page.items.map((i) => i.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return seen;
      };
      expect(await walk({ where: { g: "even" }, orderBy: { field: "n", direction: "desc" } })).toEqual(["id4", "id2", "id0"]);
      expect(await walk({})).toEqual(["id0", "id1", "id2", "id3", "id4", "id5"]);
    });

    test("a cursor of the wrong type for the sort field is rejected", async () => {
      const s = await make();
      await s.put("c", "a", { n: 1 });
      await s.put("c", "b", { n: 2 });
      await expect(s.query("c", { orderBy: { field: "n", direction: "asc" }, cursor: encodeCursor("abc", "a") })).rejects.toThrow();
    });

    test("bad limit and bad cursor are rejected", async () => {
      const s = await make();
      await expect(s.query("c", { limit: 0 })).rejects.toThrow();
      await expect(s.query("c", { cursor: "%%%" })).rejects.toThrow();
    });

    test("stored docs are copies", async () => {
      const s = await make();
      const doc = { nested: { v: 1 } };
      await s.put("c", "a", doc);
      doc.nested.v = 2;
      const got = (await s.get("c", "a")) as typeof doc;
      expect(got.nested.v).toBe(1);
      got.nested.v = 3;
      expect(((await s.get("c", "a")) as typeof doc).nested.v).toBe(1);
    });
  });
}

/** Mail adapter that keeps messages in memory. For tests only. */
export { TestEmailAdapter } from "./delivery/email.js";
