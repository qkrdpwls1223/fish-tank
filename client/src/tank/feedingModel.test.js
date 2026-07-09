import { describe, it, expect } from "vitest";
import {
  dropFood,
  stepFood,
  isFoodAlive,
  stepFoods,
  reactToFood,
  reactToFoods,
  FOOD_LIFE_MS,
} from "./feedingModel.js";

// 먹이주기 모션 모델(순수 함수) 단위 테스트 (REQ-INT-001).
// 캔버스 draw 호출과 분리해 먹이 수명·물고기 반응 로직만 검증한다.

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

describe("stepFood / isFoodAlive / stepFoods", () => {
  it("stepFood 는 경과 시간만큼 수명을 감소시킨다", () => {
    const food = dropFood({ x: 0, y: 0 }, 0);
    const next = stepFood(food, 1000);
    expect(next.remainingMs).toBe(FOOD_LIFE_MS - 1000);
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

  it("먹이가 없으면 속도를 바꾸지 않는다", () => {
    const s = sprite("a");
    const next = reactToFood(s, []);
    expect(next.vx).toBe(s.vx);
    expect(next.vy).toBe(s.vy);
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
