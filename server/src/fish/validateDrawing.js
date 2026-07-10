// @MX:ANCHOR: [AUTO] 그림 데이터 검증 — 모든 쓰기 경로의 페이로드 보안 경계
// @MX:REASON: NFR-SEC-002/003. 클라이언트를 신뢰하지 않고 형식/크기/최소성을 독립 검증한다.
//   공유 어항(routes/fish.js)·내 어항(routes/myTank.js)이 이 함수에 의존(fan_in >= 2, 재사용 확대 중).
//   벡터(version 1)와 래스터(version 2)를 version 으로 분기 검증한다. 래스터는 data URL
//   접두·MIME·매직바이트로 위장 이미지 주입을 차단하되, 서버측 재인코드(sharp/jimp)는 미도입한다.

// 그림 직렬화 포맷(스트로크 기반 벡터)에 대한 검증 상한/규칙.
// 클라이언트도 동일 규칙으로 사전 검증하지만, 서버가 최종 권한을 가진다.
export const DRAWING_LIMITS = Object.freeze({
  maxBytes: 100 * 1024, // 직렬화 JSON 문자열 최대 길이 (100KB)
  maxCanvas: 2000, // width/height 최대값(px)
  minStrokes: 1,
  maxStrokes: 500,
  maxPointsPerStroke: 5000,
  minTotalPoints: 2, // 최소 선분(획 없음 방지)
  minBoundingSize: 8, // 바운딩 박스 (너비+높이) 최소값 — 점 하나/미세 그림 거부
  minStrokeWidth: 1,
  maxStrokeWidth: 50,
});

// 래스터(비트맵) 포맷 전용 상한 (NFR-STORAGE-001, NFR-SEC-004).
//   벡터 maxBytes=100KB 는 base64 PNG 를 담기에 부족하므로 별도 상향 정의한다.
//   1MB 선택 근거: 해상도 상한(2000px) 이미지를 클라이언트 캔버스에서 규격 리사이즈한 뒤
//   PNG data URL(base64, 원본 대비 ~33% 팽창)로 담기에 충분하면서, 저장소 남용/DoS 를
//   막는 실용적 상한이다. 무제한은 금지한다.
//   maxCanvas 는 벡터(DRAWING_LIMITS.maxCanvas)와 정합하게 2000px 로 유지한다.
//   [클라 미러링 대상] M2 에서 drawingModel.js 가 동일 값을 사용한다.
export const RASTER_LIMITS = Object.freeze({
  maxBytes: 1024 * 1024, // 직렬화 JSON 문자열 최대 길이 (1MB)
  maxCanvas: 2000, // width/height 최대값(px)
});

// 가이드 선(꼬리/입) 위치 제약 — 클라이언트(drawingModel.js GUIDE_LIMITS)와 동일 규칙.
export const GUIDE_LIMITS = Object.freeze({ min: 0.1, max: 0.9, minGap: 0.1 });

// 안전한 색상: #rrggbb 헥스만 허용(스크립트/URL 주입 차단).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 허용 이미지 MIME 을 담은 data URL 접두 (NFR-SEC-002). PNG/JPEG/WebP 정지 이미지만.
const RASTER_DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

// 표준 base64 문자만 허용(공백/개행/비표준 문자 배제 → 위장·손상 페이로드 거부).
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// 선언 MIME → 실제 바이트의 매직바이트(파일 시그니처) 매칭기 (NFR-SEC-002).
//   base64 디코드 후 실제 바이트가 선언한 MIME 과 일치하는지 확인해,
//   스크립트/실행 콘텐츠가 이미지로 위장 주입되는 것을 차단한다.
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
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP",
};

// 유한한 실수인지 확인(NaN/Infinity/문자열 배제).
function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isPositiveInt(v, max) {
  return Number.isInteger(v) && v > 0 && v <= max;
}

// 실패 결과 헬퍼.
function fail(reason) {
  return { valid: false, reason };
}

// 가이드 선(꼬리/입) 위치 검증. 문제 없으면 null, 있으면 실패 사유를 돌려준다.
// 하위호환: 두 필드가 모두 없으면 통과(구버전 그림). 하나만 있으면 형식 오류.
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

