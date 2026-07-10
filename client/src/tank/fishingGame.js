// 낚시 미니게임 순수 로직(캔버스/DOM과 분리). 찌(bobber)와 헤엄치는 물고기의
// 거리 기반 입질 판정 + 던지기→입질→(건짐|도망) 상태 기계를 담아 단위 테스트한다.
// (SPEC-CATCH-001: REQ-CATCH-001/003/005, REQ-PRIV-002, NFR-A11Y-001)

// @MX:NOTE: [AUTO] 입질 판정 반경(px, 캔버스 좌표계). 물고기 중심이 이 반경 안으로
//   들어오면 입질로 본다. 게임 난도(입질이 쉽게 오는 정도) 튜닝 지점.
export const BITE_RADIUS = 70;

// @MX:NOTE: [AUTO] 입질 유지 시간(ms). 입질 시작 후 이 시간 안에 건져올리지 못하면
//   물고기가 미끼만 먹고 도망친다(ESCAPED). 게임 타이밍 난도 튜닝 지점.
export const BITE_WINDOW_MS = 2000;

// @MX:NOTE: [AUTO] 물고기가 찌 반경에 새로 진입할 때마다 실제로 무는(hook) 확률.
//   진입할 때 딱 한 번만 굴린다(매 틱 재굴림 아님) — 실패하면 그냥 스쳐 지나간다.
//   게임 난도(입질이 얼마나 잘 오는지) 튜닝 지점. 0..1.
export const BITE_CHANCE = 0.5;

// 상태 기계의 단계. idle: 대기 / cast: 찌 투척 후 입질 대기 /
// biting: 입질 중(건짐 타이밍 창) / caught: 건짐 성공 / escaped: 미끼만 먹고 도망.
export const IDLE = "idle";
export const CAST = "cast";
export const BITING = "biting";
export const CAUGHT = "caught";
export const ESCAPED = "escaped";

/**
 * 게임 초기 상태. useReducer 의 초기값 팩토리로도 쓴다.
 * @returns {{phase:string, bobber:{x:number,y:number}|null, biterId:string|null, biteStart:number|null}}
 */
export function initialGameState() {
  return { phase: IDLE, bobber: null, biterId: null, biteStart: null, caughtAt: null };
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
 * 낚시 상태 기계(순수 리듀서). 유효하지 않은 전이는 상태를 그대로 반환한다.
 *
 * 전이:
 *   idle   --CAST(x,y)-->        cast
 *   cast   --BITE(biterId,now)--> biting
 *   biting --TICK(now, 창 경과)-->  escaped
 *   biting --REEL-->             caught
 *   *      --CLEAR-->            idle
 *
 * @param {ReturnType<typeof initialGameState>} state
 * @param {{type:string, x?:number, y?:number, biterId?:string, now?:number, window?:number}} action
 */
export function gameReducer(state, action) {
  switch (action.type) {
    case "CAST":
      // 찌는 한 번에 하나만: 대기(idle) 상태에서만 새로 던질 수 있다.
      if (state.phase !== IDLE) return state;
      return {
        phase: CAST,
        bobber: { x: action.x, y: action.y },
        biterId: null,
        biteStart: null,
      };

    case "BITE":
      // 입질은 투척(cast) 상태에서만 시작된다. biterId 없는 BITE 는 무시.
      if (state.phase !== CAST || !action.biterId) return state;
      return {
        ...state,
        phase: BITING,
        biterId: action.biterId,
        biteStart: action.now ?? 0,
      };

    case "TICK": {
      // 입질 중일 때만 도망 판정. 창(window) 이 경과하면 미끼만 먹고 도망(ESCAPED).
      if (state.phase !== BITING) return state;
      const window = action.window ?? BITE_WINDOW_MS;
      if ((action.now ?? 0) - (state.biteStart ?? 0) >= window) {
        return { ...state, phase: ESCAPED };
      }
      return state;
    }

    case "REEL":
      // 건져올리기는 오직 입질 중(타이밍 창 안)에만 성공한다. caughtAt 은 끌어올리기 모션 진행도 기준점.
      if (state.phase !== BITING) return state;
      return { ...state, phase: CAUGHT, caughtAt: action.now ?? 0 };

    case "CLEAR":
      return initialGameState();

    default:
      return state;
  }
}
