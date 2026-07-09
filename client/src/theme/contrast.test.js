import { describe, it, expect } from "vitest";
import { relativeLuminance, contrastRatio, meetsAA } from "./contrast.js";

// WCAG 2.1 색 대비 계산(순수 함수) 단위 테스트 (NFR-A11Y-001: 충분한 색 대비).
// 크롬/컨트롤/텍스트 색이 AA 기준(일반 4.5:1, 큰 텍스트 3:1)을 만족하는지 검증한다.

describe("relativeLuminance", () => {
  it("흰색의 상대 휘도는 1, 검은색은 0 이다", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });
});

describe("contrastRatio", () => {
  it("검은색 대 흰색 대비는 최대값 21:1 이다", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("색 순서를 바꿔도 대비 비율은 동일하다(대칭)", () => {
    const a = contrastRatio("#1f2933", "#ffffff");
    const b = contrastRatio("#ffffff", "#1f2933");
    expect(a).toBeCloseTo(b, 5);
  });

  it("같은 색끼리의 대비는 1:1 이다", () => {
    expect(contrastRatio("#3366cc", "#3366cc")).toBeCloseTo(1, 5);
  });
});

describe("meetsAA", () => {
  it("일반 텍스트는 4.5:1 이상이어야 통과한다", () => {
    expect(meetsAA("#767676", "#ffffff")).toBe(true); // 약 4.54:1
    expect(meetsAA("#999999", "#ffffff")).toBe(false); // 약 2.85:1
  });

  it("큰 텍스트(large=true)는 3:1 기준을 적용한다", () => {
    // 약 3.5:1 — 일반 기준(4.5)은 실패하지만 큰 텍스트 기준(3.0)은 통과.
    expect(meetsAA("#8a8a8a", "#ffffff", { large: false })).toBe(false);
    expect(meetsAA("#8a8a8a", "#ffffff", { large: true })).toBe(true);
  });
});
