// 어항 모션 모델(순수 함수). 캔버스 DOM/draw 호출과 분리해 위치·속도 로직만 담는다.
// (REQ-DRAW-003: 손그림 물고기가 헤엄치도록 애니메이션, NFR-PERF-001: 렌더링 상한)

// @MX:NOTE: [AUTO] 동시 애니메이션 상한. 수백 마리 이상에서도 프레임 저하를 막기 위한
//   성능 정책(NFR-PERF-001). 상한을 넘는 물고기는 정지 렌더(그림만 표시)한다.
export const MAX_ANIMATED = 200;

// 수평 유영 속도(px/s): 가로가 주된 이동축이므로 활발하게 잡는다.
const MIN_SPEED = 80;
const SPEED_RANGE = 65;

// 수평 위주 유영: 실제 물고기는 수평으로 다니고 수직 이동은 짧은 이벤트성이다.
// 스폰 시 수직 속도는 수평 대비 이 비율로 낮춘다.
const VERTICAL_SPEED_FACTOR = 0.35;
// 수평 복원: 매 초 수직 속도가 감쇠되는 비율(1/s). 조향으로 위아래로 가더라도
// 곧 수평 자세로 돌아온다(먹이 추적은 매 프레임 재조향되므로 잠수는 유지된다).
const LEVELING_RATE = 0.35;
// 최소 수평 속도(px/s, 배속 곱 전). 수직 감쇠 후에도 활발한 가로 이동을 보장한다.
const MIN_HORIZONTAL_SPEED = 80;

// 문자열 id → 결정적 32비트 해시(FNV-1a 계열). 같은 물고기는 항상 같은 스폰.
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 해시에서 파생한 0..1 의사난수(결정적). seed 를 조금씩 바꿔 여러 값을 뽑는다.
function unit(hash, salt) {
  const v = Math.imul(hash ^ salt, 2654435761) >>> 0;
  return v / 4294967296;
}

// 무리 성향을 가질 물고기 비율(id 해시 기반 결정적 추첨).
const SCHOOLING_RATIO = 0.35;
// 개성 배속 범위: 0.7(느긋) ~ 1.6(날쌤). 크기 보정 후 0.5~1.8 로 클램프.
const PACE_MIN = 0.7;
const PACE_RANGE = 0.9;

// 그린 그림의 실제 크기(0..1). 스트로크 바운딩 박스를 캔버스 대각선과 비교한다.
// 그림이 비어 있으면 중간값 0.5 를 쓴다(테스트/방어).
function drawnSizeNorm(drawing) {
  if (!drawing || !Array.isArray(drawing.strokes)) return 0.5;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const stroke of drawing.strokes) {
    for (const p of stroke.points ?? []) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      count += 1;
    }
  }
  if (count < 2) return 0.5;
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const canvasDiag = Math.hypot(drawing.width || 300, drawing.height || 200);
  return Math.min(1, diag / canvasDiag);
}

/**
 * 물고기의 유영 특성을 뽑는다(id·그림 크기 기반 결정적).
 * pace: 속도 배속 — 개성 난수에 "작을수록 날쌔고 클수록 느긋한" 크기 보정을 곱한다.
 * schooling: 무리지어 다니는 성향 여부.
 * @param {{id:string, drawing:object}} fish
 * @returns {{pace:number, schooling:boolean}}
 */
export function traitsFor(fish) {
  const h = hashId(fish.id);
  const basePace = PACE_MIN + unit(h, 7) * PACE_RANGE;
  const size = drawnSizeNorm(fish.drawing);
  const pace = Math.min(1.8, Math.max(0.5, basePace * (1.25 - 0.5 * size)));
  return { pace, schooling: unit(h, 8) < SCHOOLING_RATIO };
}

/**
 * 물고기 하나를 어항 스프라이트로 스폰한다. id 기반 결정적 초기 상태.
 * @param {{id:string, drawing:object, displayMode:string, displayName:string|null, createdAt:string}} fish
 * @param {{width:number, height:number}} bounds
 */
