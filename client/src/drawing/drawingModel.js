// 물고기 그림 모델(래스터/비트맵 기반). 캔버스 DOM 과 분리해 순수 로직만 담는다.
// 신규 물고기는 래스터(version 2)로 저장한다(REQ-COMPAT-003). 벡터(version 1)는
// 더 이상 생성하지 않지만, 서버와 동일한 규칙으로 계속 검증할 수 있게 분기를 유지한다.
// 서버(server/src/fish/validateDrawing.js)가 최종 권한이며, 여기서는 UX 를 위한 빠른
// 사전 차단과 서버 거부 예방이 목적이다.

// 벡터(스트로크) 포맷 검증 상한 — 서버 DRAWING_LIMITS 와 동일하게 유지(하위호환 검증용).
export const DRAWING_LIMITS = Object.freeze({
  maxBytes: 100 * 1024,
  maxCanvas: 2000,
  minStrokes: 1,
  maxStrokes: 500,
  maxPointsPerStroke: 5000,
  minTotalPoints: 2,
  minBoundingSize: 8,
  minStrokeWidth: 1,
  maxStrokeWidth: 50,
});

// 래스터(비트맵) 포맷 전용 상한 — 서버 RASTER_LIMITS 와 정확히 동일하게 미러링한다
// (NFR-STORAGE-001, NFR-SEC-004). base64 PNG data URL 을 담기 위해 벡터보다 상향(1MB).
export const RASTER_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024, // 직렬화 JSON 문자열 최대 길이 (1MB)
  maxCanvas: 2000, // width/height 최대값(px)
});

// 꼬리 파닥임 접힘선 기본 위치(그림 너비 대비 비율). 이 선의 왼쪽이 꼬리로 간주되어
// 어항에서 흔들린다. 렌더러(FishTank/MyTank)가 이 값을 import 해 기본값으로 쓴다.
export const TAIL_FOLD_FRACTION = 0.4;

// 입(머리) 경계선 기본 위치(그림 너비 대비 비율). 이 선의 오른쪽이 입으로 간주되어
// 먹이를 먹을 때 꿀렁거린다. 그리기 캔버스 가이드와 어항 렌더링이 같은 값을 공유한다.
export const MOUTH_FRACTION = 0.72;

// 가이드 선(꼬리/입) 위치 제약 — 서버 GUIDE_LIMITS 와 동일 규칙.
export const GUIDE_LIMITS = Object.freeze({ min: 0.1, max: 0.9, minGap: 0.1 });

// 안전한 색상: #rrggbb 헥스만 허용(스크립트/URL 주입 차단).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 허용 이미지 MIME 을 담은 data URL 접두 (NFR-SEC-002). PNG/JPEG/WebP 정지 이미지만.
const RASTER_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

