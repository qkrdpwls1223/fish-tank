import { describe, it, expect } from "vitest";
import {
  initialDrawingState,
  drawingReducer,
  toDrawing,
  validateDrawing,
  DRAWING_LIMITS,
} from "./drawingModel.js";

// 자유 드로잉 상태 모델(순수 함수). 캔버스 렌더링과 분리해 로직만 검증한다.
// 커버: REQ-DRAW-001(자유 드로잉), REQ-DRAW-005(undo/clear), REQ-DRAW-004(검증).

describe("drawingReducer — 스트로크 캡처", () => {
  it("BEGIN_STROKE 는 첫 점을 가진 현재 스트로크를 시작한다", () => {
    const s = drawingReducer(initialDrawingState(300, 200), {
      type: "BEGIN_STROKE",
      x: 10,
      y: 20,
      color: "#000000",
      width: 3,
    });
    expect(s.current).not.toBeNull();
    expect(s.current.points).toEqual([{ x: 10, y: 20 }]);
    expect(s.current.color).toBe("#000000");
  });

  it("ADD_POINT 는 현재 스트로크에 점을 추가한다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 0, y: 0 });
    s = drawingReducer(s, { type: "ADD_POINT", x: 30, y: 40 });
    expect(s.current.points).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
    ]);
  });

  it("현재 스트로크가 없으면 ADD_POINT 를 무시한다", () => {
    const s0 = initialDrawingState(300, 200);
    const s1 = drawingReducer(s0, { type: "ADD_POINT", x: 30, y: 40 });
    expect(s1.current).toBeNull();
    expect(s1.strokes).toHaveLength(0);
  });

  it("END_STROKE 는 현재 스트로크를 확정 목록에 넣고 현재를 비운다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 0, y: 0 });
    s = drawingReducer(s, { type: "ADD_POINT", x: 30, y: 40 });
    s = drawingReducer(s, { type: "END_STROKE" });
    expect(s.current).toBeNull();
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].points).toHaveLength(2);
  });
});

describe("drawingReducer — undo / clear (REQ-DRAW-005)", () => {
  it("UNDO 는 마지막 확정 스트로크를 제거한다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 0, y: 0 });
    s = drawingReducer(s, { type: "ADD_POINT", x: 30, y: 40 });
    s = drawingReducer(s, { type: "END_STROKE" });
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 50, y: 50 });
    s = drawingReducer(s, { type: "ADD_POINT", x: 90, y: 90 });
    s = drawingReducer(s, { type: "END_STROKE" });
    expect(s.strokes).toHaveLength(2);
    s = drawingReducer(s, { type: "UNDO" });
    expect(s.strokes).toHaveLength(1);
  });

  it("UNDO 는 스트로크가 없으면 안전하게 무시한다", () => {
    const s = drawingReducer(initialDrawingState(300, 200), { type: "UNDO" });
    expect(s.strokes).toHaveLength(0);
  });

  it("CLEAR 는 모든 스트로크와 현재 스트로크를 비운다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 0, y: 0 });
    s = drawingReducer(s, { type: "ADD_POINT", x: 30, y: 40 });
    s = drawingReducer(s, { type: "END_STROKE" });
    s = drawingReducer(s, { type: "CLEAR" });
    expect(s.strokes).toHaveLength(0);
    expect(s.current).toBeNull();
  });
});

describe("toDrawing — 직렬화", () => {
  it("확정 스트로크로 version:1 그림 객체를 만든다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, {
      type: "BEGIN_STROKE",
      x: 10,
      y: 10,
      color: "#123456",
      width: 4,
    });
    s = drawingReducer(s, { type: "ADD_POINT", x: 80, y: 60 });
    s = drawingReducer(s, { type: "END_STROKE" });

    expect(toDrawing(s)).toEqual({
      version: 1,
      width: 300,
      height: 200,
      strokes: [
        {
          color: "#123456",
          width: 4,
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 60 },
          ],
        },
      ],
    });
  });
});

describe("validateDrawing — 클라이언트 사전 검증 (REQ-DRAW-004, NFR-SEC-003)", () => {
  function validDrawing(overrides = {}) {
    return {
      version: 1,
      width: 300,
      height: 200,
      strokes: [
        {
          color: "#000000",
          width: 3,
          points: [
            { x: 10, y: 10 },
            { x: 80, y: 60 },
          ],
        },
      ],
      ...overrides,
    };
  }

  it("정상 그림을 통과시킨다", () => {
    expect(validateDrawing(validDrawing())).toEqual({
      valid: true,
      reason: null,
    });
  });

  it("빈 그림(획 없음)을 empty 로 거부한다", () => {
    expect(validateDrawing(validDrawing({ strokes: [] })).reason).toBe("empty");
  });

  it("미세한 그림을 too_small 로 거부한다", () => {
    const tiny = validDrawing({
      strokes: [
        {
          color: "#000000",
          width: 2,
          points: [
            { x: 10, y: 10 },
            { x: 11, y: 11 },
          ],
        },
      ],
    });
    expect(validateDrawing(tiny).reason).toBe("too_small");
  });

  it("악성 색상을 invalid_format 으로 거부한다", () => {
    const bad = validDrawing();
    bad.strokes[0].color = "url(javascript:x)";
    expect(validateDrawing(bad).reason).toBe("invalid_format");
  });

  it("크기 상한 상수를 노출한다", () => {
    expect(DRAWING_LIMITS.maxBytes).toBeGreaterThan(0);
  });
});
