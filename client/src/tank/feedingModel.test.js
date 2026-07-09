import { describe, it, expect } from "vitest";
import {
  dropFood,
  scatterFood,
  stepFood,
  isFoodAlive,
  stepFoods,
  reactToFood,
  reactToFoods,
  consumeFoods,
  FOOD_LIFE_MS,
  FOOD_COUNT,
  CHASE_SPEED,
  EAT_RADIUS,
} from "./feedingModel.js";

// 먹이주기 모션 모델(순수 함수) 단위 테스트 (REQ-INT-001).
// 캔버스 draw 호출과 분리해 먹이 살포·침강·수명, 물고기 추적·섭취 로직만 검증한다.

function sprite(id, extra = {}) {
  return {
    id,
    x: 100,
    y: 100,
    vx: -50,
    vy: 0,
    facing: -1,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: `물고기-${id}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

describe("dropFood", () => {
  it("좌표와 수명을 가진 먹이 아이템을 만든다", () => {
    const food = dropFood({ x: 300, y: 200 }, 0);
    expect(food.x).toBe(300);
    expect(food.y).toBe(200);
    expect(food.remainingMs).toBe(FOOD_LIFE_MS);
    expect(typeof food.id).toBe("string");
  });

  it("연속 생성한 먹이는 서로 다른 id 를 가진다", () => {
    const a = dropFood({ x: 1, y: 2 }, 0);
    const b = dropFood({ x: 1, y: 2 }, 0);
    expect(a.id).not.toBe(b.id);
  });
});

describe("scatterFood (REQ-INT-001 살포)", () => {
  it("살포 중심점 주변에 FOOD_COUNT(10)개의 알갱이를 만든다", () => {
    const foods = scatterFood({ x: 400, y: 30 }, 0);
    expect(foods).toHaveLength(FOOD_COUNT);
    expect(FOOD_COUNT).toBe(10);
    const ids = new Set(foods.map((f) => f.id));
    expect(ids.size).toBe(FOOD_COUNT);
  });

  it("알갱이는 중심점 주변에 흩어지고 아래로 가라앉는 속도를 가진다", () => {
    // 결정적 난수원으로 흩어짐을 검증한다.
    let n = 0;
    const rand = () => {
      n = (n + 0.37) % 1;
      return n;
    };
    const foods = scatterFood({ x: 400, y: 30 }, 0, rand);
    const xs = new Set(foods.map((f) => Math.round(f.x)));
    expect(xs.size).toBeGreaterThan(1); // 같은 자리에 뭉치지 않는다
    for (const f of foods) {
      expect(f.vy).toBeGreaterThan(0); // 전부 침강
      expect(Math.abs(f.x - 400)).toBeLessThanOrEqual(120);
    }
  });
});

describe("stepFood / isFoodAlive / stepFoods", () => {
  it("stepFood 는 경과 시간만큼 수명을 감소시킨다", () => {
    const food = dropFood({ x: 0, y: 0 }, 0);
    const next = stepFood(food, 1000);
    expect(next.remainingMs).toBe(FOOD_LIFE_MS - 1000);
  });

  it("stepFood 는 침강 속도만큼 가라앉는다", () => {
    const food = dropFood({ x: 100, y: 50 }, 0);
    const next = stepFood(food, 1000);
    expect(next.y).toBeGreaterThan(food.y);
  });

  it("bounds 가 주어지면 바닥 아래로 내려가지 않는다(바닥에 얹힘)", () => {
    const food = { ...dropFood({ x: 100, y: 440 }, 0), vy: 100 };
    const next = stepFood(food, 1000, { width: 800, height: 450 });
    expect(next.y).toBeLessThanOrEqual(450);
  });

  it("isFoodAlive 는 수명이 남았는지 판정한다", () => {
    expect(isFoodAlive({ remainingMs: 1 })).toBe(true);
    expect(isFoodAlive({ remainingMs: 0 })).toBe(false);
    expect(isFoodAlive({ remainingMs: -100 })).toBe(false);
  });

  it("stepFoods 는 전진시키고 수명이 다한 먹이를 제거한다", () => {
    const foods = [
      dropFood({ x: 0, y: 0 }, 0),
      { ...dropFood({ x: 1, y: 1 }, 0), remainingMs: 500 },
    ];
    const next = stepFoods(foods, 1000);
    // 첫 먹이는 살아남고(수명 충분), 두 번째는 제거된다(500 - 1000 <= 0).
    expect(next).toHaveLength(1);
    expect(next[0].remainingMs).toBe(FOOD_LIFE_MS - 1000);
  });
});

describe("reactToFood", () => {
  it("가장 가까운 먹이 쪽으로 속도를 당겨 반응한다 (REQ-INT-001)", () => {
    const s = sprite("a", { x: 100, y: 100, vx: -50, vy: 0 });
    const food = dropFood({ x: 300, y: 100 }, 0); // 오른쪽에 먹이
    const next = reactToFood(s, [food]);
    // 왼쪽으로 가던 물고기가 오른쪽(먹이) 성분을 얻어 vx 가 커진다.
    expect(next.vx).toBeGreaterThan(s.vx);
    expect(next.facing).toBe(1); // 먹이 쪽을 바라본다
  });

  it("아래쪽 먹이에는 수직 속도로 반응한다", () => {
    const s = sprite("a", { x: 100, y: 100, vx: 0, vy: -10 });
    const food = dropFood({ x: 100, y: 400 }, 0); // 아래쪽 먹이
    const next = reactToFood(s, [food]);
    expect(next.vy).toBeGreaterThan(s.vy);
  });

  it("아무리 오래 반응해도 속도가 추적 목표 속도를 넘지 않는다(폭주 방지)", () => {
    let s = sprite("a", { x: 100, y: 100, vx: 0, vy: 0 });
    const food = dropFood({ x: 900, y: 100 }, 0); // 멀리 오른쪽
    for (let i = 0; i < 600; i += 1) {
      s = reactToFood(s, [food], 16); // 약 10초 연속 반응
    }
    expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(CHASE_SPEED + 1);
  });

  it("먹이가 없으면 속도를 바꾸지 않는다", () => {
    const s = sprite("a");
    const next = reactToFood(s, []);
    expect(next.vx).toBe(s.vx);
    expect(next.vy).toBe(s.vy);
  });

  it("같은 먹이를 노려도 물고기마다 다른 자리를 노린다(겹침 분산)", () => {
    const food = dropFood({ x: 500, y: 300 }, 0);
    // 같은 위치·속도의 두 물고기가 같은 먹이에 반응해도 목표 방향이 달라야 한다.
    const a = reactToFood(sprite("fish-aaa", { x: 100, y: 300, vx: 0, vy: 0 }), [food]);
    const b = reactToFood(sprite("fish-zzz", { x: 100, y: 300, vx: 0, vy: 0 }), [food]);
    const angleA = Math.atan2(a.vy, a.vx);
    const angleB = Math.atan2(b.vy, b.vx);
    expect(angleA).not.toBeCloseTo(angleB, 5);
  });

  it("여러 먹이 중 더 가까운 먹이에 반응한다", () => {
    const s = sprite("a", { x: 100, y: 100, vx: 0, vy: 0 });
    const near = dropFood({ x: 120, y: 100 }, 0); // 오른쪽 가까이
    const far = dropFood({ x: 100, y: 900 }, 0); // 아래 멀리
    const next = reactToFood(s, [near, far]);
    // 가까운(오른쪽) 먹이 쪽으로 수평 성분이 우세해야 한다.
    expect(next.vx).toBeGreaterThan(0);
  });
});

describe("reactToFoods", () => {
  it("모든 스프라이트에 반응을 적용한다(불변 갱신)", () => {
    const sprites = [sprite("a"), sprite("b")];
    const food = dropFood({ x: 500, y: 100 }, 0);
    const next = reactToFoods(sprites, [food]);
    expect(next).toHaveLength(2);
    expect(next[0]).not.toBe(sprites[0]);
    expect(next[0].vx).toBeGreaterThan(sprites[0].vx);
  });
});

describe("consumeFoods (REQ-INT-001 섭취)", () => {
  it("물고기가 닿은(EAT_RADIUS 이내) 먹이는 사라진다", () => {
    const s = sprite("a", { x: 100, y: 100 });
    const nearFood = dropFood({ x: 100 + EAT_RADIUS - 1, y: 100 }, 0); // 입 앞
    const farFood = dropFood({ x: 400, y: 400 }, 0); // 멀리
    const left = consumeFoods([s], [nearFood, farFood]);
    expect(left).toHaveLength(1);
    expect(left[0].id).toBe(farFood.id);
  });

  it("닿은 물고기가 없으면 먹이는 그대로 남는다", () => {
    const s = sprite("a", { x: 0, y: 0 });
    const foods = [dropFood({ x: 500, y: 500 }, 0)];
    expect(consumeFoods([s], foods)).toHaveLength(1);
  });

  it("물고기나 먹이가 없으면 입력 배열을 그대로 반환한다", () => {
    const foods = [dropFood({ x: 1, y: 1 }, 0)];
    expect(consumeFoods([], foods)).toBe(foods);
    expect(consumeFoods([sprite("a")], [])).toEqual([]);
  });
});
