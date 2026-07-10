import { describe, it, expect } from "vitest";
import { SCALE_MIN, SCALE_MAX, SCALE_DEFAULT, isValidScale } from "./scale.js";

// 내 어항 아이템 크기(scale) 상수·검증 계약.
// scale 은 유한한 숫자이며 [SCALE_MIN, SCALE_MAX] 범위 안이어야 한다.

describe("scale 상수", () => {
  it("경계 상수와 기본값을 노출한다", () => {
    expect(SCALE_MIN).toBe(0.3);
    expect(SCALE_MAX).toBe(3.0);
    expect(SCALE_DEFAULT).toBe(1.0);
  });
});

describe("isValidScale", () => {
  it("범위 내 유한한 숫자는 true 를 반환한다", () => {
    expect(isValidScale(0.3)).toBe(true);
    expect(isValidScale(1.0)).toBe(true);
    expect(isValidScale(3.0)).toBe(true);
    expect(isValidScale(1.75)).toBe(true);
  });

  it("범위를 벗어난 값은 false 를 반환한다", () => {
    expect(isValidScale(0.29)).toBe(false);
    expect(isValidScale(3.01)).toBe(false);
    expect(isValidScale(0)).toBe(false);
    expect(isValidScale(-1)).toBe(false);
    expect(isValidScale(100)).toBe(false);
  });

  it("유한하지 않거나 숫자가 아닌 값은 false 를 반환한다", () => {
    expect(isValidScale(Number.NaN)).toBe(false);
    expect(isValidScale(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidScale("1.0")).toBe(false);
    expect(isValidScale(null)).toBe(false);
    expect(isValidScale(undefined)).toBe(false);
  });
});
