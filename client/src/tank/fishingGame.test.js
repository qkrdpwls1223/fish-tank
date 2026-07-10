import { describe, it, expect } from "vitest";
import {
  BITE_RADIUS,
  BITE_WINDOW_MS,
  BITE_CHANCE,
  IDLE,
  CAST,
  BITING,
  CAUGHT,
  ESCAPED,
  initialGameState,
  distance,
  findBiter,
  fishInZone,
  rollBiter,
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

  it("cast 에서 BITE(biterId) 를 받으면 입질(biting)로 전이하고 시작 시각을 기록한다", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    const biting = gameReducer(cast, { type: "BITE", biterId: "f1", now: 1000 });
    expect(biting.phase).toBe(BITING);
    expect(biting.biterId).toBe("f1");
    expect(biting.biteStart).toBe(1000);
  });

  it("biterId 없는 BITE 는 무시한다", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    expect(gameReducer(cast, { type: "BITE", now: 1 })).toBe(cast);
  });

  it("idle 에서 BITE 는 무시한다(투척 전에는 입질 없음)", () => {
    const s = initialGameState();
    expect(gameReducer(s, { type: "BITE", biterId: "x", now: 1 })).toBe(s);
  });

  it("입질 중 타이밍 창이 지나기 전 TICK 은 상태를 유지한다", () => {
    const biting = biteAt(0);
    const t = gameReducer(biting, { type: "TICK", now: BITE_WINDOW_MS - 1 });
    expect(t).toBe(biting);
    expect(t.phase).toBe(BITING);
  });

  it("입질 중 타이밍 창 경과 시 TICK 하면 미끼만 먹고 도망(escaped)한다", () => {
    const biting = biteAt(0);
    const t = gameReducer(biting, { type: "TICK", now: BITE_WINDOW_MS });
    expect(t.phase).toBe(ESCAPED);
    // 어떤 물고기가 도망쳤는지 알 수 있도록 biterId 는 유지된다(캔버스 도망 연출용).
    expect(t.biterId).toBe("f1");
  });

  it("입질 중 REEL 하면 건짐 성공(caught)이며 biterId·caughtAt 을 기록한다", () => {
    const biting = biteAt(0);
    const c = gameReducer(biting, { type: "REEL", now: 1234 });
    expect(c.phase).toBe(CAUGHT);
    expect(c.biterId).toBe("f1"); // 이 id 로 catch API 를 호출한다
    expect(c.caughtAt).toBe(1234); // 끌어올리기 모션 진행도 기준 시각
  });

  it("입질이 아닐 때 REEL 은 무시된다(타이밍을 놓치면 헛챔질)", () => {
    const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
    expect(gameReducer(cast, { type: "REEL" })).toBe(cast);
  });

  it("도망 후 REEL 은 성공하지 않는다(창을 놓쳤으므로)", () => {
    const escaped = gameReducer(biteAt(0), { type: "TICK", now: BITE_WINDOW_MS });
    expect(gameReducer(escaped, { type: "REEL" })).toBe(escaped);
  });

  it("CLEAR 는 어느 단계에서든 초기(idle)로 되돌린다 — 다시 던질 수 있다", () => {
    const caught = gameReducer(biteAt(0), { type: "REEL" });
    const cleared = gameReducer(caught, { type: "CLEAR" });
    expect(cleared).toEqual(initialGameState());
  });

  it("커스텀 window 를 TICK 에서 존중한다", () => {
    const biting = biteAt(0);
    expect(gameReducer(biting, { type: "TICK", now: 500, window: 1000 }).phase).toBe(
      BITING,
    );
    expect(gameReducer(biting, { type: "TICK", now: 1000, window: 1000 }).phase).toBe(
      ESCAPED,
    );
  });
});

// 입질 시작 상태 헬퍼: biteStart = start 로 biting 상태를 만든다.
function biteAt(start) {
  const cast = gameReducer(initialGameState(), { type: "CAST", x: 0, y: 0 });
  return gameReducer(cast, { type: "BITE", biterId: "f1", now: start });
}
