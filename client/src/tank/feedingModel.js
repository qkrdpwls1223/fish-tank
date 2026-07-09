// 먹이주기 모션 모델(순수 함수). 캔버스 DOM/draw 호출과 분리해 먹이 살포·침강·수명과
// 물고기 반응(먹이 추적·섭취) 로직만 담는다 (REQ-INT-001).

// @MX:NOTE: [AUTO] 먹이 수명(ms). 이 시간이 지나도 안 먹힌 먹이는 사라진다(잔여물 방지).
export const FOOD_LIFE_MS = 20000;

// @MX:NOTE: [AUTO] 한 번의 먹이주기에 살포되는 알갱이 개수.
export const FOOD_COUNT = 10;

// 먹이 추적 목표 속도(px/s). 물고기는 이 속도를 향해 수렴하며, 넘어서 폭주하지 않는다.
export const CHASE_SPEED = 110;

// 조향 계수(1/s). 클수록 먹이 방향으로 속도가 빨리 수렴한다.
const STEER_RATE = 4.5;

// 물고기 중심이 먹이에 이 거리(px) 안으로 들어오면 먹은 것으로 판정한다.
export const EAT_RADIUS = 26;

// 알갱이 침강 속도 범위(px/s)와 살포 시 흩어지는 폭(px).
const SINK_MIN = 16;
const SINK_RANGE = 16;
const SCATTER_X = 180;
const SCATTER_Y = 26;

// 먹이를 노릴 때 물고기마다 다른 자리(알갱이 주변 원형 오프셋)를 노리게 하는 반경.
// EAT_RADIUS 보다 작아야 자리에 도착한 물고기가 먹이를 먹을 수 있다.
const TARGET_OFFSET_RADIUS = 15;

let foodSeq = 0;

// 문자열 id → 결정적 해시. 물고기별 목표 오프셋 각도를 뽑는 데 쓴다.
function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 알갱이 한 개를 만든다(내부 공용).
function makeFood(x, y, vx, vy, now) {
  foodSeq += 1;
  return { id: `food-${now}-${foodSeq}`, x, y, vx, vy, remainingMs: FOOD_LIFE_MS };
}

/**
 * 특정 좌표에 먹이 한 개를 떨어뜨린다. 저장 없이 클라이언트 전용 임시 아이템이다.
 * @param {{x:number, y:number}} pos
 * @param {number} [now] - 현재 시각(ms). 결정성/테스트를 위해 주입 가능.
 * @returns {{id:string, x:number, y:number, vx:number, vy:number, remainingMs:number}}
 */
export function dropFood({ x, y }, now = 0) {
  return makeFood(x, y, 0, SINK_MIN, now);
}

/**
 * 살포 중심점 주변에 알갱이 FOOD_COUNT 개를 흩뿌린다(REQ-INT-001).
 * 각 알갱이는 서로 다른 위치·침강 속도를 가져 자연스럽게 퍼지며 가라앉는다.
 * @param {{x:number, y:number}} center - 살포 중심(실시간 공유 시 이 좌표만 전파된다)
 * @param {number} [now] - 현재 시각(ms)
 * @param {() => number} [rand] - 0..1 난수원(테스트 결정성 주입용)
 * @returns {object[]} 알갱이 배열
 */
export function scatterFood(center, now = 0, rand = Math.random) {
  const foods = [];
  for (let i = 0; i < FOOD_COUNT; i += 1) {
    const x = center.x + (rand() - 0.5) * SCATTER_X;
    const y = center.y + (rand() - 0.5) * SCATTER_Y;
    const vx = (rand() - 0.5) * 10; // 미세한 좌우 표류
    const vy = SINK_MIN + rand() * SINK_RANGE; // 알갱이마다 다른 침강 속도
    foods.push(makeFood(x, y, vx, vy, now));
  }
  return foods;
}

/**
 * 먹이 하나를 전진시킨다: 천천히 가라앉고 수명이 줄어든다(불변 갱신).
 * bounds 가 주어지면 바닥/양옆을 벗어나지 않게 멈춘다(바닥에 내려앉음).
 * @param {object} food
 * @param {number} dtMs
 * @param {{width:number, height:number}} [bounds]
 */
