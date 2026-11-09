import { describe, expect, it } from "vitest";
import { isTelegramLink, parseInitData } from "./telegram";

describe("parseInitData", () => {
  it("extracts user, start param and auth date", () => {
    const raw = new URLSearchParams({
      user: JSON.stringify({ id: 42, first_name: "Иван", username: "ivan" }),
      start_param: "ref_ab12",
      auth_date: "1700000000",
      hash: "abc",
    }).toString();
    const parsed = parseInitData(raw);
    expect(parsed.user?.id).toBe(42);
    expect(parsed.user?.first_name).toBe("Иван");
    expect(parsed.startParam).toBe("ref_ab12");
    expect(parsed.authDate).toBe(1700000000);
  });

  it("handles empty and malformed data", () => {
    expect(parseInitData("")).toEqual({ user: null, startParam: null, authDate: null });
    expect(parseInitData("user=%7Bbroken").user).toBeNull();
    expect(parseInitData(`user=${encodeURIComponent(JSON.stringify({ name: "x" }))}`).user).toBeNull();
  });
});

describe("isTelegramLink", () => {
  it("recognizes t.me links", () => {
    expect(isTelegramLink("https://t.me/channel")).toBe(true);
    expect(isTelegramLink("https://telegram.me/bot?start=1")).toBe(true);
    expect(isTelegramLink("https://example.com/t.me")).toBe(false);
    expect(isTelegramLink("not a url")).toBe(false);
  });
});