// 표준 base64 문자만 허용(공백/개행/비표준 문자 배제 → 위장·손상 페이로드 거부).
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function clampNum(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isPositiveInt(v, max) {
  return Number.isInteger(v) && v > 0 && v <= max;
}

function fail(reason) {
  return { valid: false, reason };
}

// "#rrggbb" 색상을 [r, g, b, 255] RGBA 배열로 변환한다(페인트통 채움색/브러시색 공용).
export function hexToRgba(hex) {
  const m = HEX_COLOR.test(hex) ? hex : "#000000";
  return [
    parseInt(m.slice(1, 3), 16),
    parseInt(m.slice(3, 5), 16),
    parseInt(m.slice(5, 7), 16),
    255,
  ];
}

// 픽셀 버퍼가 완전히 투명한지(모든 알파 0) 판정한다 — 빈 캔버스 감지(REQ-RAS-005 배경 투명).
export function isBlankImageData(image) {
  const data = image && image.data;
  if (!data) return true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

// 두 RGBA 색의 채널 합 거리. tolerance 판정에 쓰인다(안티에일리어싱 경계 흡수).
function colorDistance(data, i, target) {
  return (
    Math.abs(data[i] - target[0]) +
    Math.abs(data[i + 1] - target[1]) +
    Math.abs(data[i + 2] - target[2]) +
    Math.abs(data[i + 3] - target[3])
  );
}

// @MX:NOTE: [AUTO] 스캔라인 4-연결 플러드필(페인트통). 캔버스 없이 순수 배열로 동작해 단위 테스트 가능.
/**
 * 래스터 플러드필(페인트통). RGBA Uint8ClampedArray(또는 일반 배열)를 제자리(in-place)로 채운다.
 * 시작점과 색이 연속으로 이어진 4-연결 영역만 채운다(REQ-FILL-001).
 * 안티에일리어싱 경계를 위해 tolerance(채널 합 거리 허용치)를 적용한다(REQ-FILL-002).
 * 시작점이 이미 채움색과 같거나(허용 오차 내) 채울 것이 없으면 무동작이다(REQ-FILL-003).
 *
 * @param {{data: Uint8ClampedArray|number[], width: number, height: number}} image 픽셀 버퍼
 * @param {number} x 시작 x
 * @param {number} y 시작 y
 * @param {number[]} fillRGBA 채움색 [r, g, b, a?]. a 생략 시 255(불투명).
 * @param {number} [tolerance=0] 색 허용 오차(채널 합 거리, 0~1020)
 * @returns {{changed: boolean, count: number}} 변경 여부와 채운 픽셀 수
 */
export function floodFill(image, x, y, fillRGBA, tolerance = 0) {
  const { data, width, height } = image;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
    return { changed: false, count: 0 };
  }

  const idx = (px, py) => (py * width + px) * 4;
  const startIdx = idx(sx, sy);
  const target = [
    data[startIdx],
    data[startIdx + 1],
    data[startIdx + 2],
    data[startIdx + 3],
  ];
  const fill = [fillRGBA[0], fillRGBA[1], fillRGBA[2], fillRGBA[3] ?? 255];

  // 무동작 조건: 시작점이 이미 채움색과 허용 오차 내로 같으면 채울 것이 없다(REQ-FILL-003).
  const fillDistance =
    Math.abs(target[0] - fill[0]) +
    Math.abs(target[1] - fill[1]) +
    Math.abs(target[2] - fill[2]) +
    Math.abs(target[3] - fill[3]);
  if (fillDistance <= tolerance) return { changed: false, count: 0 };

  const matches = (i) => colorDistance(data, i, target) <= tolerance;
  const paint = (i) => {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  };

  let count = 0;
  const stack = [[sx, sy]];
  while (stack.length > 0) {
    const [px, py] = stack.pop();
    // 현재 행에서 왼쪽 끝까지 이동.
    let left = px;
    while (left >= 0 && matches(idx(left, py))) left -= 1;
    left += 1;

    let spanUp = false;
    let spanDown = false;
    for (let cx = left; cx < width && matches(idx(cx, py)); cx += 1) {
      paint(idx(cx, py));
      count += 1;
      // 위/아래 행에서 이어지는 새 구간의 시작만 스택에 넣는다(중복 방지).
      if (py > 0) {
        const up = matches(idx(cx, py - 1));
        if (up && !spanUp) {
          stack.push([cx, py - 1]);
          spanUp = true;
        } else if (!up) {
          spanUp = false;
        }
      }
      if (py < height - 1) {
        const down = matches(idx(cx, py + 1));
        if (down && !spanDown) {
          stack.push([cx, py + 1]);
          spanDown = true;
        } else if (!down) {
          spanDown = false;
        }
      }
    }
  }

  return { changed: count > 0, count };
}

// 캔버스 픽셀에서 저장 가능한 래스터(version 2) 그림 객체를 만든다(REQ-COMPAT-003, REQ-ANIM-004).
// 꼬리/입 경계는 미지정 시 기본값으로 폴백해, 래스터 물고기가 항상 가이드를 지니도록 한다.
export function buildRasterDrawing({ width, height, tailFraction, mouthFraction, image }) {
  return {
    version: 2,
    kind: "raster",
    width,
    height,
    tailFraction: tailFraction ?? TAIL_FOLD_FRACTION,
    mouthFraction: mouthFraction ?? MOUTH_FRACTION,
    image,
  };
}

// 가이드 선(꼬리/입) 위치 검증. 문제 없으면 null, 있으면 실패 사유. 두 필드는 both-or-neither.
function validateGuides(drawing, limits = GUIDE_LIMITS) {
  const hasTail = drawing.tailFraction !== undefined;
  const hasMouth = drawing.mouthFraction !== undefined;
  if (!hasTail && !hasMouth) return null;
  if (!hasTail || !hasMouth) return "invalid_format";
  const inRange = (v) => isFiniteNumber(v) && v >= limits.min && v <= limits.max;
  if (!inRange(drawing.tailFraction) || !inRange(drawing.mouthFraction)) {
    return "invalid_format";
  }
  if (drawing.mouthFraction - drawing.tailFraction < limits.minGap) {
    return "invalid_format";
  }
  return null;
}

// base64 문자열을 바이트 배열로 디코드한다(브라우저/jsdom 의 atob 사용). 실패 시 null.
function decodeBase64(payload) {
  if (typeof atob !== "function") return null;
  try {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function asciiSlice(bytes, start, end) {
  let out = "";
  for (let i = start; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

// 선언 MIME → 실제 바이트의 매직바이트(파일 시그니처) 매칭기 — 서버와 동일(NFR-SEC-002).
const MAGIC_BYTES = {
  png: (b) =>
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) =>
    b.length >= 12 && asciiSlice(b, 0, 4) === "RIFF" && asciiSlice(b, 8, 12) === "WEBP",
};

// 래스터(version 2) 그림 검증 — 서버 validateRaster 규칙을 미러링한다.
// 형식(data URL 접두)·MIME·매직바이트·해상도 상한만 검사한다(서버 재인코드 없음).
function validateRaster(drawing, limits) {
  if (drawing.kind !== "raster") return "invalid_format";
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) return "invalid_format";
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) return "invalid_format";

  const guideReason = validateGuides(drawing);
  if (guideReason) return guideReason;

  if (typeof drawing.image !== "string") return "invalid_format";
  const match = RASTER_DATA_URL.exec(drawing.image);
  if (!match) return "invalid_format";
  const mime = match[1]; // png | jpeg | webp
  const payload = drawing.image.slice(match[0].length);

  if (payload.length === 0) return "invalid_format";
  if (!BASE64.test(payload) || payload.length % 4 !== 0) return "invalid_format";

  const bytes = decodeBase64(payload);
  if (!bytes || bytes.length === 0) return "invalid_format";
  if (!MAGIC_BYTES[mime](bytes)) return "invalid_format";

  return null;
}

// @MX:ANCHOR: [AUTO] 그림 사전 검증 — 클라이언트 쓰기 경로의 보안 미러(FishComposer 등에서 재사용)
// @MX:REASON: NFR-SEC-002/003. 서버 validateDrawing 과 동일 규칙으로 위장 이미지/형식 위반을
//   사전 차단해 서버 거부를 예방한다. version 으로 래스터(2)/벡터(1)를 분기한다.
/**
 * 그림 데이터를 사전 검증한다(서버와 동일 규칙, 서버가 최종 권한).
 * @param {unknown} drawing 클라이언트가 만든 그림(신뢰하지 않음)
 * @param {typeof DRAWING_LIMITS} [limits] 벡터(version 1) 상한
 * @param {typeof RASTER_LIMITS} [rasterLimits] 래스터(version 2) 상한
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateDrawing(
  drawing,
  limits = DRAWING_LIMITS,
  rasterLimits = RASTER_LIMITS,
) {
  if (drawing === null || typeof drawing !== "object" || Array.isArray(drawing)) {
    return fail("invalid_format");
  }

  // 포맷 분기: version 으로 래스터(2)/벡터(1) 판별(REQ-RAS-002, REQ-COMPAT-001).
  if (drawing.version === 2) {
    const reason = validateRaster(drawing, rasterLimits);
    if (reason) return fail(reason);
    if (JSON.stringify(drawing).length > rasterLimits.maxBytes) {
      return fail("too_large");
    }
    return { valid: true, reason: null };
  }

  // 벡터(version 1) 검증 경로 — 하위호환 미러(신규 생성 경로에서는 더 이상 쓰이지 않음).
  if (drawing.version !== 1) return fail("invalid_format");
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) return fail("invalid_format");
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) return fail("invalid_format");
  if (!Array.isArray(drawing.strokes)) return fail("invalid_format");
  if (drawing.strokes.length > limits.maxStrokes) return fail("invalid_format");

  const guideReason = validateGuides(drawing);
  if (guideReason) return fail(guideReason);

  let totalPoints = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of drawing.strokes) {
    if (stroke === null || typeof stroke !== "object") return fail("invalid_format");
    if (!HEX_COLOR.test(stroke.color)) return fail("invalid_format");
    if (
      !isFiniteNumber(stroke.width) ||
      stroke.width < limits.minStrokeWidth ||
      stroke.width > limits.maxStrokeWidth
    ) {
      return fail("invalid_format");
    }
    if (!Array.isArray(stroke.points)) return fail("invalid_format");
    if (stroke.points.length > limits.maxPointsPerStroke) return fail("invalid_format");

    for (const p of stroke.points) {
      if (p === null || typeof p !== "object") return fail("invalid_format");
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) return fail("invalid_format");
      if (p.x < 0 || p.x > drawing.width || p.y < 0 || p.y > drawing.height) {
        return fail("invalid_format");
      }
      totalPoints += 1;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (drawing.strokes.length < limits.minStrokes) return fail("empty");
  if (totalPoints < limits.minTotalPoints) return fail("empty");

  const boundingSize = maxX - minX + (maxY - minY);
  if (boundingSize < limits.minBoundingSize) return fail("too_small");

  if (JSON.stringify(drawing).length > limits.maxBytes) return fail("too_large");

  return { valid: true, reason: null };
}

// clampNum 은 슬라이더/가이드 조정에서 재사용할 수 있게 노출한다.
export { clampNum };