// 래스터(version 2) 그림 검증. 문제 없으면 null, 있으면 실패 사유를 돌려준다.
//   서버는 이미지를 재인코드하지 않는다(결정 2026-07-10, sharp/jimp 미도입).
//   형식(data URL 접두)·MIME·매직바이트·해상도 상한만 독립 검증한다(NFR-SEC-003).
//   래스터에는 스트로크 기반 'empty'/'too_small' 개념이 없으므로,
//   형식 문제는 모두 invalid_format, 크기 초과는 호출부에서 too_large 로 처리한다.
function validateRaster(drawing, limits) {
  // 1) 최상위 구조: kind 식별자 + 해상도 상한(선언 width/height, 픽셀 상한 검증).
  if (drawing.kind !== "raster") return "invalid_format";
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) return "invalid_format";
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) return "invalid_format";

  // 2) 가이드 선(꼬리/입) — 벡터와 동일 규칙 재사용(REQ-ANIM-004).
  const guideReason = validateGuides(drawing);
  if (guideReason) return guideReason;

  // 3) image: 허용 MIME data URL 접두 검사.
  if (typeof drawing.image !== "string") return "invalid_format";
  const match = RASTER_DATA_URL.exec(drawing.image);
  if (!match) return "invalid_format";
  const mime = match[1]; // png | jpeg | webp
  const payload = drawing.image.slice(match[0].length);

  // 4) base64 안전 디코드 + 왕복 검사(비표준/손상 페이로드 거부).
  if (payload.length === 0) return "invalid_format";
  if (!BASE64.test(payload) || payload.length % 4 !== 0) return "invalid_format";
  const bytes = Buffer.from(payload, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== payload) {
    return "invalid_format";
  }

  // 5) 매직바이트가 선언 MIME 과 일치하는지(위장 주입 차단, NFR-SEC-002).
  if (!MAGIC_BYTES[mime](bytes)) return "invalid_format";

  return null;
}

/**
 * 그림 데이터를 검증한다.
 * @param {unknown} drawing - 클라이언트가 보낸 그림(신뢰하지 않음)
 * @param {typeof DRAWING_LIMITS} [limits] - 벡터(version 1) 상한
 * @param {typeof RASTER_LIMITS} [rasterLimits] - 래스터(version 2) 상한
 * @returns {{ valid: boolean, reason: string|null }}
 *   reason: 'invalid_format' | 'empty' | 'too_small' | 'too_large' | null
 */
export function validateDrawing(
  drawing,
  limits = DRAWING_LIMITS,
  rasterLimits = RASTER_LIMITS,
) {
  // 0) 최상위 구조(공통).
  if (drawing === null || typeof drawing !== "object" || Array.isArray(drawing)) {
    return fail("invalid_format");
  }

  // 0b) 포맷 분기: version 으로 래스터(2)/벡터(1) 판별(REQ-RAS-002, REQ-COMPAT-001).
  if (drawing.version === 2) {
    const reason = validateRaster(drawing, rasterLimits);
    if (reason) return fail(reason);
    // 직렬화 크기 상한(NFR-STORAGE-001) — image 문자열이 사실상 대부분을 차지한다.
    if (JSON.stringify(drawing).length > rasterLimits.maxBytes) {
      return fail("too_large");
    }
    return { valid: true, reason: null };
  }

  // 1) 벡터(version 1) 검증 경로 — 비회귀 보존(REQ-COMPAT-002).
  if (drawing.version !== 1) return fail("invalid_format");
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) {
    return fail("invalid_format");
  }
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) {
    return fail("invalid_format");
  }
  if (!Array.isArray(drawing.strokes)) return fail("invalid_format");
  if (drawing.strokes.length > limits.maxStrokes) return fail("invalid_format");

  // 1b) 가이드 선(꼬리/입) 위치 검증(선택 필드, 하위호환).
  const guideReason = validateGuides(drawing);
  if (guideReason) return fail(guideReason);

  // 2) 스트로크/점 형식 검증 + 통계 수집.
  let totalPoints = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of drawing.strokes) {
    if (stroke === null || typeof stroke !== "object") {
      return fail("invalid_format");
    }
    if (!HEX_COLOR.test(stroke.color)) return fail("invalid_format");
    if (
      !isFiniteNumber(stroke.width) ||
      stroke.width < limits.minStrokeWidth ||
      stroke.width > limits.maxStrokeWidth
    ) {
      return fail("invalid_format");
    }
    if (!Array.isArray(stroke.points)) return fail("invalid_format");
    if (stroke.points.length > limits.maxPointsPerStroke) {
      return fail("invalid_format");
    }

    for (const p of stroke.points) {
      if (p === null || typeof p !== "object") return fail("invalid_format");
      if (!isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
        return fail("invalid_format");
      }
      // 캔버스 경계 내 좌표만 허용.
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

  // 3) 빈/무효 그림 검증 (REQ-DRAW-004).
  if (drawing.strokes.length < limits.minStrokes) return fail("empty");
  if (totalPoints < limits.minTotalPoints) return fail("empty");

  // 4) 최소 크기(바운딩 박스) 검증 — 점 하나/미세 그림 거부.
  const boundingSize = maxX - minX + (maxY - minY);
  if (boundingSize < limits.minBoundingSize) return fail("too_small");

  // 5) 직렬화 크기 상한 검증 (NFR-SEC-003).
  if (JSON.stringify(drawing).length > limits.maxBytes) return fail("too_large");

  return { valid: true, reason: null };
}
