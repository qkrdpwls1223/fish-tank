import { describe, it, expect } from "vitest";
import {
  BITE_RADIUS,
  BITE_WINDOW_MS,
  BITE_CHANCE,
  NIBBLE_MS,
  LURE_RADIUS,
  RESIDENT_BITE_INTERVAL_MS,
  RESIDENT_BITE_CHANCE,
  IDLE,
  CAST,
  NIBBLE,
  BITING,
  CAUGHT,
  ESCAPED,
  initialGameState,
  distance,
  findBiter,
  fishInZone,
  rollBiter,
  rollResidentBiter,
  lureVelocity,
  applyLure,
  gameReducer,
} from "./fishingGame.js";

// 낚시 미니게임 순수 로직 (SPEC-CATCH-001).
// 캔버스 없이 입질 판정과 상태 기계 전이(도망/건짐)를 검증한다.

describe("findBiter (입질 판정 — 거리 기반)", () => {
  const bobber = { x: 100, y: 100 };

  it("반경 안에 있는 물고기를 입질 후보로 잡는다", () => {
    const fish = [{ id: "a", x: 100 + BITE_RADIUS - 5, y: 100 }];
    expect(findBiter(fish, bobber)).toBe("a");
  });

  it("반경 경계(정확히 반경)면 입질로 인정한다 (<=)", () => {
    const fish = [{ id: "edge", x: 100 + BITE_RADIUS, y: 100 }];
    expect(findBiter(fish, bobber)).toBe("edge");
  });

  it("반경 밖 물고기는 무시한다", () => {
    const fish = [{ id: "far", x: 100 + BITE_RADIUS + 1, y: 100 }];
    expect(findBiter(fish, bobber)).toBeNull();
  });

  it("여러 마리가 반경 안이면 가장 가까운 물고기를 고른다", () => {
    const fish = [
      { id: "near", x: 110, y: 100 }, // dist 10
      { id: "mid", x: 100, y: 140 }, // dist 40
    ];
    expect(findBiter(fish, bobber)).toBe("near");
  });

  it("찌가 없으면(null) 입질 없음", () => {
    expect(findBiter([{ id: "a", x: 100, y: 100 }], null)).toBeNull();
  });

  it("커스텀 반경을 존중한다", () => {
    const fish = [{ id: "a", x: 130, y: 100 }]; // dist 30
    expect(findBiter(fish, bobber, 20)).toBeNull();
    expect(findBiter(fish, bobber, 40)).toBe("a");
  });
});

describe("distance", () => {
  it("피타고라스 거리(3-4-5)", () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });
});

describe("fishInZone (반경 내 물고기 집합 — 진입/이탈 추적)", () => {
  const bobber = { x: 100, y: 100 };

  it("반경 안 물고기만 담고 밖은 제외한다", () => {
    const positions = [
      { id: "in", x: 120, y: 100 }, // dist 20
      { id: "edge", x: 100 + BITE_RADIUS, y: 100 },
      { id: "out", x: 100 + BITE_RADIUS + 1, y: 100 },
    ];
    const zone = fishInZone(positions, bobber);
    expect(zone.has("in")).toBe(true);
    expect(zone.has("edge")).toBe(true);
    expect(zone.has("out")).toBe(false);
    expect(zone.size).toBe(2);
  });

  it("찌가 없으면 빈 집합", () => {
    expect(fishInZone([{ id: "a", x: 0, y: 0 }], null).size).toBe(0);
  });
});

describe("rollBiter (진입 시 확률 굴림 — 매 틱 재굴림 아님)", () => {
  it("굴림 성공(rng < chance)이면 그 물고기를 문다", () => {
    expect(rollBiter(["a"], 0.5, () => 0.1)).toBe("a");
  });

  it("굴림 실패(rng >= chance)면 물지 않는다(스쳐 지나감)", () => {
    expect(rollBiter(["a"], 0.5, () => 0.9)).toBeNull();
  });

  it("여러 신규 진입 중 첫 성공 물고기를 고른다", () => {
    // 첫 물고기 실패(0.9), 둘째 성공(0.1).
    const rolls = [0.9, 0.1];
    let i = 0;
    expect(rollBiter(["a", "b"], 0.5, () => rolls[i++])).toBe("b");
  });

  it("신규 진입이 없으면 null", () => {
    expect(rollBiter([], 0.5, () => 0)).toBeNull();
  });

  it("기본 확률/난수원(BITE_CHANCE, Math.random)을 쓸 수 있다", () => {
    expect(BITE_CHANCE).toBeGreaterThan(0);
    expect(BITE_CHANCE).toBeLessThanOrEqual(1);
    // rng 를 0 으로 고정하면 어떤 양수 확률에서도 문다.
    expect(rollBiter(["a"], BITE_CHANCE, () => 0)).toBe("a");
  });
});

