import { describe, it, expect } from "vitest";
import { validateDrawing, DRAWING_LIMITS } from "./validateDrawing.js";

// 그림 데이터 서버측 검증 (NFR-SEC-003, REQ-DRAW-004).
// 직렬화 포맷: 스트로크 기반 벡터.
//   { version:1, width, height, strokes:[{ color:'#rrggbb', width:num, points:[{x,y}...] }] }
// 서버는 클라이언트를 절대 신뢰하지 않고 형식/크기/최소성을 독립 검증한다.

// 유효한 최소 그림을 만든다(테스트 헬퍼).
function validDrawing(overrides = {}) {
  return {
    version: 1,
    width: 300,
    height: 200,
    strokes: [
      {
        color: "#112233",
        width: 3,
        points: [
          { x: 10, y: 10 },
          { x: 50, y: 40 },
          { x: 90, y: 20 },
        ],
      },
    ],
    ...overrides,
  };
}

describe("validateDrawing — 정상 케이스", () => {
  it("올바른 스트로크 그림을 통과시킨다", () => {
    expect(validateDrawing(validDrawing())).toEqual({
      valid: true,
      reason: null,
    });
  });
});

describe("validateDrawing — 빈/무효 그림 거부 (REQ-DRAW-004)", () => {
  it("strokes 가 없으면 empty 로 거부한다", () => {
    const res = validateDrawing(validDrawing({ strokes: [] }));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("empty");
  });

  it("점이 하나뿐이면(획 없음 수준) empty 로 거부한다", () => {
    const d = validDrawing({
      strokes: [{ color: "#000000", width: 2, points: [{ x: 5, y: 5 }] }],
    });
    const res = validateDrawing(d);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("empty");
  });

  it("바운딩 박스가 최소 크기 미달이면 too_small 로 거부한다", () => {
    const d = validDrawing({
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
    const res = validateDrawing(d);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("too_small");
  });
});

describe("validateDrawing — 형식 검증 / 주입 방지 (NFR-SEC-003)", () => {
  it("null/비객체 입력을 invalid_format 로 거부한다", () => {
    expect(validateDrawing(null).reason).toBe("invalid_format");
    expect(validateDrawing("draw").reason).toBe("invalid_format");
    expect(validateDrawing(42).reason).toBe("invalid_format");
  });

  it("version 이 1 이 아니면 invalid_format 로 거부한다", () => {
    expect(validateDrawing(validDrawing({ version: 2 })).reason).toBe(
      "invalid_format",
    );
  });

  it("width/height 가 비정상(음수/비정수/초과)이면 invalid_format", () => {
    expect(validateDrawing(validDrawing({ width: 0 })).reason).toBe(
      "invalid_format",
    );
    expect(validateDrawing(validDrawing({ height: -1 })).reason).toBe(
      "invalid_format",
    );
    expect(
      validateDrawing(validDrawing({ width: DRAWING_LIMITS.maxCanvas + 1 }))
        .reason,
    ).toBe("invalid_format");
  });

  it("좌표가 유한수가 아니면 invalid_format (NaN/Infinity/문자열)", () => {
    const bad = validDrawing({
      strokes: [
        {
          color: "#000000",
          width: 2,
          points: [
            { x: 10, y: 10 },
            { x: Number.NaN, y: 40 },
          ],
        },
      ],
    });
    expect(validateDrawing(bad).reason).toBe("invalid_format");

    const bad2 = validDrawing({
      strokes: [
        {
          color: "#000000",
          width: 2,
          points: [
            { x: 10, y: 10 },
            { x: "50", y: 40 },
          ],
        },
      ],
    });
    expect(validateDrawing(bad2).reason).toBe("invalid_format");
  });

  it("색상이 안전한 헥스 형식이 아니면 invalid_format (스크립트 주입 차단)", () => {
    const injection = validDrawing({
      strokes: [
        {
          color: "javascript:alert(1)",
          width: 2,
          points: [
            { x: 10, y: 10 },
            { x: 60, y: 60 },
          ],
        },
      ],
    });
    expect(validateDrawing(injection).reason).toBe("invalid_format");
  });

  it("스트로크 width 가 허용 범위를 벗어나면 invalid_format", () => {
    expect(
      validateDrawing(
        validDrawing({
          strokes: [
            {
              color: "#000000",
              width: 999,
              points: [
                { x: 10, y: 10 },
                { x: 60, y: 60 },
              ],
            },
          ],
        }),
      ).reason,
    ).toBe("invalid_format");
  });

  it("점 좌표가 캔버스 범위를 벗어나면 invalid_format", () => {
    const oob = validDrawing({
      strokes: [
        {
          color: "#000000",
          width: 2,
          points: [
            { x: 10, y: 10 },
            { x: 99999, y: 60 },
          ],
        },
      ],
    });
    expect(validateDrawing(oob).reason).toBe("invalid_format");
  });
});

describe("validateDrawing — 크기 상한 (NFR-SEC-003)", () => {
  it("직렬화 크기가 상한을 넘으면 too_large 로 거부한다", () => {
    // 스트로크/점 개수 상한은 지키되 직렬화 바이트만 초과하도록 구성한다.
    // (스트로크당 3000점 × 스트로크 4개 = 12000점 ≈ 200KB > 100KB)
    const makePoints = () => {
      const points = [];
      for (let i = 0; i < 3000; i += 1) {
        points.push({ x: (i % 290) + 1, y: (i % 190) + 1 });
      }
      return points;
    };
    const strokes = [];
    for (let s = 0; s < 4; s += 1) {
      strokes.push({ color: "#000000", width: 2, points: makePoints() });
    }
    const huge = validDrawing({ strokes });
    const res = validateDrawing(huge);
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("too_large");
  });

  it("스트로크 수가 상한을 넘으면 invalid_format 로 거부한다", () => {
    const strokes = [];
    for (let i = 0; i < DRAWING_LIMITS.maxStrokes + 1; i += 1) {
      strokes.push({
        color: "#000000",
        width: 2,
        points: [
          { x: 10, y: 10 },
          { x: 60, y: 60 },
        ],
      });
    }
    expect(validateDrawing(validDrawing({ strokes })).reason).toBe(
      "invalid_format",
    );
  });
});
