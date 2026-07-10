// 물고기 스프라이트 렌더 공용 모듈 (SPEC-RASTER-001 M3, REQ-RENDER-001/002/003).
//
// 어항(FishTank)·내 어항(MyTank)·스냅샷(renderSnapshot)이 모두 이 한 구현을 쓴다(DRY, 회귀 표면 최소화).
// 핵심 아이디어: 벡터(version 1)든 래스터(version 2)든 물고기당 오프스크린 캔버스에 "한 번" 렌더해
// 캐싱한 뒤, 프레임마다 재-path/재디코드 대신 캐시 비트맵을 blit 한다(NFR-PERF-002). 꼬리 파닥임·입
// 벌림은 blit 시점에 비트맵을 세로 스트립으로 잘라 변환(회전/오프셋)해 표현한다(REQ-ANIM-002/003).
//
// 벡터 비회귀(REQ-COMPAT-002): 스트립 변환은 기존 벡터 점-warp(bendPoint/chompPoint)와 동일한 wave/
// gape 공식을 쓴다. 픽셀 단위로 동일하진 않지만 모양·색·꼬리 파닥임·입 벌림은 그대로 보존된다.

import { TAIL_FOLD_FRACTION, MOUTH_FRACTION } from "./drawingModel.js";

// 물고기 렌더 크기(원본 그림 대비 축소). 어항/내 어항 공통. 이름표 위치 계산에도 쓰여 export 한다.
export const SPRITE_SCALE = 0.3;
// 꼬리 파닥임 최대 각도(라디안)와 속도(라디안/초).
export const TAIL_MAX_ANGLE = 0.5;
export const TAIL_SPEED = 7;
// 입 최대 벌림 폭(그림 높이 대비 비율)과 여닫는 속도(라디안/초).
export const MOUTH_MAX_OPEN = 0.16;
export const CHOMP_SPEED = 14;

// 꼬리/입 영역을 나누는 세로 스트립 개수(상수 → 물고기당 상수 시간 blit, NFR-PERF-002).
// 개수가 많을수록 곡면 근사가 매끈해진다(연속 워프에 근접). 물고기당 상수 비용이라
// 렉 개선은 그대로 유지되므로, 이전 벡터의 매끄러운 곡선 느낌을 위해 넉넉히 잡는다.
const TAIL_STRIPS = 24;
const MOUTH_STRIPS = 16;
// 인접 조각이 서로 다른 각도로 회전/이동하면 경계에 얇은 틈이 보일 수 있어, 각 조각을
// 살짝 겹쳐 그려(source·dest 폭에 +SEAM) 이음새를 감춘다.
const SEAM = 1;

