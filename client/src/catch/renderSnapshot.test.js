import { describe, it, expect, vi } from "vitest";
import { computeFit, drawSnapshot } from "./renderSnapshot.js";

// 스냅샷 렌더러 순수 계산부 검증 (REQ-COLL-003). 실제 캔버스 픽셀은 jsdom 에서 검증 불가하므로
// (getContext 가 null) 스케일/오프셋 계산과 방어 로직을 단위로 검증한다.

describe("computeFit", () => {
  it("그림을 박스 안에 비율 유지로 맞추는 배율을 고른다(가로/세로 중 더 작은 쪽)", () => {
    // 300x200 그림을 220x150 박스(패딩 8)에 → avail 204x134.
    // 가로 배율 204/300≈0.68, 세로 134/200=0.67 → 더 작은 0.67 채택.
    const { scale } = computeFit(
      { width: 300, height: 200 },
      { width: 220, height: 150 },
      8,
    );
    expect(scale).toBeCloseTo(134 / 200, 5);
  });

  it("맞춘 그림을 박스 중앙에 배치하는 오프셋을 계산한다", () => {
    const { scale, offsetX, offsetY } = computeFit(
      { width: 100, height: 100 },
      { width: 200, height: 200 },
      0,
    );
    expect(scale).toBe(2); // 100→200
    // 200x200 그림이 박스를 꽉 채우므로 오프셋 0.
    expect(offsetX).toBe(0);
    expect(offsetY).toBe(0);
  });

  it("width/height 가 없는 그림은 기본 300x200 로 가정한다", () => {
    const { scale } = computeFit({}, { width: 300, height: 200 }, 0);
    expect(scale).toBe(1);
  });
});

describe("drawSnapshot", () => {
  it("캔버스가 null 이면 아무 것도 하지 않는다", () => {
    expect(() =>
      drawSnapshot(null, { strokes: [] }, { width: 100, height: 100 }),
    ).not.toThrow();
  });

  it("2D 컨텍스트 미지원(getContext=null)이면 조용히 무시한다", () => {
    const canvas = { getContext: () => null };
    expect(() =>
      drawSnapshot(canvas, { strokes: [] }, { width: 100, height: 100 }),
    ).not.toThrow();
  });

  it("컨텍스트가 있으면 각 획을 moveTo/lineTo/stroke 로 그린다", () => {
    const ctx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const canvas = { getContext: () => ctx };
    const drawing = {
      width: 100,
      height: 100,
      strokes: [
        { color: "#c0392b", width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
      ],
    };
    drawSnapshot(canvas, drawing, { width: 100, height: 100 });

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(10, 10);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.strokeStyle).toBe("#c0392b");
  });
});