export function spawnSprite(fish, bounds) {
  const h = hashId(fish.id);
  const { pace, schooling } = traitsFor(fish);
  const x = unit(h, 1) * bounds.width;
  const y = unit(h, 2) * bounds.height;
  const speedX = (MIN_SPEED + unit(h, 3) * SPEED_RANGE) * pace;
  const speedY =
    (MIN_SPEED + unit(h, 4) * SPEED_RANGE) * pace * VERTICAL_SPEED_FACTOR;
  const dirX = unit(h, 5) < 0.5 ? -1 : 1;
  const dirY = unit(h, 6) < 0.5 ? -1 : 1;
  const vx = speedX * dirX;
  const vy = speedY * dirY;
  return {
    id: fish.id,
    x,
    y,
    vx,
    vy,
    facing: vx >= 0 ? 1 : -1,
    pace,
    schooling,
    drawing: fish.drawing,
    displayMode: fish.displayMode,
    displayName: fish.displayName ?? null,
    createdAt: fish.createdAt,
  };
}

// 가장자리 회피: 벽에서 이 거리(px) 안으로 들어오면 안쪽으로 미는 힘을 받는다.
export const EDGE_MARGIN = 90;
// 가장자리 회피 가속(px/s²). 벽에 가까울수록 강하게 안쪽으로 민다.
const EDGE_ACCEL = 160;

// 벽 근접도에 비례한 안쪽 방향 가속을 속도에 더한다(구석에 붙는 것 방지).
function steerAwayFromEdges(x, y, vx, vy, bounds, dt) {
  const m = Math.min(EDGE_MARGIN, bounds.width / 4, bounds.height / 4);
  if (x < m) vx += EDGE_ACCEL * (1 - x / m) * dt;
  else if (x > bounds.width - m) vx -= EDGE_ACCEL * (1 - (bounds.width - x) / m) * dt;
  if (y < m) vy += EDGE_ACCEL * (1 - y / m) * dt;
  else if (y > bounds.height - m) vy -= EDGE_ACCEL * (1 - (bounds.height - y) / m) * dt;
  return { vx, vy };
}

/**
 * 스프라이트를 한 프레임 전진시킨다. 벽 근처에서는 미리 안쪽으로 방향을 틀고,
 * 그래도 벽에 닿으면 반사한다(경계 내 유지).
 * @param {object} sprite
 * @param {number} dtMs - 경과 시간(ms)
 * @param {{width:number, height:number}} bounds
 */
export function stepSprite(sprite, dtMs, bounds) {
  const dt = dtMs / 1000;
  let { x, y, vx, vy, facing } = sprite;
  ({ vx, vy } = steerAwayFromEdges(x, y, vx, vy, bounds, dt));
  x += vx * dt;
  y += vy * dt;

  if (x <= 0) {
    x = 0;
    vx = Math.abs(vx);
  } else if (x >= bounds.width) {
    x = bounds.width;
    vx = -Math.abs(vx);
  }
  if (y <= 0) {
    y = 0;
    vy = Math.abs(vy);
  } else if (y >= bounds.height) {
    y = bounds.height;
    vy = -Math.abs(vy);
  }

  // 수평 복원: 수직 속도는 완만히 감쇠하고, 수평 속도는 최소치를 보장해
  // 세로축으로만 길게 오가는 움직임을 막는다.
  // 단, 좌우 가장자리 구간에서는 최소치 스냅을 건너뛴다 — 그래야 가장자리
  // 회피 감속이 벽 앞에서 방향을 되돌릴 수 있다(스냅이 감속을 무효화하는 것 방지).
  vy *= Math.max(0, 1 - LEVELING_RATE * dt);
  const m = Math.min(EDGE_MARGIN, bounds.width / 4, bounds.height / 4);
  const inHorizontalMargin = x < m || x > bounds.width - m;
  const minVx = MIN_HORIZONTAL_SPEED * (sprite.pace ?? 1);
  if (!inHorizontalMargin && Math.abs(vx) < minVx) {
    const dir = vx !== 0 ? Math.sign(vx) : facing >= 0 ? 1 : -1;
    vx = dir * minVx;
  }

  facing = vx >= 0 ? 1 : -1;
  return { ...sprite, x, y, vx, vy, facing };
}

// 모든 스프라이트를 한 프레임 전진시킨다(불변 갱신).
export function stepSprites(sprites, dtMs, bounds) {
  return sprites.map((s) => stepSprite(s, dtMs, bounds));
}

// 분리 조향: 이 거리(px) 안의 다른 물고기와는 서로 밀어낸다(겹침 방지).
export const SEPARATION_RADIUS = 70;
// 분리 가속(px/s²). 완전히 겹쳤을 때 이웃 1마리당 최대 밀어내는 힘.
const SEPARATION_ACCEL = 240;
// 조향으로 속도가 무한정 커지지 않게 하는 기준 상한(px/s). 물고기별 배속이 곱해진다.
const MAX_SPEED = 130;

