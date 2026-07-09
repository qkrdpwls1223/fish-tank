// 어항 모션 모델(순수 함수). 캔버스 DOM/draw 호출과 분리해 위치·속도 로직만 담는다.
// (REQ-DRAW-003: 손그림 물고기가 헤엄치도록 애니메이션, NFR-PERF-001: 렌더링 상한)

// @MX:NOTE: [AUTO] 동시 애니메이션 상한. 수백 마리 이상에서도 프레임 저하를 막기 위한
//   성능 정책(NFR-PERF-001). 상한을 넘는 물고기는 정지 렌더(그림만 표시)한다.
export const MAX_ANIMATED = 200;

const MIN_SPEED = 20; // px/s
const SPEED_RANGE = 60; // px/s

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

/**
 * 물고기 하나를 어항 스프라이트로 스폰한다. id 기반 결정적 초기 상태.
 * @param {{id:string, drawing:object, displayMode:string, displayName:string|null, createdAt:string}} fish
 * @param {{width:number, height:number}} bounds
 */
export function spawnSprite(fish, bounds) {
  const h = hashId(fish.id);
  const x = unit(h, 1) * bounds.width;
  const y = unit(h, 2) * bounds.height;
  const speedX = MIN_SPEED + unit(h, 3) * SPEED_RANGE;
  const speedY = MIN_SPEED + unit(h, 4) * SPEED_RANGE;
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
    drawing: fish.drawing,
    displayMode: fish.displayMode,
    displayName: fish.displayName ?? null,
    createdAt: fish.createdAt,
  };
}

/**
 * 스프라이트를 한 프레임 전진시킨다. 벽에 닿으면 반사한다(경계 내 유지).
 * @param {object} sprite
 * @param {number} dtMs - 경과 시간(ms)
 * @param {{width:number, height:number}} bounds
 */
export function stepSprite(sprite, dtMs, bounds) {
  const dt = dtMs / 1000;
  let { x, y, vx, vy, facing } = sprite;
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

  facing = vx >= 0 ? 1 : -1;
  return { ...sprite, x, y, vx, vy, facing };
}

// 모든 스프라이트를 한 프레임 전진시킨다(불변 갱신).
export function stepSprites(sprites, dtMs, bounds) {
  return sprites.map((s) => stepSprite(s, dtMs, bounds));
}

// 동시에 애니메이션할 스프라이트를 상한선으로 제한한다(NFR-PERF-001).
export function selectAnimated(sprites, cap = MAX_ANIMATED) {
  return sprites.length <= cap ? sprites : sprites.slice(0, cap);
}
