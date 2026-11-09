import { describe, expect, it } from "vitest";
import { parentOf, parseHash, tabOf } from "./router";

describe("parseHash", () => {
  it("parses root and nested paths", () => {
    expect(parseHash("").path).toBe("/");
    expect(parseHash("#/").segments).toEqual([]);
    expect(parseHash("#/admin/users/42").segments).toEqual(["admin", "users", "42"]);
  });

  it("treats Telegram launch parameters in the hash as the home screen", () => {
    const route = parseHash("#tgWebAppData=query_id%3DAA%26user%3D%257B%257D&tgWebAppVersion=8.0&tgWebAppPlatform=ios");
    expect(route.path).toBe("/");
    expect(tabOf(route)).toBe("home");
  });

  it("parses query parameters", () => {
    const route = parseHash("#/history?from=home");
    expect(route.path).toBe("/history");
    expect(route.query.get("from")).toBe("home");
  });
});

describe("tabOf", () => {
  it("detects root tabs only", () => {
    expect(tabOf(parseHash("#/"))).toBe("home");
    expect(tabOf(parseHash("#/tasks"))).toBe("tasks");
    expect(tabOf(parseHash("#/cases"))).toBe("cases");
    expect(tabOf(parseHash("#/profile"))).toBe("profile");
    expect(tabOf(parseHash("#/history"))).toBeNull();
    expect(tabOf(parseHash("#/admin"))).toBeNull();
  });
});

describe("parentOf", () => {
  it("returns logical parents for back navigation", () => {
    expect(parentOf(parseHash("#/history"))).toBe("/profile");
    expect(parentOf(parseHash("#/history?from=home"))).toBe("/");
    expect(parentOf(parseHash("#/withdraw"))).toBe("/");
    expect(parentOf(parseHash("#/notifications"))).toBe("/");
    expect(parentOf(parseHash("#/admin"))).toBe("/profile");
    expect(parentOf(parseHash("#/admin/finance"))).toBe("/admin");
    expect(parentOf(parseHash("#/admin/users/7"))).toBe("/admin/users");
  });
});
