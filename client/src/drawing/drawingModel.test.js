import { describe, it, expect } from "vitest";
import {
  initialDrawingState,
  drawingReducer,
  toDrawing,
  validateDrawing,
  DRAWING_LIMITS,
  GUIDE_LIMITS,
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

describe("drawingReducer — ERASE_AT (지우개)", () => {
  // (0,0)→(100,0) 직선 스트로크를 확정한 상태를 만든다.
  function stateWithLine() {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "BEGIN_STROKE", x: 0, y: 0, width: 3 });
    for (const x of [25, 50, 75, 100]) {
      s = drawingReducer(s, { type: "ADD_POINT", x, y: 0 });
    }
    return drawingReducer(s, { type: "END_STROKE" });
  }

  it("반경 안의 점을 제거하고 획을 두 조각으로 분할한다", () => {
    const s = drawingReducer(stateWithLine(), {
      type: "ERASE_AT",
      x: 50,
      y: 0,
      radius: 10,
    });
    // 가운데(50,0)만 지워져 [0,25] / [75,100] 두 조각이 된다.
    expect(s.strokes).toHaveLength(2);
    expect(s.strokes[0].points.map((p) => p.x)).toEqual([0, 25]);
    expect(s.strokes[1].points.map((p) => p.x)).toEqual([75, 100]);
  });

  it("남는 점이 1개뿐인 조각은 버린다", () => {
    const s = drawingReducer(stateWithLine(), {
      type: "ERASE_AT",
      x: 30, // 25, 50 근방까지 넓게 지운다
      y: 0,
      radius: 24,
    });
    for (const stroke of s.strokes) {
      expect(stroke.points.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("반경 밖이면 아무것도 지우지 않는다", () => {
    const before = stateWithLine();
    const s = drawingReducer(before, { type: "ERASE_AT", x: 50, y: 150, radius: 10 });
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0].points).toHaveLength(5);
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
      tailFraction: 0.4,
      mouthFraction: 0.72,
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

  it("유효한 가이드 위치(꼬리/입)를 통과시킨다", () => {
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.3, mouthFraction: 0.7 })).valid,
    ).toBe(true);
  });

  it("가이드 필드가 하나만 있으면 invalid_format 으로 거부한다", () => {
    expect(validateDrawing(validDrawing({ tailFraction: 0.3 })).reason).toBe(
      "invalid_format",
    );
    expect(validateDrawing(validDrawing({ mouthFraction: 0.7 })).reason).toBe(
      "invalid_format",
    );
  });

  it("가이드 순서가 뒤집히거나 너무 붙으면 invalid_format 으로 거부한다", () => {
    // 입선이 꼬리선보다 왼쪽(뒤집힘)
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.7, mouthFraction: 0.3 })).reason,
    ).toBe("invalid_format");
    // 간격이 minGap 미만
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.5, mouthFraction: 0.55 })).reason,
    ).toBe("invalid_format");
  });

  it("가이드 위치가 허용 범위를 벗어나면 invalid_format 으로 거부한다", () => {
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.02, mouthFraction: 0.7 })).reason,
    ).toBe("invalid_format");
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.3, mouthFraction: 0.98 })).reason,
    ).toBe("invalid_format");
  });
});

describe("drawingReducer — 가이드 선(꼬리/입) 위치", () => {
  it("초기 상태는 기본 꼬리/입 위치를 가진다", () => {
    const s = initialDrawingState(300, 200);
    expect(s.tailFraction).toBeCloseTo(0.4);
    expect(s.mouthFraction).toBeCloseTo(0.72);
  });

  it("SET_TAIL_FRACTION 은 꼬리선을 옮기되 입선보다 minGap 이상 왼쪽으로 제한한다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "SET_TAIL_FRACTION", fraction: 0.25 });
    expect(s.tailFraction).toBeCloseTo(0.25);
    // 입선(0.72)에 붙이려 해도 minGap 만큼 떨어진 위치로 클램프된다.
    s = drawingReducer(s, { type: "SET_TAIL_FRACTION", fraction: 0.99 });
    expect(s.tailFraction).toBeCloseTo(s.mouthFraction - GUIDE_LIMITS.minGap);
  });

  it("SET_MOUTH_FRACTION 은 입선을 옮기되 꼬리선보다 minGap 이상 오른쪽으로 제한한다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "SET_MOUTH_FRACTION", fraction: 0.8 });
    expect(s.mouthFraction).toBeCloseTo(0.8);
    // 꼬리선(0.4)에 붙이려 해도 minGap 만큼 떨어진 위치로 클램프된다.
    s = drawingReducer(s, { type: "SET_MOUTH_FRACTION", fraction: 0.01 });
    expect(s.mouthFraction).toBeCloseTo(s.tailFraction + GUIDE_LIMITS.minGap);
  });

  it("가이드 위치는 min/max 범위로 클램프된다", () => {
    let s = initialDrawingState(300, 200);
    s = drawingReducer(s, { type: "SET_MOUTH_FRACTION", fraction: 5 });
    expect(s.mouthFraction).toBeCloseTo(GUIDE_LIMITS.max);
    s = drawingReducer(s, { type: "SET_TAIL_FRACTION", fraction: -5 });
    expect(s.tailFraction).toBeCloseTo(GUIDE_LIMITS.min);
  });
});
