import { describe, it, expect } from "vitest";
import {
  validateDrawing,
  DRAWING_LIMITS,
  RASTER_LIMITS,
} from "./validateDrawing.js";

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

describe("validateDrawing — 가이드 선(꼬리/입) 위치 (사용자 지정)", () => {
  it("가이드 필드가 없는 구버전 그림도 통과시킨다(하위호환)", () => {
    expect(validateDrawing(validDrawing()).valid).toBe(true);
  });

  it("유효한 꼬리/입 위치를 통과시킨다", () => {
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

  it("뒤집히거나 너무 붙은 가이드를 invalid_format 으로 거부한다", () => {
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.7, mouthFraction: 0.3 })).reason,
    ).toBe("invalid_format");
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.5, mouthFraction: 0.55 })).reason,
    ).toBe("invalid_format");
  });

  it("범위를 벗어난 가이드나 숫자가 아닌 값을 invalid_format 으로 거부한다", () => {
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.02, mouthFraction: 0.7 })).reason,
    ).toBe("invalid_format");
    expect(
      validateDrawing(validDrawing({ tailFraction: 0.3, mouthFraction: "0.7" })).reason,
    ).toBe("invalid_format");
  });
});

// ---------------------------------------------------------------------------
// 래스터(비트맵) 포맷 검증 — version 2 (SPEC-RASTER-001 M1)
//   { version:2, kind:"raster", width, height, tailFraction?, mouthFraction?, image:"<data URL>" }
//   서버는 이미지를 재인코드하지 않고 형식(data URL 접두)·매직바이트·크기만 독립 검증한다.
// ---------------------------------------------------------------------------

// 매직바이트(파일 시그니처) 상수.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
// WebP: "RIFF"(4) + 파일크기(4) + "WEBP"(4)
const WEBP_MAGIC = [
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
];

// 바이트 배열 → base64 문자열.
function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

// 매직바이트 + 더미 본문으로 이루어진 data URL 을 만든다.
function imageDataUrl(mime, magic, padBytes = 40) {
  const body = new Array(padBytes).fill(0x20);
  return `data:image/${mime};base64,` + b64([...magic, ...body]);
}

// 유효한 최소 래스터 그림 헬퍼.
function validRaster(overrides = {}) {
  return {
    version: 2,
    kind: "raster",
    width: 300,
    height: 200,
    image: imageDataUrl("png", PNG_MAGIC),
    ...overrides,
  };
}

describe("validateDrawing — 래스터 정상 케이스 (REQ-RAS-001, AC-002)", () => {
  it("올바른 PNG 래스터 그림을 통과시킨다", () => {
    expect(validateDrawing(validRaster())).toEqual({ valid: true, reason: null });
  });

  it("올바른 JPEG 래스터 그림을 통과시킨다", () => {
    expect(
      validateDrawing(validRaster({ image: imageDataUrl("jpeg", JPEG_MAGIC) })).valid,
    ).toBe(true);
  });

  it("올바른 WebP 래스터 그림을 통과시킨다", () => {
    expect(
      validateDrawing(validRaster({ image: imageDataUrl("webp", WEBP_MAGIC) })).valid,
    ).toBe(true);
  });

  it("래스터에서도 유효한 꼬리/입 가이드를 통과시킨다 (REQ-ANIM-004)", () => {
    expect(
      validateDrawing(validRaster({ tailFraction: 0.4, mouthFraction: 0.72 })).valid,
    ).toBe(true);
  });
});

describe("validateDrawing — 벡터 비회귀 (REQ-COMPAT-002, AC-001)", () => {
  it("래스터 분기 추가 후에도 version 1 벡터 그림이 그대로 통과한다", () => {
    expect(validateDrawing(validDrawing())).toEqual({ valid: true, reason: null });
  });
});

describe("validateDrawing — 래스터 보안 검증 (NFR-SEC-002/003, AC-010)", () => {
  it("MIME 과 매직바이트가 불일치(위장)하면 invalid_format 으로 거부한다", () => {
    // png 로 선언했지만 실제 바이트는 JPEG 시그니처.
    const spoof = validRaster({
      image: `data:image/png;base64,` + b64([...JPEG_MAGIC, 0x20, 0x20, 0x20, 0x20]),
    });
    expect(validateDrawing(spoof).reason).toBe("invalid_format");
  });

  it("이미지가 아닌 data URL(text/html 등)을 invalid_format 으로 거부한다", () => {
    const html = validRaster({
      image: `data:text/html;base64,` + b64([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]),
    });
    expect(validateDrawing(html).reason).toBe("invalid_format");
  });

  it("data URL 접두가 없는 문자열/스크립트 주입을 invalid_format 으로 거부한다", () => {
    expect(validateDrawing(validRaster({ image: "javascript:alert(1)" })).reason).toBe(
      "invalid_format",
    );
  });

  it("base64 가 유효하지 않으면 invalid_format 으로 거부한다", () => {
    expect(
      validateDrawing(validRaster({ image: "data:image/png;base64,!!!not-b64!!!" }))
        .reason,
    ).toBe("invalid_format");
  });

  it("빈 페이로드를 invalid_format 으로 거부한다", () => {
    expect(validateDrawing(validRaster({ image: "data:image/png;base64," })).reason).toBe(
      "invalid_format",
    );
  });
});

describe("validateDrawing — 래스터 구조/크기 검증 (NFR-STORAGE-001, REQ-RAS-004)", () => {
  it("kind 가 raster 가 아니면 invalid_format 으로 거부한다", () => {
    expect(validateDrawing(validRaster({ kind: "vector" })).reason).toBe(
      "invalid_format",
    );
  });

  it("image 필드가 없으면 invalid_format 으로 거부한다", () => {
    const noImage = validRaster();
    delete noImage.image;
    expect(validateDrawing(noImage).reason).toBe("invalid_format");
  });

  it("해상도가 상한(maxCanvas)을 넘으면 invalid_format 으로 거부한다", () => {
    expect(
      validateDrawing(validRaster({ width: RASTER_LIMITS.maxCanvas + 1 })).reason,
    ).toBe("invalid_format");
    expect(validateDrawing(validRaster({ height: 0 })).reason).toBe("invalid_format");
  });

  it("가이드가 하나만 지정되면 invalid_format 으로 거부한다", () => {
    expect(validateDrawing(validRaster({ tailFraction: 0.4 })).reason).toBe(
      "invalid_format",
    );
  });

  it("직렬화 크기가 래스터 상한을 넘으면 too_large 로 거부한다", () => {
    // 매직바이트는 유효하되 본문을 크게 만들어 크기 상한만 초과시킨다.
    const bigBody = new Array(1100 * 1024).fill(0x20);
    const bigImage = `data:image/png;base64,` + b64([...PNG_MAGIC, ...bigBody]);
    const res = validateDrawing(validRaster({ image: bigImage }));
    expect(res.valid).toBe(false);
    expect(res.reason).toBe("too_large");
  });
});