// 물고기마다 다른 파닥임 위상을 id 에서 결정적으로 뽑는다(서로 엇박자로 흔들리게).
export function phaseFromId(id) {
  const s = typeof id === "string" ? id : String(id ?? "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

// 그림 내용 서명(cheap). 같은 id 라도 그림이 바뀌면 캐시를 무효화하기 위한 값(REQ-RENDER-002).
// 전체 JSON 비교는 비싸므로 버전·크기·가이드 + 래스터는 이미지 길이, 벡터는 획/점 수만으로 요약한다.
export function spriteSignature(drawing) {
  if (!drawing || typeof drawing !== "object") return "none";
  const base = `${drawing.version}:${drawing.width}x${drawing.height}:${drawing.tailFraction}:${drawing.mouthFraction}`;
  if (drawing.version === 2 || drawing.kind === "raster") {
    const img = typeof drawing.image === "string" ? drawing.image : "";
    return `${base}:r${img.length}`;
  }
  const strokes = Array.isArray(drawing.strokes) ? drawing.strokes : [];
  let pts = 0;
  for (const stroke of strokes) pts += stroke && stroke.points ? stroke.points.length : 0;
  return `${base}:v${strokes.length}.${pts}`;
}

// 오프스크린 캔버스 생성(2D 미지원/문서 없음 환경은 null → 렌더 무동작). jsdom 은 getContext 가 null.
function createOffscreen(w, h) {
  if (typeof document === "undefined" || typeof document.createElement !== "function") {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// 벡터 획을 오프스크린 캔버스에 "한 번" 평평하게(애니메이션 없이) 그린다. 이후 프레임은 이 비트맵을 blit.
function paintStrokes(octx, strokes) {
  for (const stroke of strokes) {
    if (!stroke || !stroke.points || stroke.points.length === 0) continue;
    octx.beginPath();
    octx.strokeStyle = stroke.color;
    octx.lineWidth = stroke.width;
    octx.lineJoin = "round";
    octx.lineCap = "round";
    octx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      octx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    octx.stroke();
  }
}

// 래스터(PNG data URL 등) 이미지를 디코드해 오프스크린 캔버스 규격(w×h)으로 그린다. 디코드는 비동기라
// 완료 시점에 entry.ready 를 세운다(로드 전에는 blit 이 무동작 → 잠깐 몸통이 안 보일 수 있으나 곧 표시).
function decodeRaster(image, octx, w, h, entry) {
  if (typeof image !== "string" || typeof Image === "undefined") return;
  const img = new Image();
  img.onload = () => {
    try {
      octx.clearRect(0, 0, w, h);
      octx.drawImage(img, 0, 0, w, h);
      entry.ready = true;
    } catch {
      /* 디코드 후 그리기 실패는 무시(해당 물고기만 미표시) */
    }
  };
  img.onerror = () => {
    /* 유효하지 않은 이미지는 미표시(서버 검증을 통과한 값이므로 정상 경로에선 드묾) */
  };
  try {
    img.src = image;
  } catch {
    /* data URL 할당 실패 무시 */
  }
}

// 그림 하나를 오프스크린 캔버스에 렌더한 캐시 엔트리를 만든다. 유효하지 않거나 캔버스 미지원이면 null.
function buildEntry(drawing) {
  if (!drawing || typeof drawing !== "object") return null;
  const isRaster = drawing.version === 2 || drawing.kind === "raster";
  // 벡터인데 strokes 가 없으면 그릴 게 없다(기존 조기 반환과 동일).
  if (!isRaster && !Array.isArray(drawing.strokes)) return null;

  const w = drawing.width || 300;
  const h = drawing.height || 200;
  const canvas = createOffscreen(w, h);
  if (!canvas) return null;
  let octx = null;
  try {
    octx = canvas.getContext("2d");
  } catch {
    octx = null;
  }
  if (!octx) return null;

  // 구버전(가이드 없음)은 기본값으로 폴백한다(REQ-ANIM-004 / REQ-COMPAT-002).
  const entry = {
    canvas,
    width: w,
    height: h,
    foldX: w * (drawing.tailFraction ?? TAIL_FOLD_FRACTION),
    mouthX: w * (drawing.mouthFraction ?? MOUTH_FRACTION),
    ready: false,
  };

  if (isRaster) {
    decodeRaster(drawing.image, octx, w, h, entry);
  } else {
    paintStrokes(octx, drawing.strokes);
    entry.ready = true;
  }
  return entry;
}

// @MX:ANCHOR: [AUTO] 물고기 비트맵 캐시 — 세 렌더러(FishTank/MyTank/스냅샷)가 공유하는 단일 캐싱 지점
// @MX:REASON: REQ-RENDER-001/002/003. 프레임마다 재-path/재디코드하지 않도록 물고기당 오프스크린
//   비트맵을 1회 생성해 재사용하고, 물고기 제거/그림 변경 시에만 무효화한다. 렌더 성능·회귀의 핵심 계약.
/**
 * 물고기 id별 오프스크린 비트맵 캐시를 만든다. 렌더러마다 하나씩 보유(useRef)한다.
 * @param {(drawing:object)=>object|null} [build] 엔트리 빌더(테스트 주입용). 기본은 실제 오프스크린 렌더.
 * @returns {{getEntry:(sprite:object)=>object|null, prune:(ids:Set)=>void, invalidate:(id:*)=>void, size:number}}
 */
export function createSpriteCache(build = buildEntry) {
  const entries = new Map(); // id → { entry, signature }

  return {
    // 스프라이트의 캐시 엔트리를 돌려준다. 없거나 그림이 바뀌었으면 새로 만든다(REQ-RENDER-002).
    getEntry(sprite) {
      const id = sprite && sprite.id;
      const drawing = sprite && sprite.drawing;
      if (id == null || !drawing) return null;
      const signature = spriteSignature(drawing);
      const existing = entries.get(id);
      if (existing && existing.signature === signature) return existing.entry;
      const entry = build(drawing); // null 이어도 캐싱해 매 프레임 재빌드를 막는다(bounded).
      entries.set(id, { entry, signature });
      return entry;
    },
    // 현재 존재하는 물고기 id 집합에 없는 엔트리를 제거한다(제거된 물고기 캐시 축출, 무한 증가 방지).
    prune(activeIds) {
      for (const id of entries.keys()) {
        if (!activeIds.has(id)) entries.delete(id);
      }
    },
    invalidate(id) {
      entries.delete(id);
    },
    get size() {
      return entries.size;
    },
  };
}

// 꼬리 영역(접힘선 왼쪽)을 세로 스트립으로 나눠 각 스트립을 접힘점(foldX, pivotY) 기준 회전으로 파닥이게
// 그린다. 회전각은 접힘선에서 멀수록(꼬리 끝) 크다 — 벡터 bendPoint 와 동일한 wave·factor 공식.
function drawTail(ctx, canvas, foldX, pivotY, h, wave) {
  if (foldX <= 0) return;
  const stripW = foldX / TAIL_STRIPS;
  for (let i = 0; i < TAIL_STRIPS; i += 1) {
    const sx = i * stripW;
    const cx = sx + stripW / 2;
    const factor = Math.min(1, (foldX - cx) / foldX); // 접힘선 0 → 꼬리 끝 1
    const angle = wave * factor;
    ctx.save();
    ctx.translate(foldX, pivotY);
    ctx.rotate(angle);
    ctx.translate(-foldX, -pivotY);
    // 다음 조각과 SEAM 만큼 겹쳐 그려 회전 경계의 틈을 감춘다(마지막 조각은 foldX 를 넘지 않게 클램프).
    const dw = Math.min(stripW + SEAM, foldX - sx);
    ctx.drawImage(canvas, sx, 0, dw, h, sx, 0, dw, h);
    ctx.restore();
  }
}

// 입 영역(입 경계선 오른쪽)을 세로 스트립으로 나눠 위/아래 절반을 벌린다. 벌림 폭은 스낫(오른쪽 끝)일수록
// 크다 — 벡터 chompPoint 와 동일한 factor·side 규칙(pivotY 위는 위로, 아래는 아래로). gape 0 이면 통짜 blit.
function drawMouth(ctx, canvas, mouthX, pivotY, w, h, gapePx) {
  const mouthW = w - mouthX;
  if (mouthW <= 0) return;
  if (gapePx <= 0) {
    ctx.drawImage(canvas, mouthX, 0, mouthW, h, mouthX, 0, mouthW, h);
    return;
  }
  const stripW = mouthW / MOUTH_STRIPS;
  const span = mouthW || 1;
  const topH = pivotY;
  const bottomH = h - pivotY;
  for (let i = 0; i < MOUTH_STRIPS; i += 1) {
    const sx = mouthX + i * stripW;
    const cx = sx + stripW / 2;
    const factor = Math.min(1, (cx - mouthX) / span); // 경첩 0 → 스낫 끝 1
    const off = gapePx * factor;
    // 인접 조각과 SEAM 만큼 겹쳐 그려 세로 틈을 감춘다(오른쪽 끝은 w 로 클램프).
    const dw = Math.min(stripW + SEAM, w - sx);
    // 원래 벡터처럼: 절반을 통째로 밀어내(찢기) 대신 위/아래 절반을 세로로 "늘여서" 벌린다.
    // pivotY 경계는 고정하고 위 절반은 위로, 아래 절반은 아래로 늘어나므로 가운데에 틈이 생기지
    // 않아 그림이 찢기지 않고 연속적으로 벌어진다(topH → topH+off, bottomH → bottomH+off).
    if (topH > 0) ctx.drawImage(canvas, sx, 0, dw, topH, sx, -off, dw, topH + off);
    if (bottomH > 0) {
      ctx.drawImage(canvas, sx, pivotY, dw, bottomH, sx, pivotY, dw, bottomH + off);
    }
  }
}

/**
 * 캐시된 물고기 비트맵을 스프라이트 위치에 방향(facing)·축소·꼬리 파닥임·입 벌림을 적용해 blit 한다.
 * 몸통(접힘선~입 경계)은 변형 없이, 꼬리는 회전 스트립, 입은 gape 스트립으로 그린다.
 * 벡터/래스터 무관하게 동일하게 적용된다(REQ-RENDER-001/003, REQ-COMPAT-002).
 *
 * @param {CanvasRenderingContext2D} ctx 대상 캔버스 컨텍스트
 * @param {{canvas:*, width:number, height:number, foldX:number, mouthX:number, ready:boolean}} entry 캐시 엔트리
 * @param {{x:number, y:number, facing:number, id:*, eat?:number}} sprite 스프라이트(위치/방향/먹이반응)
 * @param {number} now 프레임 타임스탬프(ms) — 꼬리/입 위상 계산용
 * @param {number} [itemScale=1] 개별 크기 배수(내 어항 scale). 기본 1.0.
 * @returns {boolean} 실제로 그렸으면 true(래스터 디코드 전이면 false)
 */
export function drawFishBitmap(ctx, entry, sprite, now, itemScale = 1) {
  if (!entry || !entry.ready || !entry.canvas) return false;
  const { canvas, width: w, height: h, foldX, mouthX } = entry;
  const pivotY = h / 2;

  const t = (typeof now === "number" ? now : 0) / 1000;
  const phase = phaseFromId(sprite.id);
  const wave = Math.sin(t * TAIL_SPEED + phase) * TAIL_MAX_ANGLE;
  // 입 벌림 폭(px): 먹이 반응 세기(eat)에 여닫는 오물거림을 곱한다(래스터에도 동일 적용).
  const eat = sprite.eat || 0;
  const chomp = 0.5 - 0.5 * Math.cos(t * CHOMP_SPEED + phase);
  const gapePx = eat * chomp * (h * MOUTH_MAX_OPEN);

  const facing = typeof sprite.facing === "number" ? sprite.facing : 1;
  ctx.save();
  ctx.translate(sprite.x, sprite.y);
  ctx.scale(facing * SPRITE_SCALE * itemScale, SPRITE_SCALE * itemScale); // 방향 반전 + 축소
  ctx.translate(-w / 2, -h / 2); // 그림 중심을 스프라이트 위치에 맞춤

  // 몸통(접힘선~입 경계)은 변형 없이 통짜 blit. 꼬리/입은 각자 영역에만 작용해 겹치지 않는다.
  const bodyW = mouthX - foldX;
  if (bodyW > 0) ctx.drawImage(canvas, foldX, 0, bodyW, h, foldX, 0, bodyW, h);
  drawTail(ctx, canvas, foldX, pivotY, h, wave);
  drawMouth(ctx, canvas, mouthX, pivotY, w, h, gapePx);

  ctx.restore();
  return true;
}
