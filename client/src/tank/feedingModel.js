// 먹이주기 모션 모델(순수 함수). 캔버스 DOM/draw 호출과 분리해 먹이 수명과
// 물고기 반응(먹이 쪽으로 이동) 로직만 담는다 (REQ-INT-001).

// @MX:NOTE: [AUTO] 먹이 수명(ms). 이 시간이 지나면 먹이는 사라지고 반응도 종료된다.
export const FOOD_LIFE_MS = 6000;

// @MX:NOTE: [AUTO] 먹이 반응 가속 성분(px/s). 한 프레임 반응 시 먹이 방향으로 더해지는 속도.
export const FEED_ACCEL = 40;

let foodSeq = 0;

/**
 * 특정 좌표에 먹이 한 개를 떨어뜨린다. 저장 없이 클라이언트 전용 임시 아이템이다.
 * @param {{x:number, y:number}} pos
 * @param {number} [now] - 현재 시각(ms). 결정성/테스트를 위해 주입 가능.
 * @returns {{id:string, x:number, y:number, remainingMs:number}}
 */
export function dropFood({ x, y }, now = 0) {
  foodSeq += 1;
  return {
    id: `food-${now}-${foodSeq}`,
    x,
    y,
    remainingMs: FOOD_LIFE_MS,
  };
}

// 먹이 하나의 남은 수명을 경과 시간만큼 줄인다(불변 갱신).
export function stepFood(food, dtMs) {
  return { ...food, remainingMs: food.remainingMs - dtMs };
}

// 아직 수명이 남은 먹이인지 판정한다.
export function isFoodAlive(food) {
  return food.remainingMs > 0;
}

// 모든 먹이를 전진시키고 수명이 다한 먹이를 제거한다.
export function stepFoods(foods, dtMs) {
  return foods.map((f) => stepFood(f, dtMs)).filter(isFoodAlive);
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
 * 스프라이트를 가장 가까운 먹이 쪽으로 당겨 반응시킨다(속도에 먹이 방향 성분 가산).
 * 먹이가 없으면 원본을 그대로 반환한다.
 * @param {object} sprite
 * @param {object[]} foods
 * @returns {object}
 */
export function reactToFood(sprite, foods) {
  const food = nearestFood(sprite, foods);
  if (!food) return sprite;

  const dx = food.x - sprite.x;
  const dy = food.y - sprite.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const vx = sprite.vx + ux * FEED_ACCEL;
  const vy = sprite.vy + uy * FEED_ACCEL;
  // 반응 중에는 (속도 부호가 아직 못 뒤집혀도) 먹이 쪽을 바라보게 한다.
  return { ...sprite, vx, vy, facing: ux >= 0 ? 1 : -1 };
}

// 모든 스프라이트에 먹이 반응을 적용한다(불변 갱신).
export function reactToFoods(sprites, foods) {
  if (foods.length === 0) return sprites;
  return sprites.map((s) => reactToFood(s, foods));
}