describe("rollResidentBiter (체류 물고기 상시 재굴림 — 던져놓고 무반응 방지)", () => {
  it("재굴림 간격이 지나기 전이면 굴리지 않고 타이머를 유지한다", () => {
    const r = rollResidentBiter(["a"], 500, 100, 900, 1, () => 0);
    expect(r.biterId).toBeNull();
    expect(r.rolledAt).toBe(100); // 마지막 굴림 시각 그대로
  });

  it("재굴림 간격이 지나면 굴려서 성공하면 그 물고기를 물고 rolledAt 을 갱신한다", () => {
    const r = rollResidentBiter(["a"], 1000, 0, 900, 0.5, () => 0.1);
    expect(r.biterId).toBe("a");
    expect(r.rolledAt).toBe(1000);
  });

  it("굴림에 실패해도 rolledAt 은 now 로 갱신된다(다음 굴림은 다시 한 간격을 기다림)", () => {
    const r = rollResidentBiter(["a"], 1000, 0, 900, 0.5, () => 0.9);
    expect(r.biterId).toBeNull();
    expect(r.rolledAt).toBe(1000);
  });

  it("첫 호출(lastRollAt=null)이면 간격을 기다리지 않고 즉시 굴린다", () => {
    const r = rollResidentBiter(["a"], 1234, null, 900, 1, () => 0);
    expect(r.biterId).toBe("a");
    expect(r.rolledAt).toBe(1234);
  });

  it("여러 체류 물고기 중 첫 성공 물고기를 고른다", () => {
    const rolls = [0.9, 0.1];
    let i = 0;
    const r = rollResidentBiter(["a", "b"], 1000, 0, 900, 0.5, () => rolls[i++]);
    expect(r.biterId).toBe("b");
  });

  it("반경 안에 아무도 없으면 물지 않지만 타이머는 갱신한다", () => {
    const r = rollResidentBiter([], 1000, 0, 900, 1, () => 0);
    expect(r.biterId).toBeNull();
    expect(r.rolledAt).toBe(1000);
  });

  it("기본 상수(RESIDENT_BITE_INTERVAL_MS/CHANCE)를 쓸 수 있다", () => {
    expect(RESIDENT_BITE_INTERVAL_MS).toBeGreaterThan(0);
    expect(RESIDENT_BITE_CHANCE).toBeGreaterThan(0);
    expect(RESIDENT_BITE_CHANCE).toBeLessThanOrEqual(1);
    const r = rollResidentBiter(["a"], 5000, null, undefined, undefined, () => 0);
    expect(r.biterId).toBe("a");
  });
});

describe("lureVelocity (미끼 유인 — 찌 쪽으로 약하게 끌어당김)", () => {
  const bobber = { x: 100, y: 100 };

  it("유인 반경(LURE_RADIUS)은 입질 반경(BITE_RADIUS)보다 넓다", () => {
    expect(LURE_RADIUS).toBeGreaterThan(BITE_RADIUS);
  });

  it("반경 안 물고기는 찌 방향으로 속도가 바뀐다(오른쪽 찌면 vx 증가)", () => {
    const fish = { x: 40, y: 100, vx: 0, vy: 0 }; // 찌는 오른쪽(x=100)
    const v = lureVelocity(fish, bobber, 100);
    expect(v.vx).toBeGreaterThan(0); // 오른쪽(찌 쪽)으로 끌림
    expect(Math.abs(v.vy)).toBeLessThan(1e-6); // 수직 성분 없음(같은 y)
  });

  it("반경 밖 물고기는 속도가 그대로다", () => {
    const fish = { x: 100 - (LURE_RADIUS + 5), y: 100, vx: 3, vy: -2 };
    const v = lureVelocity(fish, bobber, 100);
    expect(v.vx).toBe(3);
    expect(v.vy).toBe(-2);
  });

  it("가까운 물고기가 먼 물고기보다 강하게 끌린다", () => {
    const near = lureVelocity({ x: 90, y: 100, vx: 0, vy: 0 }, bobber, 100);
    const far = lureVelocity(
      { x: 100 - (LURE_RADIUS - 5), y: 100, vx: 0, vy: 0 },
      bobber,
      100,
    );
    expect(near.vx).toBeGreaterThan(far.vx);
  });

  it("찌가 없으면(null) 속도를 바꾸지 않는다", () => {
    const fish = { x: 10, y: 10, vx: 5, vy: 5 };
    const v = lureVelocity(fish, null, 100);
    expect(v).toEqual({ vx: 5, vy: 5 });
  });

  it("결과 속도는 최대 속도 상한을 넘지 않는다(부자연스러운 가속 방지)", () => {
    // 이미 빠른 물고기에 유인을 더해도 상한으로 잘린다.
    const fish = { x: 40, y: 100, vx: 400, vy: 0 };
    const v = lureVelocity(fish, bobber, 100, LURE_RADIUS, 90, 150);
    expect(Math.hypot(v.vx, v.vy)).toBeLessThanOrEqual(150 + 1e-6);
  });
});

