// @MX:ANCHOR: [AUTO] 그림 데이터 검증 — 모든 쓰기 경로의 페이로드 보안 경계
// @MX:REASON: NFR-SEC-003. 클라이언트를 신뢰하지 않고 형식/크기/최소성을 독립 검증한다.
//   물고기 생성 라우트가 이 함수에 의존하며, 향후 검증 재사용으로 fan_in >= 3 예상.

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

// 안전한 색상: #rrggbb 헥스만 허용(스크립트/URL 주입 차단).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

/**
 * 그림 데이터를 검증한다.
 * @param {unknown} drawing - 클라이언트가 보낸 그림(신뢰하지 않음)
 * @param {typeof DRAWING_LIMITS} [limits]
 * @returns {{ valid: boolean, reason: string|null }}
 *   reason: 'invalid_format' | 'empty' | 'too_small' | 'too_large' | null
 */
export function validateDrawing(drawing, limits = DRAWING_LIMITS) {
  // 1) 최상위 구조 검증.
  if (drawing === null || typeof drawing !== "object" || Array.isArray(drawing)) {
    return fail("invalid_format");
  }
  if (drawing.version !== 1) return fail("invalid_format");
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) {
    return fail("invalid_format");
  }
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) {
    return fail("invalid_format");
  }
  if (!Array.isArray(drawing.strokes)) return fail("invalid_format");
  if (drawing.strokes.length > limits.maxStrokes) return fail("invalid_format");

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
