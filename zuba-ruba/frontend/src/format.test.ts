import { describe, expect, it } from "vitest";
import { formatNumber, formatRub, formatStars, initials, isNegative, isZero, plural } from "./format";

describe("formatNumber", () => {
  it("uses comma as decimal separator and trims zeros", () => {
    expect(formatNumber("0.3")).toBe("0,3");
    expect(formatNumber("12.050")).toBe("12,05");
    expect(formatNumber("2.000")).toBe("2");
    expect(formatNumber("0")).toBe("0");
  });

  it("groups thousands for long integers", () => {
    expect(formatNumber("12345.5")).toBe("12 345,5");
    expect(formatNumber("1234")).toBe("1234");
  });

  it("formats negatives with a minus sign and never shows -0", () => {
    expect(formatNumber("-0.5")).toBe("−0,5");
    expect(formatNumber("-0.000")).toBe("0");
  });

  it("pads fraction when requested", () => {
    expect(formatNumber("250", 2)).toBe("250,00");
    expect(formatNumber("1.5", 2)).toBe("1,50");
  });

  it("returns unexpected input unchanged", () => {
    expect(formatNumber("abc")).toBe("abc");
  });
});

describe("formatStars", () => {
  it("appends the star glyph", () => {
    expect(formatStars("0.3")).toBe("0,3 ⭐");
  });

  it("applies explicit signs regardless of input sign", () => {
    expect(formatStars("0.3", { sign: "+" })).toBe("+0,3 ⭐");
    expect(formatStars("-0.3", { sign: "-" })).toBe("−0,3 ⭐");
    expect(formatStars("0.3", { sign: "-" })).toBe("−0,3 ⭐");
  });

  it("derives sign automatically", () => {
    expect(formatStars("1.2", { sign: "auto" })).toBe("+1,2 ⭐");
    expect(formatStars("-1.2", { sign: "auto" })).toBe("−1,2 ⭐");
    expect(formatStars("0", { sign: "auto" })).toBe("0 ⭐");
  });
});

describe("helpers", () => {
  it("formats rubles with two decimals", () => {
    expect(formatRub("1.5")).toBe("1,50 ₽");
    expect(formatRub("-132.5")).toBe("−132,50 ₽");
  });

  it("detects zero and negative values", () => {
    expect(isZero("0.000")).toBe(true);
    expect(isZero("0.001")).toBe(false);
    expect(isNegative("-1")).toBe(true);
    expect(isNegative("-0")).toBe(false);
  });

  it("chooses Russian plural forms", () => {
    expect(plural(1, "день", "дня", "дней")).toBe("день");
    expect(plural(3, "день", "дня", "дней")).toBe("дня");
    expect(plural(11, "день", "дня", "дней")).toBe("дней");
    expect(plural(22, "день", "дня", "дней")).toBe("дня");
    expect(plural(25, "день", "дня", "дней")).toBe("дней");
  });

  it("builds initials", () => {
    expect(initials("иван", "петров")).toBe("ИП");
    expect(initials("", null)).toBe("?");
  });
});
