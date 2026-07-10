import { describe, it, expect } from "vitest";
import {
  SCALE_MIN,
  SCALE_MAX,
  SCALE_STEP,
  clampScale,
  nextScale,
  canScaleUp,
  canScaleDown,
} from "./scale.js";

// 크기 조절 순수 함수. 컴포넌트와 동일한 값을 산출하므로 렌더/PATCH 로 흘러갈 값을 여기서 확정한다.

describe("scale 상수", () => {
  it("서버 계약과 동일한 범위/스텝을 노출한다", () => {
    expect(SCALE_MIN).toBe(0.3);
    expect(SCALE_MAX).toBe(3.0);
    expect(SCALE_STEP).toBe(0.2);
  });
});

describe("clampScale", () => {
  it("범위를 벗어난 값을 경계로 가둔다", () => {
    expect(clampScale(0.1)).toBe(SCALE_MIN);
    expect(clampScale(9)).toBe(SCALE_MAX);
    expect(clampScale(1.4)).toBe(1.4);
  });

  it("숫자가 아니면 기본 크기 1.0 으로 본다", () => {
    expect(clampScale(undefined)).toBe(1);
    expect(clampScale(null)).toBe(1);
    expect(clampScale(NaN)).toBe(1);
  });
});

describe("nextScale", () => {
  it("한 스텝 키우거나 줄인다(부동소수 오차 없이 반올림)", () => {
    expect(nextScale(1, 1)).toBe(1.2);
    expect(nextScale(1, -1)).toBe(0.8);
    expect(nextScale(1.1, 1)).toBe(1.3);
  });

  it("최대/최소를 넘지 않고 경계로 클램프한다", () => {
    expect(nextScale(2.9, 1)).toBe(SCALE_MAX); // 3.1 → 3.0
    expect(nextScale(0.4, -1)).toBe(SCALE_MIN); // 0.2 → 0.3
    expect(nextScale(SCALE_MAX, 1)).toBe(SCALE_MAX);
    expect(nextScale(SCALE_MIN, -1)).toBe(SCALE_MIN);
  });

  it("scale 없는(레거시) 항목은 1.0 기준으로 계산한다", () => {
    expect(nextScale(undefined, 1)).toBe(1.2);
    expect(nextScale(undefined, -1)).toBe(0.8);
  });
});

describe("canScaleUp / canScaleDown", () => {
  it("경계에서만 각각 불가로 판정한다", () => {
    expect(canScaleUp(SCALE_MAX)).toBe(false);
    expect(canScaleUp(2.8)).toBe(true);
    expect(canScaleDown(SCALE_MIN)).toBe(false);
    expect(canScaleDown(0.5)).toBe(true);
  });

  it("기본 크기(1.0)에서는 양방향 모두 가능하다", () => {
    expect(canScaleUp(1)).toBe(true);
    expect(canScaleDown(1)).toBe(true);
    expect(canScaleUp(undefined)).toBe(true);
    expect(canScaleDown(undefined)).toBe(true);
  });
});
