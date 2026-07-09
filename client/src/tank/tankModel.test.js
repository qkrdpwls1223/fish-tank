import { describe, it, expect } from "vitest";
import {
  spawnSprite,
  stepSprite,
  stepSprites,
  selectAnimated,
  MAX_ANIMATED,
} from "./tankModel.js";

// 어항 모션 모델(순수 함수) 단위 테스트 (REQ-DRAW-003 헤엄 애니메이션, NFR-PERF-001).
// 캔버스 draw 호출과 분리된 위치/속도 로직만 검증한다.

const BOUNDS = { width: 800, height: 600 };

function fish(id = "fish-1") {
  return {
    id,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: "구피",
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

describe("spawnSprite", () => {
  it("경계 안에 위치하고 속도(vx,vy)와 방향(facing)을 가진 스프라이트를 만든다", () => {
    const s = spawnSprite(fish(), BOUNDS);
    expect(s.id).toBe("fish-1");
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThanOrEqual(BOUNDS.width);
    expect(s.y).toBeGreaterThanOrEqual(0);
    expect(s.y).toBeLessThanOrEqual(BOUNDS.height);
    expect(Math.abs(s.vx)).toBeGreaterThan(0);
    expect([1, -1]).toContain(s.facing);
  });

  it("같은 id 는 항상 같은 초기 상태로 스폰한다(결정적, 재연결 재동기화 안정)", () => {
    const a = spawnSprite(fish("same-id"), BOUNDS);
    const b = spawnSprite(fish("same-id"), BOUNDS);
    expect(a).toEqual(b);
  });

  it("원본 물고기의 그림 데이터를 스프라이트에 보존한다(렌더링용)", () => {
    const f = fish();
    const s = spawnSprite(f, BOUNDS);
    expect(s.drawing).toEqual(f.drawing);
    expect(s.displayName).toBe("구피");
  });
});

describe("stepSprite", () => {
  it("속도에 비례해 위치를 전진시킨다", () => {
    const s = { ...spawnSprite(fish(), BOUNDS), x: 400, y: 300, vx: 10, vy: 5, facing: 1 };
    const next = stepSprite(s, 100, BOUNDS); // dt=100ms
    expect(next.x).toBeCloseTo(400 + 10 * (100 / 1000));
    expect(next.y).toBeCloseTo(300 + 5 * (100 / 1000));
  });

  it("오른쪽 벽에 닿으면 반사하고 경계 안에 머문다", () => {
    const s = { ...spawnSprite(fish(), BOUNDS), x: BOUNDS.width - 1, y: 300, vx: 100, vy: 0, facing: 1 };
    const next = stepSprite(s, 1000, BOUNDS);
    expect(next.x).toBeLessThanOrEqual(BOUNDS.width);
    expect(next.vx).toBeLessThan(0); // 속도 방향 반전
    expect(next.facing).toBe(-1); // 바라보는 방향도 반전
  });

  it("왼쪽 벽에 닿으면 반사한다", () => {
    const s = { ...spawnSprite(fish(), BOUNDS), x: 1, y: 300, vx: -100, vy: 0, facing: -1 };
    const next = stepSprite(s, 1000, BOUNDS);
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.vx).toBeGreaterThan(0);
    expect(next.facing).toBe(1);
  });

  it("위/아래 벽에 닿으면 수직 속도를 반전한다", () => {
    const top = stepSprite(
      { ...spawnSprite(fish(), BOUNDS), x: 400, y: 1, vx: 0, vy: -100, facing: 1 },
      1000,
      BOUNDS,
    );
    expect(top.y).toBeGreaterThanOrEqual(0);
    expect(top.vy).toBeGreaterThan(0);

    const bottom = stepSprite(
      { ...spawnSprite(fish(), BOUNDS), x: 400, y: BOUNDS.height - 1, vx: 0, vy: 100, facing: 1 },
      1000,
      BOUNDS,
    );
    expect(bottom.y).toBeLessThanOrEqual(BOUNDS.height);
    expect(bottom.vy).toBeLessThan(0);
  });
});

describe("stepSprites / selectAnimated", () => {
  it("stepSprites 는 모든 스프라이트를 한 프레임 전진시킨다", () => {
    const sprites = [fish("a"), fish("b"), fish("c")].map((f) => spawnSprite(f, BOUNDS));
    const next = stepSprites(sprites, 16, BOUNDS);
    expect(next).toHaveLength(3);
    expect(next[0]).not.toBe(sprites[0]); // 불변 갱신
  });

  it("selectAnimated 는 동시 애니메이션 수를 상한선으로 제한한다 (NFR-PERF-001)", () => {
    const many = Array.from({ length: MAX_ANIMATED + 50 }, (_, i) =>
      spawnSprite(fish(`f${i}`), BOUNDS),
    );
    const animated = selectAnimated(many);
    expect(animated.length).toBe(MAX_ANIMATED);
  });

  it("상한선 이하면 전부 애니메이션한다", () => {
    const few = [fish("a"), fish("b")].map((f) => spawnSprite(f, BOUNDS));
    expect(selectAnimated(few)).toHaveLength(2);
  });
});
