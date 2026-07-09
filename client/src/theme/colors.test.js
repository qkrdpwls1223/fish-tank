import { describe, it, expect } from "vitest";
import { colors } from "./colors.js";
import { contrastRatio, AA_NORMAL, AA_LARGE } from "./contrast.js";

// 어항 앱 크롬/컨트롤 색 토큰이 WCAG 2.1 AA 대비를 만족하는지 검증한다 (NFR-A11Y-001).
// 사용자가 그린 캔버스 그림은 예외지만, 컨트롤/텍스트 색은 반드시 기준을 지켜야 한다.

describe("색 토큰 (NFR-A11Y-001)", () => {
  it("본문 텍스트는 표면 배경 위에서 일반 텍스트 AA(4.5:1)를 만족한다", () => {
    expect(contrastRatio(colors.text, colors.surface)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it("주요 버튼(primary)의 라벨은 버튼 배경 위에서 AA 를 만족한다", () => {
    expect(
      contrastRatio(colors.onPrimary, colors.primary),
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("삭제 버튼(danger)의 라벨은 표면 위에서 AA 를 만족한다", () => {
    expect(contrastRatio(colors.danger, colors.surface)).toBeGreaterThanOrEqual(
      AA_NORMAL,
    );
  });

  it("보조 안내 텍스트(muted)는 최소 큰 텍스트 기준(3:1) 이상이다", () => {
    expect(contrastRatio(colors.muted, colors.surface)).toBeGreaterThanOrEqual(
      AA_LARGE,
    );
  });
});
