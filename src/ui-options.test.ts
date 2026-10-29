import { describe, expect, test } from "vitest";
import { ApiError } from "./sdk.js";
import { checkOptions, describeError } from "../ui/useNotifications.js";

const getToken = () => "t";
const ok = { baseUrl: "https://notify.example.com", getToken };

describe("ui options", () => {
  test.each([
    ["a good https option", ok, false],
    ["http on localhost", { ...ok, baseUrl: "http://127.0.0.1:8787" }, false],
    ["http on another host", { ...ok, baseUrl: "http://notify.example.com" }, true],
    ["a relative baseUrl", { ...ok, baseUrl: "/api" }, true],
    ["user info in baseUrl", { ...ok, baseUrl: "https://u:p@notify.example.com" }, true],
    ["no getToken", { baseUrl: ok.baseUrl }, true],
    ["pollMs 0", { ...ok, pollMs: 0 }, false],
    ["pollMs 50", { ...ok, pollMs: 50 }, true],
    ["pollMs NaN", { ...ok, pollMs: Number.NaN }, true],
    ["limit 0", { ...ok, limit: 0 }, true],
    ["limit 1000", { ...ok, limit: 1000 }, true],
    ["limit 2.5", { ...ok, limit: 2.5 }, true],
    ["limit 50", { ...ok, limit: 50 }, false],
  ])("%s", (_name, options, bad) => {
    if (bad) expect(() => checkOptions(options as never)).toThrow(TypeError);
    else expect(() => checkOptions(options as never)).not.toThrow();
  });

  test("a refused token is named, and other failures are not called success", () => {
    expect(describeError(new ApiError(401, "unauthorized"))).toBe("The token was not accepted.");
    expect(describeError(new ApiError(403, "forbidden"))).toBe("The token was not accepted.");
    expect(describeError(new ApiError(400, "bad"))).toBe("The server refused the request.");
    expect(describeError(new TypeError("fetch failed"))).toContain("could not be loaded");
  });
});