describe("applyLure (스프라이트 배열에 유인 일괄 적용)", () => {
  const bobber = { x: 100, y: 100 };

  it("반경 안 물고기만 새 속도로 바꾸고, 밖은 원본 참조를 유지한다", () => {
    const inFish = { id: "in", x: 60, y: 100, vx: 0, vy: 0 };
    const outFish = { id: "out", x: 100 - (LURE_RADIUS + 20), y: 100, vx: 1, vy: 0 };
    const out = applyLure([inFish, outFish], bobber, 100);
    expect(out[0]).not.toBe(inFish); // 유인되어 새 객체
    expect(out[0].vx).toBeGreaterThan(0);
    expect(out[1]).toBe(outFish); // 영향 없어 원본 참조 유지
  });

  it("찌가 없으면 배열을 그대로 돌려준다", () => {
    const arr = [{ id: "a", x: 0, y: 0, vx: 1, vy: 1 }];
    expect(applyLure(arr, null, 100)).toBe(arr);
  });
});

describe("gameReducer (상태 기계 전이)", () => {
  it("초기 상태는 idle, 찌 없음", () => {
    const s = initialGameState();
    expect(s.phase).toBe(IDLE);
    expect(s.bobber).toBeNull();
    expect(s.biterId).toBeNull();
  });

  it("idle 에서 CAST 하면 지정 좌표에 찌를 던진다(cast)", () => {
    const s = gameReducer(initialGameState(), { type: "CAST", x: 40, y: 60 });
    expect(s.phase).toBe(CAST);
    expect(s.bobber).toEqual({ x: 40, y: 60 });
  });

  it("찌는 한 번에 하나 — cast 중 CAST 는 무시된다", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 10, y: 10 });
    const again = gameReducer(cast, { type: "CAST", x: 99, y: 99 });
    expect(again).toBe(cast); // 상태 불변(무시)
  });

  it("idle 에서 CAST 하면 castAt(투척 시각)을 기록한다(포물선 연출 기준)", () => {
    const s = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0, now: 777 });
    expect(s.castAt).toBe(777);
  });

  it("cast 에서 BITE(biterId) 를 받으면 예신(nibble)로 전이하고 nibbleStart 를 기록한다(본신 아님)", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    const nibble = gameReducer(cast, { type: "BITE", biterId: "f1", now: 1000 });
    expect(nibble.phase).toBe(NIBBLE);
    expect(nibble.biterId).toBe("f1");
    expect(nibble.nibbleStart).toBe(1000);
    expect(nibble.biteStart).toBeNull(); // 본신(챔질 창)은 아직 열리지 않았다
  });

  it("biterId 없는 BITE 는 무시한다", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    expect(gameReducer(cast, { type: "BITE", now: 1 })).toBe(cast);
  });

  it("idle 에서 BITE 는 무시한다(투척 전에는 입질 없음)", () => {
    const s = initialGameState();
    expect(gameReducer(s, { type: "BITE", biterId: "x", now: 1 })).toBe(s);
  });

  it("예신 시간이 지나기 전 TICK 은 예신을 유지한다", () => {
    const nibble = nibbleAt(0);
    const t = gameReducer(nibble, { type: "TICK", now: NIBBLE_MS - 1 });
    expect(t).toBe(nibble);
    expect(t.phase).toBe(NIBBLE);
  });

  it("예신 시간 경과 시 TICK 하면 본신(biting/strike)으로 전이하고 biteStart 를 연다", () => {
    const nibble = nibbleAt(0);
    const t = gameReducer(nibble, { type: "TICK", now: NIBBLE_MS });
    expect(t.phase).toBe(BITING);
    expect(t.biteStart).toBe(NIBBLE_MS); // 챔질 창은 본신 시점부터 잰다
    expect(t.biterId).toBe("f1");
  });

  it("예신 중 REEL 은 헛챔질(무시) — 본신 전에는 못 챈다", () => {
    const nibble = nibbleAt(0);
    expect(gameReducer(nibble, { type: "REEL", now: 1 })).toBe(nibble);
  });

  it("본신 타이밍 창이 지나기 전 TICK 은 본신을 유지한다", () => {
    const strike = strikeAt(0);
    const t = gameReducer(strike, { type: "TICK", now: BITE_WINDOW_MS - 1 });
    expect(t).toBe(strike);
    expect(t.phase).toBe(BITING);
  });

  it("본신 타이밍 창 경과 시 TICK 하면 미끼만 먹고 도망(escaped)한다", () => {
    const strike = strikeAt(0);
    const t = gameReducer(strike, { type: "TICK", now: BITE_WINDOW_MS });
    expect(t.phase).toBe(ESCAPED);
    // 어떤 물고기가 도망쳤는지 알 수 있도록 biterId 는 유지된다(캔버스 도망 연출용).
    expect(t.biterId).toBe("f1");
  });

  it("본신 중 REEL 하면 건짐 성공(caught)이며 biterId·caughtAt 을 기록한다", () => {
    const strike = strikeAt(0);
    const c = gameReducer(strike, { type: "REEL", now: 1234 });
    expect(c.phase).toBe(CAUGHT);
    expect(c.biterId).toBe("f1"); // 이 id 로 catch API 를 호출한다
    expect(c.caughtAt).toBe(1234); // 끌어올리기 모션 진행도 기준 시각
  });

  it("cast(입질 전) 상태의 REEL 은 무시된다", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    expect(gameReducer(cast, { type: "REEL" })).toBe(cast);
  });

  it("도망 후 REEL 은 성공하지 않는다(창을 놓쳤으므로)", () => {
    const escaped = gameReducer(strikeAt(0), { type: "TICK", now: BITE_WINDOW_MS });
    expect(gameReducer(escaped, { type: "REEL" })).toBe(escaped);
  });

  it("CLEAR 는 어느 단계에서든 초기(idle)로 되돌린다 — 다시 던질 수 있다", () => {
    const caught = gameReducer(strikeAt(0), { type: "REEL" });
    const cleared = gameReducer(caught, { type: "CLEAR" });
    expect(cleared).toEqual(initialGameState());
  });

  it("커스텀 nibbleMs 를 TICK 에서 존중한다", () => {
    const nibble = nibbleAt(0);
    expect(gameReducer(nibble, { type: "TICK", now: 200, nibbleMs: 300 }).phase).toBe(
      NIBBLE,
    );
    expect(gameReducer(nibble, { type: "TICK", now: 300, nibbleMs: 300 }).phase).toBe(
      BITING,
    );
  });

  it("커스텀 window 를 TICK 에서 존중한다", () => {
    const strike = strikeAt(0);
    expect(gameReducer(strike, { type: "TICK", now: 500, window: 1000 }).phase).toBe(
      BITING,
    );
    expect(gameReducer(strike, { type: "TICK", now: 1000, window: 1000 }).phase).toBe(
      ESCAPED,
    );
  });
});

// 예신(nibble) 상태 헬퍼: nibbleStart = start.
function nibbleAt(start) {
  const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
  return gameReducer(cast, { type: "BITE", biterId: "f1", now: start });
}

// 본신(strike/biting) 상태 헬퍼: 예신을 거쳐 biteStart = start 인 본신을 만든다.
// 예신을 start-NIBBLE_MS 에 시작해 now=start 에서 본신으로 넘어가면 biteStart=start 가 된다.
function strikeAt(start) {
  const nibble = nibbleAt(start - NIBBLE_MS);
  return gameReducer(nibble, { type: "TICK", now: start });
}