// 속도를 물고기별 상한(기준 × 배속)으로 자른다.
function clampSpeed(vx, vy, pace = 1) {
  const cap = MAX_SPEED * pace;
  const speed = Math.hypot(vx, vy);
  if (speed <= cap) return { vx, vy };
  return { vx: (vx / speed) * cap, vy: (vy / speed) * cap };
}

/**
 * 물고기끼리 겹치지 않게 서로 밀어내는 분리 조향을 적용한다(불변 갱신).
 * 가까울수록 강하게 밀며, 정확히 같은 위치면 id 순서로 좌우로 갈라놓는다.
 * @param {object[]} sprites
 * @param {number} dtMs - 프레임 경과 시간(ms)
 * @returns {object[]}
 */
export function applySeparation(sprites, dtMs) {
  if (sprites.length < 2) return sprites;
  const dt = dtMs / 1000;
  const r = SEPARATION_RADIUS;

  return sprites.map((s, i) => {
    let pushX = 0;
    let pushY = 0;
    for (let j = 0; j < sprites.length; j += 1) {
      if (j === i) continue;
      const o = sprites[j];
      const dx = s.x - o.x;
      const dy = s.y - o.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= r) continue;
      if (dist < 0.001) {
        // 완전히 겹친 경우: 배열 순서 기준으로 좌/우로 밀어 결정적으로 갈라놓는다.
        pushX += i < j ? -1 : 1;
        continue;
      }
      const overlap = 1 - dist / r; // 가까울수록 1 에 가깝다
      pushX += (dx / dist) * overlap;
      pushY += (dy / dist) * overlap;
    }
    if (pushX === 0 && pushY === 0) return s;

    // 속도 상한: 분리 힘이 누적돼 폭주하지 않게 한다(물고기별 배속 반영).
    const { vx, vy } = clampSpeed(
      s.vx + pushX * SEPARATION_ACCEL * dt,
      s.vy + pushY * SEPARATION_ACCEL * dt,
      s.pace ?? 1,
    );
    return { ...s, vx, vy };
  });
}

// 무리 유영: 이 거리(px) 안의 다른 무리 물고기와 모이고 방향을 맞춘다.
export const SCHOOL_RADIUS = 220;
// 응집 가속(px/s²)과 정렬 수렴 계수(1/s). 분리 조향보다 약해 겹치지는 않는다.
const COHESION_ACCEL = 40;
const ALIGN_RATE = 1.2;

/**
 * 무리 성향(schooling) 물고기끼리 모이고(응집) 헤엄 방향을 맞춘다(정렬).
 * 분리 조향(applySeparation)과 함께 쓰면 보이드처럼 떼 지어 다닌다(불변 갱신).
 * @param {object[]} sprites
 * @param {number} dtMs - 프레임 경과 시간(ms)
 * @returns {object[]}
 */
export function applySchooling(sprites, dtMs) {
  if (sprites.length < 2) return sprites;
  const dt = dtMs / 1000;

  return sprites.map((s) => {
    if (!s.schooling) return s;
    let cx = 0;
    let cy = 0;
    let avx = 0;
    let avy = 0;
    let n = 0;
    for (const o of sprites) {
      if (o === s || !o.schooling) continue;
      if (Math.hypot(o.x - s.x, o.y - s.y) >= SCHOOL_RADIUS) continue;
      cx += o.x;
      cy += o.y;
      avx += o.vx;
      avy += o.vy;
      n += 1;
    }
    if (n === 0) return s;

    // 응집: 이웃 무리의 중심 쪽으로 가속. 정렬: 이웃 평균 속도로 수렴.
    const toCx = cx / n - s.x;
    const toCy = cy / n - s.y;
    const dist = Math.hypot(toCx, toCy) || 1;
    const t = Math.min(1, ALIGN_RATE * dt);
    const { vx, vy } = clampSpeed(
      s.vx + (toCx / dist) * COHESION_ACCEL * dt + (avx / n - s.vx) * t,
      s.vy + (toCy / dist) * COHESION_ACCEL * dt + (avy / n - s.vy) * t,
      s.pace ?? 1,
    );
    return { ...s, vx, vy };
  });
}

// 동시에 애니메이션할 스프라이트를 상한선으로 제한한다(NFR-PERF-001).
export function selectAnimated(sprites, cap = MAX_ANIMATED) {
  return sprites.length <= cap ? sprites : sprites.slice(0, cap);
}