export function stepFood(food, dtMs, bounds) {
  const dt = dtMs / 1000;
  let x = food.x + (food.vx ?? 0) * dt;
  let y = food.y + (food.vy ?? 0) * dt;
  if (bounds) {
    const floor = bounds.height - 8; // 모래 바닥 위에 살짝 얹힘
    if (y > floor) y = floor;
    x = Math.min(Math.max(x, 4), bounds.width - 4);
  }
  return { ...food, x, y, remainingMs: food.remainingMs - dtMs };
}

// 아직 수명이 남은 먹이인지 판정한다.
export function isFoodAlive(food) {
  return food.remainingMs > 0;
}

// 모든 먹이를 전진시키고 수명이 다한 먹이를 제거한다.
export function stepFoods(foods, dtMs, bounds) {
  return foods.map((f) => stepFood(f, dtMs, bounds)).filter(isFoodAlive);
}

// 스프라이트에서 가장 가까운 살아있는 먹이를 찾는다(없으면 null).
function nearestFood(sprite, foods) {
  let best = null;
  let bestDist = Infinity;
  for (const food of foods) {
    if (!isFoodAlive(food)) continue;
    const dx = food.x - sprite.x;
    const dy = food.y - sprite.y;
    const dist = dx * dx + dy * dy; // 제곱 거리로 충분(비교용)
    if (dist < bestDist) {
      bestDist = dist;
      best = food;
    }
  }
  return best;
}

/**
 * 스프라이트를 가장 가까운 먹이 쪽으로 조향한다. 속도를 "먹이 방향 × CHASE_SPEED"
 * 목표치로 수렴시키므로 아무리 오래 반응해도 속도가 폭주하지 않는다.
 * 목표 지점은 알갱이 정중앙이 아니라 물고기 id 로 정해지는 주변 자리라서,
 * 같은 알갱이를 노리는 물고기들이 한 점에 겹치지 않고 둘러싼다.
 * 먹이가 없으면 원본을 그대로 반환한다.
 * @param {object} sprite
 * @param {object[]} foods
 * @param {number} [dtMs] - 프레임 경과 시간(ms)
 * @returns {object}
 */
export function reactToFood(sprite, foods, dtMs = 16) {
  const food = nearestFood(sprite, foods);
  if (!food) return sprite;

  // 물고기별 고유 자리: 알갱이 주변 원 위의 결정적 오프셋(EAT_RADIUS 이내).
  const angle = (hashId(sprite.id) % 360) * (Math.PI / 180);
  const aimX = food.x + Math.cos(angle) * TARGET_OFFSET_RADIUS;
  const aimY = food.y + Math.sin(angle) * TARGET_OFFSET_RADIUS;

  const dx = aimX - sprite.x;
  const dy = aimY - sprite.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  // 목표 속도(먹이 방향 × 물고기별 배속)로 지수 수렴. t 는 0..1 보간 비율.
  const chase = CHASE_SPEED * (sprite.pace ?? 1);
  const t = Math.min(1, STEER_RATE * (dtMs / 1000));
  const vx = sprite.vx + (ux * chase - sprite.vx) * t;
  const vy = sprite.vy + (uy * chase - sprite.vy) * t;
  // 반응 중에는 (속도 부호가 아직 못 뒤집혀도) 먹이 쪽을 바라보게 한다.
  return { ...sprite, vx, vy, facing: ux >= 0 ? 1 : -1 };
}

// 모든 스프라이트에 먹이 반응을 적용한다(불변 갱신).
export function reactToFoods(sprites, foods, dtMs = 16) {
  if (foods.length === 0) return sprites;
  return sprites.map((s) => reactToFood(s, foods, dtMs));
}

/**
 * 물고기가 닿은 먹이를 제거한다(섭취, REQ-INT-001). 물고기 중심에서 EAT_RADIUS
 * 이내의 알갱이는 먹힌 것으로 보고 배열에서 사라진다.
 * @param {object[]} sprites
 * @param {object[]} foods
 * @param {number} [radius]
 * @returns {object[]} 먹히지 않고 남은 먹이 배열
 */
export function consumeFoods(sprites, foods, radius = EAT_RADIUS) {
  if (foods.length === 0 || sprites.length === 0) return foods;
  const r2 = radius * radius;
  return foods.filter((food) => {
    for (const s of sprites) {
      const dx = food.x - s.x;
      const dy = food.y - s.y;
      if (dx * dx + dy * dy <= r2) return false; // 먹힘
    }
    return true;
  });
}
