// 낚시 미니게임 순수 로직(캔버스/DOM과 분리). 찌(bobber)와 헤엄치는 물고기의
// 거리 기반 입질 판정 + 던지기→입질→(건짐|도망) 상태 기계를 담아 단위 테스트한다.
// (SPEC-CATCH-001: REQ-CATCH-001/003/005, REQ-PRIV-002, NFR-A11Y-001)

// @MX:NOTE: [AUTO] 입질 판정 반경(px, 캔버스 좌표계). 물고기 중심이 이 반경 안으로
//   들어오면 입질로 본다. 게임 난도(입질이 쉽게 오는 정도) 튜닝 지점.
export const BITE_RADIUS = 70;

// @MX:NOTE: [AUTO] 본신(strike) 유지 시간(ms). 찌가 쑥 들어간 뒤 이 시간 안에 건져올리지 못하면
//   물고기가 미끼만 먹고 도망친다(ESCAPED). 챔질 타이밍 난도 튜닝 지점.
export const BITE_WINDOW_MS = 2000;

// @MX:NOTE: [AUTO] 예신(nibble) 지속 시간(ms). 물고기가 문 직후 톡톡 건드리는 전조 단계.
//   이 시간이 지나면 본신(strike, BITING)으로 전이되어 챔질 창이 열린다. 튜닝 지점.
export const NIBBLE_MS = 500;

// @MX:NOTE: [AUTO] 물고기가 찌 반경에 새로 진입할 때마다 실제로 무는(hook) 확률.
//   진입할 때 딱 한 번만 굴린다(매 틱 재굴림 아님) — 실패하면 그냥 스쳐 지나간다.
//   게임 난도(입질이 얼마나 잘 오는지) 튜닝 지점. 0..1.
export const BITE_CHANCE = 0.5;

// @MX:NOTE: [AUTO] 반경 안에 "머무는"(진입 굴림에 실패했거나 이미 있던) 물고기를 다시 굴리는 주기(ms).
//   진입 1회 굴림만으로는 "던져놓고 한참 무반응"이 잦아, 이 주기마다 체류 물고기를 재굴림해
//   대기 수 초 내 대체로 입질이 오게 한다(RESIDENT_BITE_CHANCE 와 함께 난도 균형). 튜닝 지점.
export const RESIDENT_BITE_INTERVAL_MS = 900;
// @MX:NOTE: [AUTO] 체류 물고기 재굴림 1회당 무는 확률(0..1). 진입 굴림(BITE_CHANCE)보다 낮게 두어
//   즉시 물지는 않되, 여러 번 재굴림되며 결국 입질이 오도록 하는 값. 튜닝 지점.
export const RESIDENT_BITE_CHANCE = 0.35;

// @MX:NOTE: [AUTO] 미끼 유인 반경(px). BITE_RADIUS 보다 넓다 — 이 반경 안 물고기는 찌 쪽으로 약하게
//   끌려와, 던져만 놓고 물고기가 근처로 오지 않아 무반응인 상황을 줄인다. 튜닝 지점.
export const LURE_RADIUS = 180;
// @MX:NOTE: [AUTO] 유인 가속 상한(px/s²). 찌에 가까울수록 이 값에 비례해 강해진다(선형). 약한 힘.
export const LURE_ACCEL = 90;
// @MX:NOTE: [AUTO] 유인으로 더해진 뒤 물고기 속도의 상한(px/s). 부자연스러운 급가속을 막는다.
export const LURE_MAX_SPEED = 150;

// 상태 기계의 단계.
//   idle:    대기(찌 없음)
//   cast:    찌 투척 후 입질 대기
//   nibble:  예신 — 물고기가 문 직후 톡톡 건드리는 전조(챔질 아직 불가)
//   biting:  본신(strike) — 찌가 쑥 들어감. 건짐 타이밍 창이 열린다(챔질 가능)
//   caught:  건짐 성공
//   escaped: 미끼만 먹고 도망
export const IDLE = "idle";
export const CAST = "cast";
export const NIBBLE = "nibble";
export const BITING = "biting";
export const CAUGHT = "caught";
export const ESCAPED = "escaped";

/**
 * 게임 초기 상태. useReducer 의 초기값 팩토리로도 쓴다.
 * @returns {{phase:string, bobber:{x:number,y:number}|null, biterId:string|null, biteStart:number|null}}
 */
export function initialGameState() {
  return {
    phase: IDLE,
    bobber: null,
    biterId: null,
    castAt: null, // 캐스트 시각(찌 날아가는 포물선 연출 진행도 기준)
    nibbleStart: null, // 예신 시작 시각
    biteStart: null, // 본신(strike) 시작 시각 = 챔질 창 기준
    caughtAt: null, // 건짐 성공 시각(끌어올리기 모션 기준)
  };
}

