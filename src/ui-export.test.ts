import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };

// The build runs before the tests (`npm run ci:local`). These check that the ./ui export points at real files.
describe("ui export", () => {
  test("the exports map points at built files", () => {
    expect(pkg.exports["./ui"]).toEqual({ types: "./dist/ui.d.ts", import: "./dist/ui.js" });
    expect(pkg.exports["./ui.css"]).toBe("./dist/ui.css");
    for (const file of ["dist/ui.js", "dist/ui.d.ts", "dist/ui.css"]) expect(existsSync(file), file).toBe(true);
  });

  test("react and the design package stay outside the bundle, and only agd- classes ship", () => {
    const js = readFileSync("dist/ui.js", "utf8");
    expect(js).toMatch(/from ['"]react['"]/);
    expect(js).toMatch(/from ['"]agentic-design\/react['"]/);
    expect(readFileSync("dist/ui.css", "utf8")).not.toMatch(/\.ad-/);
    expect(js).not.toMatch(/["'`]ad-/);
  });
});
