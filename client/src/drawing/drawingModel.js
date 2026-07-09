// 자유 드로잉 상태 모델(순수 함수). 캔버스 DOM 과 분리해 로직만 담는다.
// 서버 검증(validateDrawing)과 동일한 규칙을 클라이언트 사전 검증에 사용한다.
// (서버가 최종 권한이며, 여기서는 UX 를 위한 빠른 사전 차단이 목적)

// 그림 검증 상한/규칙 — 서버(server/src/fish/validateDrawing.js)와 동일하게 유지.
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

const DEFAULT_COLOR = "#000000";
const DEFAULT_STROKE_WIDTH = 3;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// 꼬리 파닥임 접힘선 위치(그림 너비 대비 비율). 이 선의 왼쪽이 꼬리로 간주되어
// 어항에서 흔들린다. 그리기 캔버스의 점선 가이드와 렌더링이 같은 값을 공유한다.
export const TAIL_FOLD_FRACTION = 0.4;

// 초기 상태: 확정 스트로크 목록 + 진행 중 스트로크(current).
export function initialDrawingState(width = 300, height = 200) {
  return { width, height, strokes: [], current: null };
}

// 지우개: (x,y) 반경 안의 점을 획에서 제거하고, 끊긴 획은 조각으로 분할한다.
// 흰색 덧칠이 아니라 실제 삭제이므로 어항(투명 배경) 위에서도 깨끗하다.
function eraseFromStrokes(strokes, x, y, radius) {
  const result = [];
  for (const stroke of strokes) {
    const hitR = radius + stroke.width / 2;
    const r2 = hitR * hitR;
    let segment = [];
    const flush = () => {
      // 1개짜리 조각은 선으로 보이지 않으므로 버린다.
      if (segment.length >= 2) result.push({ ...stroke, points: segment });
      segment = [];
    };
    for (const p of stroke.points) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r2) flush();
      else segment.push(p);
    }
    flush();
  }
  return result;
}

/**
 * 드로잉 상태 리듀서.
 * 액션: BEGIN_STROKE(x,y,color?,width?), ADD_POINT(x,y), END_STROKE, UNDO, CLEAR,
 *       ERASE_AT(x,y,radius)
 */
export function drawingReducer(state, action) {
  switch (action.type) {
    case "BEGIN_STROKE":
      return {
        ...state,
        current: {
          color: action.color ?? DEFAULT_COLOR,
          width: action.width ?? DEFAULT_STROKE_WIDTH,
          points: [{ x: action.x, y: action.y }],
        },
      };
    case "ADD_POINT":
      if (!state.current) return state; // 시작되지 않은 스트로크는 무시.
      return {
        ...state,
        current: {
          ...state.current,
          points: [...state.current.points, { x: action.x, y: action.y }],
        },
      };
    case "END_STROKE":
      if (!state.current) return state;
      return {
        ...state,
        strokes: [...state.strokes, state.current],
        current: null,
      };
    case "UNDO":
      if (state.strokes.length === 0) return state;
      return { ...state, strokes: state.strokes.slice(0, -1) };
    case "CLEAR":
      return { ...state, strokes: [], current: null };
    case "ERASE_AT": {
      const strokes = eraseFromStrokes(state.strokes, action.x, action.y, action.radius ?? 12);
      return { ...state, strokes };
    }
    default:
      return state;
  }
}

// 확정 스트로크로 저장 가능한 그림 객체를 만든다(REQ-DRAW-003 캡처).
export function toDrawing(state) {
  return {
    version: 1,
    width: state.width,
    height: state.height,
    strokes: state.strokes.map((s) => ({
      color: s.color,
      width: s.width,
      points: s.points.map((p) => ({ x: p.x, y: p.y })),
    })),
  };
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

/**
 * 그림 데이터 사전 검증(서버와 동일 규칙).
 * @returns {{valid:boolean, reason:string|null}}
 */
export function validateDrawing(drawing, limits = DRAWING_LIMITS) {
  if (drawing === null || typeof drawing !== "object" || Array.isArray(drawing)) {
    return fail("invalid_format");
  }
  if (drawing.version !== 1) return fail("invalid_format");
  if (!isPositiveInt(drawing.width, limits.maxCanvas)) return fail("invalid_format");
  if (!isPositiveInt(drawing.height, limits.maxCanvas)) return fail("invalid_format");
  if (!Array.isArray(drawing.strokes)) return fail("invalid_format");
  if (drawing.strokes.length > limits.maxStrokes) return fail("invalid_format");

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