// 두 점 사이 유클리드 거리(px).
export function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 찌 반경 안에서 가장 가까운 물고기 id 를 찾는다(입질 후보). 없으면 null.
 * @param {{id:string,x:number,y:number}[]} positions - 현재 렌더 위치들(어항 시뮬레이션 실제 좌표)
 * @param {{x:number,y:number}|null} bobber - 찌 위치
 * @param {number} [radius=BITE_RADIUS]
 * @returns {string|null}
 */
export function findBiter(positions, bobber, radius = BITE_RADIUS) {
  if (!bobber || !Array.isArray(positions)) return null;
  let best = null;
  let bestDist = Infinity;
  for (const p of positions) {
    const d = distance(p.x, p.y, bobber.x, bobber.y);
    if (d <= radius && d < bestDist) {
      best = p.id;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 찌 반경 안에 있는 모든 물고기 id 집합을 반환한다(진입/이탈 추적용).
 * 매 틱 이 집합을 이전 집합과 비교해 "새로 진입한" 물고기만 확률 굴림한다.
 * @param {{id:string,x:number,y:number}[]} positions
 * @param {{x:number,y:number}|null} bobber
 * @param {number} [radius=BITE_RADIUS]
 * @returns {Set<string>}
 */
export function fishInZone(positions, bobber, radius = BITE_RADIUS) {
  const inZone = new Set();
  if (!bobber || !Array.isArray(positions)) return inZone;
  for (const p of positions) {
    if (distance(p.x, p.y, bobber.x, bobber.y) <= radius) inZone.add(p.id);
  }
  return inZone;
}

/**
 * 새로 반경에 진입한 물고기들 중 확률 굴림에 성공한 첫 물고기를 무는(hook) 후보로 고른다.
 * 진입할 때 한 번만 굴리므로(매 틱 재굴림 아님) 오래 머물러도 입질이 사실상 확정되지 않는다.
 * @param {Iterable<string>} freshIds - 이번에 새로 진입한 물고기 id 들
 * @param {number} [chance=BITE_CHANCE] - 무는 확률(0..1)
 * @param {()=>number} [rng=Math.random] - 난수원(테스트 주입용)
 * @returns {string|null}
 */
export function rollBiter(freshIds, chance = BITE_CHANCE, rng = Math.random) {
  for (const id of freshIds) {
    if (rng() < chance) return id;
  }
  return null;
}

/**
 * 반경 안에 "머무는" 물고기를 주기적으로 재굴림해 입질 후보를 고른다(진입 1회 굴림 보완).
 * 마지막 굴림(lastRollAt)에서 intervalMs 가 지났을 때만 굴리고, 굴렸으면(성공/실패 무관)
 * rolledAt 을 now 로 갱신한다 — 호출부는 이 rolledAt 을 다음 호출의 lastRollAt 으로 넘긴다.
 * lastRollAt 이 null 이면(캐스트 직후 첫 호출) 간격을 기다리지 않고 즉시 굴린다.
 * @param {Iterable<string>} zoneIds - 현재 반경 안 물고기 id 들(신규/체류 모두)
 * @param {number} nowMs - 현재 시각(ms)
 * @param {number|null} lastRollAt - 마지막 재굴림 시각(ms). 아직 없으면 null.
 * @param {number} [intervalMs=RESIDENT_BITE_INTERVAL_MS] - 재굴림 주기
 * @param {number} [chance=RESIDENT_BITE_CHANCE] - 재굴림 1회당 무는 확률(0..1)
 * @param {()=>number} [rng=Math.random] - 난수원(테스트 주입용)
 * @returns {{biterId:string|null, rolledAt:number}}
 */
export function rollResidentBiter(
  zoneIds,
  nowMs,
  lastRollAt,
  intervalMs = RESIDENT_BITE_INTERVAL_MS,
  chance = RESIDENT_BITE_CHANCE,
  rng = Math.random,
) {
  // 아직 재굴림 간격이 안 됐으면 굴리지 않고 마지막 굴림 시각을 그대로 유지한다.
  if (lastRollAt != null && nowMs - lastRollAt < intervalMs) {
    return { biterId: null, rolledAt: lastRollAt };
  }
  let biterId = null;
  for (const id of zoneIds) {
    if (rng() < chance) {
      biterId = id;
      break;
    }
  }
  return { biterId, rolledAt: nowMs };
}

/**
 * 유인(lure): 찌 반경(LURE_RADIUS) 안 물고기의 속도에 찌 방향 성분을 약하게 더한다.
 * 찌에 가까울수록 강하게(선형) 끌리며, 결과 속도는 maxSpeed 로 잘라 급가속을 막는다.
 * 공유/개인 어항 유영과 무관한 순수 함수 — 호출부(FishTank)에서 낚시 중 찌가 물에 있을 때만 쓴다.
 * @param {{x:number,y:number,vx:number,vy:number}} sprite - 물고기 스프라이트(위치/속도)
 * @param {{x:number,y:number}|null} bobber - 찌 위치(없으면 유인 없음)
 * @param {number} dtMs - 프레임 경과 시간(ms)
 * @param {number} [radius=LURE_RADIUS]
 * @param {number} [accel=LURE_ACCEL] - 유인 가속 상한(px/s²)
 * @param {number} [maxSpeed=LURE_MAX_SPEED] - 결과 속도 상한(px/s)
 * @returns {{vx:number, vy:number}}
 */
export function lureVelocity(
  sprite,
  bobber,
  dtMs,
  radius = LURE_RADIUS,
  accel = LURE_ACCEL,
  maxSpeed = LURE_MAX_SPEED,
) {
  if (!bobber) return { vx: sprite.vx, vy: sprite.vy };
  const dx = bobber.x - sprite.x;
  const dy = bobber.y - sprite.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius || dist < 1e-6) return { vx: sprite.vx, vy: sprite.vy };
  const dt = dtMs / 1000;
  // 가까울수록 강한 유인(선형: 반경 밖 0 → 찌 위치 accel).
  const strength = accel * (1 - dist / radius);
  let vx = sprite.vx + (dx / dist) * strength * dt;
  let vy = sprite.vy + (dy / dist) * strength * dt;
  const speed = Math.hypot(vx, vy);
  if (speed > maxSpeed) {
    vx = (vx / speed) * maxSpeed;
    vy = (vy / speed) * maxSpeed;
  }
  return { vx, vy };
}

/**
 * 스프라이트 배열에 유인(lureVelocity)을 일괄 적용한다(불변 갱신).
 * 반경 밖이라 속도가 그대로인 물고기는 원본 참조를 유지한다(불필요한 재생성 방지).
 * @param {object[]} sprites
 * @param {{x:number,y:number}|null} bobber
 * @param {number} dtMs
 * @param {number} [radius]
 * @param {number} [accel]
 * @param {number} [maxSpeed]
 * @returns {object[]}
 */
export function applyLure(sprites, bobber, dtMs, radius, accel, maxSpeed) {
  if (!bobber) return sprites;
  return sprites.map((s) => {
    const { vx, vy } = lureVelocity(s, bobber, dtMs, radius, accel, maxSpeed);
    if (vx === s.vx && vy === s.vy) return s;
    return { ...s, vx, vy };
  });
}

/**
 * 낚시 상태 기계(순수 리듀서). 유효하지 않은 전이는 상태를 그대로 반환한다.
 *
 * 전이:
 *   idle   --CAST(x,y,now)-->        cast
 *   cast   --BITE(biterId,now)-->    nibble   (예신 시작)
 *   nibble --TICK(now, 예신 경과)-->   biting   (본신/strike, 챔질 창 열림)
 *   biting --TICK(now, 창 경과)-->     escaped
 *   biting --REEL(now)-->            caught
 *   *      --CLEAR-->                idle
 *
 * @param {ReturnType<typeof initialGameState>} state
 * @param {{type:string, x?:number, y?:number, biterId?:string, now?:number, window?:number, nibbleMs?:number}} action
 */
export function gameReducer(state, action) {
  switch (action.type) {
    case "CAST":
      // 찌는 한 번에 하나만: 대기(idle) 상태에서만 새로 던질 수 있다.
      if (state.phase !== IDLE) return state;
      return {
        ...initialGameState(),
        phase: CAST,
        bobber: { x: action.x, y: action.y },
        castAt: action.now ?? 0,
      };

    case "BITE":
      // 입질(예신)은 투척(cast) 상태에서만 시작된다. biterId 없는 BITE 는 무시.
      if (state.phase !== CAST || !action.biterId) return state;
      return {
        ...state,
        phase: NIBBLE,
        biterId: action.biterId,
        nibbleStart: action.now ?? 0,
        biteStart: null,
      };

    case "TICK": {
      const now = action.now ?? 0;
      // 예신 → 본신(strike): 예신 시간이 지나면 찌가 쑥 들어가며 챔질 창이 열린다.
      if (state.phase === NIBBLE) {
        const nibbleMs = action.nibbleMs ?? NIBBLE_MS;
        if (now - (state.nibbleStart ?? 0) >= nibbleMs) {
          return { ...state, phase: BITING, biteStart: now };
        }
        return state;
      }
      // 본신 유지 중 창(window)이 경과하면 미끼만 먹고 도망(ESCAPED).
      if (state.phase === BITING) {
        const window = action.window ?? BITE_WINDOW_MS;
        if (now - (state.biteStart ?? 0) >= window) {
          return { ...state, phase: ESCAPED };
        }
        return state;
      }
      return state;
    }

    case "REEL":
      // 건져올리기는 오직 본신(strike, 타이밍 창 안)에만 성공한다. 예신 중 챔질은 헛챔질(무시).
      if (state.phase !== BITING) return state;
      return { ...state, phase: CAUGHT, caughtAt: action.now ?? 0 };

    case "CLEAR":
      return initialGameState();

    default:
      return state;
  }
}
