import { describe, it, expect } from "vitest";
import { formatCaughtAt } from "./caughtMeta.js";

// 낚은 시각 표시 (REQ-COLL-004).

describe("formatCaughtAt", () => {
  it("ISO 시각을 사람이 읽을 수 있는 문자열로 포맷한다", () => {
    // 정오(UTC) 기준이면 어느 시간대에서든 연도가 동일하게 유지된다(시간대 무관 검증).
    const out = formatCaughtAt("2026-07-10T12:00:00.000Z");
    expect(typeof out).toBe("string");
    expect(out).toContain("2026");
    expect(out.length).toBeGreaterThan(0);
  });

  it("빈 값이면 빈 문자열을 돌려준다", () => {
    expect(formatCaughtAt("")).toBe("");
    expect(formatCaughtAt(undefined)).toBe("");
    expect(formatCaughtAt(null)).toBe("");
  });

  it("잘못된 시각 문자열이면 빈 문자열을 돌려준다", () => {
    expect(formatCaughtAt("not-a-date")).toBe("");
  });
});
