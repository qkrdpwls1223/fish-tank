import { describe, it, expect, vi } from "vitest";
import {
  DECOR_KINDS,
  isDecorKind,
  decorLabel,
  decorHitRadius,
  drawDecor,
} from "./decor.js";

// 장식 프리셋(데이터 주도). 종류 목록/라벨/히트반경/그리기 디스패치를 검증한다.
// 캔버스 2D 는 jsdom 에서 no-op 이므로 draw 호출은 예외 없이 안전해야 한다.

describe("decor 프리셋", () => {
  it("수초/바위/성 세 종류를 제공한다", () => {
    expect(DECOR_KINDS.map((d) => d.kind)).toEqual(["seaweed", "rock", "castle"]);
  });

  it("각 종류에 한글 라벨과 그리기 함수, 히트 반경이 있다", () => {
    for (const d of DECOR_KINDS) {
      expect(typeof d.label).toBe("string");
      expect(typeof d.draw).toBe("function");
      expect(d.hitRadius).toBeGreaterThan(0);
    }
  });

  it("isDecorKind 는 유효한 종류만 참으로 판정한다", () => {
    expect(isDecorKind("seaweed")).toBe(true);
    expect(isDecorKind("castle")).toBe(true);
    expect(isDecorKind("nope")).toBe(false);
  });

  it("decorLabel 은 종류의 한글 라벨을 돌려준다", () => {
    expect(decorLabel("seaweed")).toBe("수초");
    expect(decorLabel("rock")).toBe("바위");
    expect(decorLabel("castle")).toBe("성");
    // 알 수 없는 종류는 입력 그대로.
    expect(decorLabel("mystery")).toBe("mystery");
  });

  it("decorHitRadius 는 종류별 반경을, 미지정이면 기본값을 준다", () => {
    expect(decorHitRadius("castle")).toBeGreaterThan(0);
    expect(decorHitRadius("unknown")).toBe(30);
  });

  it("drawDecor 는 각 종류의 draw 를 좌표와 함께 호출한다", () => {
    // 실제 그리기 대신 draw 함수를 대체해 디스패치만 검증한다(2D 컨텍스트는 no-op).
    const ctx = {};
    // 유효 종류: 예외 없이 실행된다(내부 draw 가 ctx 를 자유롭게 다뤄도 mock 이므로 안전).
    const stub = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      stroke: vi.fn(), fillRect: vi.fn(), arc: vi.fn(), ellipse: vi.fn(),
      translate: vi.fn(), scale: vi.fn() };
    expect(() => drawDecor(stub, { kind: "seaweed", x: 10, y: 20 })).not.toThrow();
    expect(() => drawDecor(stub, { kind: "rock", x: 10, y: 20 })).not.toThrow();
    expect(() => drawDecor(stub, { kind: "castle", x: 10, y: 20 })).not.toThrow();
    expect(stub.save).toHaveBeenCalled();
    // 컨텍스트/항목 없음, 알 수 없는 종류는 조용히 무시한다.
    expect(() => drawDecor(null, { kind: "rock", x: 0, y: 0 })).not.toThrow();
    expect(() => drawDecor(ctx, null)).not.toThrow();
    expect(() => drawDecor(ctx, { kind: "nope", x: 0, y: 0 })).not.toThrow();
  });

  it("scale 이 있으면 기준점 중심으로 확대/축소 변환을 적용해 그린다", () => {
    const stub = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      stroke: vi.fn(), fillRect: vi.fn(), arc: vi.fn(), ellipse: vi.fn(),
      translate: vi.fn(), scale: vi.fn() };
    drawDecor(stub, { kind: "rock", x: 40, y: 60, scale: 2 });

    // (x,y)를 원점으로 옮겨 scale 한 뒤 되돌린다 → 바닥 중심 고정.
    expect(stub.translate).toHaveBeenCalledWith(40, 60);
    expect(stub.scale).toHaveBeenCalledWith(2, 2);
    expect(stub.translate).toHaveBeenCalledWith(-40, -60);
    expect(stub.save).toHaveBeenCalled();
    expect(stub.restore).toHaveBeenCalled();
  });

  it("scale 이 1(또는 없음)이면 변환 없이 그대로 그린다", () => {
    const stub = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
      lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), fill: vi.fn(),
      stroke: vi.fn(), fillRect: vi.fn(), arc: vi.fn(), ellipse: vi.fn(),
      translate: vi.fn(), scale: vi.fn() };
    drawDecor(stub, { kind: "rock", x: 40, y: 60, scale: 1 });
    expect(stub.scale).not.toHaveBeenCalled();
  });
});
