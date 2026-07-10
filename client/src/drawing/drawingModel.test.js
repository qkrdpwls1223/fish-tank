import { describe, it, expect } from "vitest";
import {
  floodFill,
  hexToRgba,
  isBlankImageData,
  buildRasterDrawing,
  validateDrawing,
  DRAWING_LIMITS,
  RASTER_LIMITS,
  TAIL_FOLD_FRACTION,
  MOUTH_FRACTION,
} from "./drawingModel.js";

// 래스터 그림 모델(순수 함수). 캔버스 DOM 과 분리해 로직만 검증한다.
// 커버: REQ-FILL-*(플러드필), REQ-COMPAT-003/REQ-ANIM-004(래스터 저장·가이드),
//       NFR-SEC-002/003·NFR-STORAGE-001(사전 검증 미러), REQ-RAS-005(투명 배경 감지).

// --- 픽셀 버퍼 헬퍼 -----------------------------------------------------------
function makeImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width, height };
}
function setPixel(img, x, y, rgba) {
  const i = (y * img.width + x) * 4;
  img.data[i] = rgba[0];
  img.data[i + 1] = rgba[1];
  img.data[i + 2] = rgba[2];
  img.data[i + 3] = rgba[3];
}
function getPixel(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

const RED = [255, 0, 0, 255];

describe("floodFill — 페인트통(플러드필)", () => {
  it("빈(투명) 영역 전체를 채운다 (REQ-FILL-001)", () => {
    const img = makeImage(3, 3);
    const res = floodFill(img, 1, 1, RED, 0);
    expect(res.changed).toBe(true);
    expect(res.count).toBe(9);
    expect(getPixel(img, 0, 0)).toEqual(RED);
    expect(getPixel(img, 2, 2)).toEqual(RED);
  });

  it("경계(다른 색) 너머로 새어나가지 않는다", () => {
    // [ A A B A A ] — x=2 가 경계. x=0 에서 채우면 x0,x1 만 채워진다.
    const img = makeImage(5, 1);
    setPixel(img, 2, 0, [0, 0, 0, 255]); // 불투명 검정 경계
    const res = floodFill(img, 0, 0, RED, 0);
    expect(res.count).toBe(2);
    expect(getPixel(img, 0, 0)).toEqual(RED);
    expect(getPixel(img, 1, 0)).toEqual(RED);
    expect(getPixel(img, 2, 0)).toEqual([0, 0, 0, 255]); // 경계 보존
    expect(getPixel(img, 3, 0)).toEqual([0, 0, 0, 0]); // 반대편 미변경
    expect(getPixel(img, 4, 0)).toEqual([0, 0, 0, 0]);
  });

  it("색 허용 오차(tolerance)로 안티에일리어싱 경계를 흡수한다 (REQ-FILL-002)", () => {
    // x1 은 시작색과 거리 10. tol=0 이면 미포함, tol=20 이면 포함.
    const near = [10, 0, 0, 0];
    const strict = makeImage(2, 1);
    setPixel(strict, 1, 0, near);
    expect(floodFill(strict, 0, 0, RED, 0).count).toBe(1);
    expect(getPixel(strict, 1, 0)).toEqual(near); // 미변경

    const loose = makeImage(2, 1);
    setPixel(loose, 1, 0, near);
    expect(floodFill(loose, 0, 0, RED, 20).count).toBe(2);
    expect(getPixel(loose, 1, 0)).toEqual(RED);
  });

  it("시작점이 이미 채움색이면 무동작이다 (REQ-FILL-003)", () => {
    const img = makeImage(3, 3, RED);
    const res = floodFill(img, 1, 1, RED, 0);
    expect(res.changed).toBe(false);
    expect(res.count).toBe(0);
    expect(getPixel(img, 0, 0)).toEqual(RED); // 그대로
  });

  it("캔버스 밖 시작점은 무동작이다", () => {
    const img = makeImage(3, 3);
    expect(floodFill(img, -1, 0, RED, 0).changed).toBe(false);
    expect(floodFill(img, 3, 0, RED, 0).changed).toBe(false);
    expect(floodFill(img, 0, 3, RED, 0).changed).toBe(false);
  });

  it("모서리 시작점도 정상 동작한다", () => {
    const img = makeImage(2, 2);
    const res = floodFill(img, 1, 1, RED, 0);
    expect(res.count).toBe(4);
  });

  it("4-연결만 채운다(대각선으로 새지 않음)", () => {
    // 대각선 경계로 분리된 두 칸: (0,0)=start, (1,1)은 대각선이라 별도.
    // [ A B ]
    // [ B A ]  — B 는 경계. (0,0) 채우면 (0,0) 하나만.
    const img = makeImage(2, 2);
    setPixel(img, 1, 0, [0, 0, 0, 255]);
    setPixel(img, 0, 1, [0, 0, 0, 255]);
    const res = floodFill(img, 0, 0, RED, 0);
    expect(res.count).toBe(1);
    expect(getPixel(img, 1, 1)).toEqual([0, 0, 0, 0]); // 대각선 칸 미변경
  });
});

describe("hexToRgba", () => {
  it("#rrggbb 를 불투명 RGBA 로 변환한다", () => {
    expect(hexToRgba("#ff0000")).toEqual([255, 0, 0, 255]);
    expect(hexToRgba("#12ab34")).toEqual([0x12, 0xab, 0x34, 255]);
  });
  it("잘못된 색은 검정으로 폴백한다(주입 방지)", () => {
    expect(hexToRgba("url(javascript:x)")).toEqual([0, 0, 0, 255]);
  });
});

describe("isBlankImageData — 빈 캔버스 감지 (REQ-RAS-005)", () => {
  it("모든 알파가 0 이면 비어있음", () => {
    expect(isBlankImageData(makeImage(4, 4))).toBe(true);
  });
  it("불투명 픽셀이 하나라도 있으면 비어있지 않음", () => {
    const img = makeImage(4, 4);
    setPixel(img, 2, 2, RED);
    expect(isBlankImageData(img)).toBe(false);
  });
});

describe("buildRasterDrawing — version 2 직렬화 (REQ-COMPAT-003, REQ-ANIM-004)", () => {
  it("래스터(version 2) 그림 객체를 만든다", () => {
    const d = buildRasterDrawing({
      width: 300,
      height: 200,
      tailFraction: 0.3,
      mouthFraction: 0.7,
      image: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(d).toEqual({
      version: 2,
      kind: "raster",
      width: 300,
      height: 200,
      tailFraction: 0.3,
      mouthFraction: 0.7,
      image: "data:image/png;base64,iVBORw0KGgo=",
    });
  });

  it("가이드 미지정 시 기본값(꼬리 0.4 / 입 0.72)으로 폴백한다", () => {
    const d = buildRasterDrawing({ width: 300, height: 200, image: "x" });
    expect(d.tailFraction).toBeCloseTo(TAIL_FOLD_FRACTION);
    expect(d.mouthFraction).toBeCloseTo(MOUTH_FRACTION);
  });
});

// --- 유효한/거대한 PNG data URL 생성기(btoa 사용) --------------------------------
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function pngDataUrl(byteLen = 8) {
  const bytes = new Uint8Array(Math.max(byteLen, 8));
  bytes.set(PNG_SIG, 0);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

describe("validateDrawing — 래스터(version 2) 사전 검증 미러 (NFR-SEC-002/003)", () => {
  function validRaster(overrides = {}) {
    return {
      version: 2,
      kind: "raster",
      width: 300,
      height: 200,
      tailFraction: 0.4,
      mouthFraction: 0.72,
      image: pngDataUrl(8),
      ...overrides,
    };
  }

  it("정상 래스터 그림을 통과시킨다", () => {
    expect(validateDrawing(validRaster())).toEqual({ valid: true, reason: null });
  });

  it("kind 가 raster 가 아니면 invalid_format", () => {
    expect(validateDrawing(validRaster({ kind: "vector" })).reason).toBe("invalid_format");
  });

  it("image 가 data URL 이 아니면 invalid_format", () => {
    expect(validateDrawing(validRaster({ image: "hello" })).reason).toBe("invalid_format");
    expect(validateDrawing(validRaster({ image: 123 })).reason).toBe("invalid_format");
  });

  it("매직바이트가 선언 MIME 과 다르면 invalid_format(위장 이미지 차단)", () => {
    // png 로 선언했지만 실제 바이트는 서명이 아님.
    const fake = `data:image/png;base64,${btoa("NOTAPNGCONTENT!!")}`;
    expect(validateDrawing(validRaster({ image: fake })).reason).toBe("invalid_format");
  });

  it("가이드가 하나만 있으면 invalid_format(both-or-neither)", () => {
    const only = validRaster();
    delete only.mouthFraction;
    expect(validateDrawing(only).reason).toBe("invalid_format");
  });

  it("가이드 순서/범위 위반은 invalid_format", () => {
    expect(
      validateDrawing(validRaster({ tailFraction: 0.7, mouthFraction: 0.3 })).reason,
    ).toBe("invalid_format");
    expect(
      validateDrawing(validRaster({ tailFraction: 0.02, mouthFraction: 0.7 })).reason,
    ).toBe("invalid_format");
  });

  it("해상도 상한을 초과하면 invalid_format", () => {
    expect(
      validateDrawing(validRaster({ width: RASTER_LIMITS.maxCanvas + 1 })).reason,
    ).toBe("invalid_format");
  });

  it("직렬화 크기 상한(1MB)을 초과하면 too_large (NFR-STORAGE-001)", () => {
    // 약 900KB 바이트 → base64 ~1.2MB > 1MB.
    const huge = validRaster({ image: pngDataUrl(900 * 1024) });
    expect(validateDrawing(huge).reason).toBe("too_large");
  });

  it("래스터 상한이 벡터 상한보다 크다(별도 상향 정의)", () => {
    expect(RASTER_LIMITS.maxBytes).toBeGreaterThan(DRAWING_LIMITS.maxBytes);
    expect(RASTER_LIMITS.maxBytes).toBe(1024 * 1024);
  });
});

describe("validateDrawing — 벡터(version 1) 하위호환 미러 (REQ-COMPAT-002)", () => {
  function validVector(overrides = {}) {
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

  it("정상 벡터 그림은 계속 통과한다", () => {
    expect(validateDrawing(validVector())).toEqual({ valid: true, reason: null });
  });

  it("악성 색상 벡터는 invalid_format 으로 거부한다", () => {
    const bad = validVector();
    bad.strokes[0].color = "url(javascript:x)";
    expect(validateDrawing(bad).reason).toBe("invalid_format");
  });

  it("빈 벡터 그림은 empty 로 거부한다", () => {
    expect(validateDrawing(validVector({ strokes: [] })).reason).toBe("empty");
  });
});
