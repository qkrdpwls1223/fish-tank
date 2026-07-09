import { describe, it, expect } from "vitest";
import {
  spawnSprite,
  stepSprite,
  stepSprites,
  applySeparation,
  applySchooling,
  traitsFor,
  selectAnimated,
  MAX_ANIMATED,
  SEPARATION_RADIUS,
  SCHOOL_RADIUS,
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

  it("수직 속도는 시간이 지나며 감쇠해 수평 자세로 복원된다", () => {
    let s = { ...spawnSprite(fish(), BOUNDS), x: 400, y: 300, vx: 40, vy: 80, facing: 1 };
    const initialVy = Math.abs(s.vy);
    for (let i = 0; i < 120; i += 1) {
      s = stepSprite(s, 16, BOUNDS); // 약 2초
    }
    expect(Math.abs(s.vy)).toBeLessThan(initialVy * 0.6); // 수직 성분이 크게 줄어든다
    expect(Math.abs(s.vx)).toBeGreaterThan(0); // 수평 성분은 유지
  });

  it("수평 속도가 너무 작으면 최소치로 끌어올린다(세로만 오가는 제자리걸음 방지)", () => {
    const s = { ...spawnSprite(fish(), BOUNDS), x: 400, y: 300, vx: 0, vy: 60, facing: 1 };
    const next = stepSprite(s, 16, BOUNDS);
    expect(Math.abs(next.vx)).toBeGreaterThan(0);
  });

  it("가장자리 구간에서는 벽에 닿기 전에 안쪽으로 밀린다(구석 회피)", () => {
    // 왼쪽 벽 바로 앞에서 벽 쪽으로 가던 물고기: 안쪽(+x) 가속을 받는다.
    const left = { ...spawnSprite(fish(), BOUNDS), x: 10, y: 300, vx: -60, vy: 0, facing: -1 };
    const next = stepSprite(left, 16, BOUNDS);
    expect(next.vx).toBeGreaterThan(left.vx);

    // 화면 중앙에서는 가장자리 힘이 없다(수평 속도 유지 — 최소치 이상일 때).
    const center = { ...spawnSprite(fish(), BOUNDS), x: 400, y: 300, vx: 200, vy: 0, facing: 1 };
    expect(stepSprite(center, 16, BOUNDS).vx).toBe(200);
  });

  it("구석에서 시작해도 곧 구석을 벗어난다", () => {
    let s = { ...spawnSprite(fish(), BOUNDS), x: 2, y: 2, vx: -100, vy: -40, facing: -1 };
    for (let i = 0; i < 180; i += 1) {
      s = stepSprite(s, 16, BOUNDS); // 약 3초
    }
    expect(s.x).toBeGreaterThan(30);
    expect(s.y).toBeGreaterThan(30);
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

describe("applySeparation — 물고기 겹침 방지", () => {
  function spriteAt(id, x, y, vx = 0, vy = 0) {
    return { ...spawnSprite(fish(id), BOUNDS), x, y, vx, vy };
  }

  it("가까운 두 물고기는 서로 반대 방향으로 밀려난다", () => {
    const a = spriteAt("a", 100, 100);
    const b = spriteAt("b", 120, 100); // 반경(SEPARATION_RADIUS) 안, a 의 오른쪽
    const [na, nb] = applySeparation([a, b], 16);
    expect(na.vx).toBeLessThan(a.vx); // a 는 왼쪽으로
    expect(nb.vx).toBeGreaterThan(b.vx); // b 는 오른쪽으로
  });

  it("분리 반경 밖의 물고기는 영향을 받지 않는다", () => {
    const a = spriteAt("a", 100, 100);
    const b = spriteAt("b", 100 + SEPARATION_RADIUS + 10, 100);
    const [na, nb] = applySeparation([a, b], 16);
    expect(na.vx).toBe(a.vx);
    expect(nb.vx).toBe(b.vx);
  });

  it("완전히 같은 위치라도 결정적으로 갈라놓는다", () => {
    const a = spriteAt("a", 100, 100);
    const b = spriteAt("b", 100, 100);
    const [na, nb] = applySeparation([a, b], 16);
    expect(na.vx).not.toBe(nb.vx); // 좌/우로 나뉜다
  });

  it("오래 밀려도 속도가 폭주하지 않는다(물고기별 상한 유지)", () => {
    let pair = [spriteAt("a", 100, 100), spriteAt("b", 105, 100)];
    for (let i = 0; i < 600; i += 1) {
      pair = applySeparation(pair, 16);
    }
    for (const s of pair) {
      expect(Math.hypot(s.vx, s.vy)).toBeLessThanOrEqual(130 * s.pace + 1);
    }
  });

  it("혼자면 그대로 반환한다", () => {
    const solo = [spriteAt("a", 100, 100, 30, 10)];
    expect(applySeparation(solo, 16)).toBe(solo);
  });
});

describe("traitsFor — 물고기별 유영 특성", () => {
  // 지정 크기의 사각형 그림을 만든다(바운딩 박스 제어용).
  function drawingOfSize(size) {
    return {
      version: 1,
      width: 300,
      height: 200,
      strokes: [
        { color: "#000000", width: 3, points: [{ x: 0, y: 0 }, { x: size, y: size * 0.6 }] },
      ],
    };
  }

  it("같은 물고기는 항상 같은 특성을 가진다(결정적)", () => {
    const f = fish("f-1");
    expect(traitsFor(f)).toEqual(traitsFor(f));
  });

  it("물고기마다 배속(pace)이 다양하다", () => {
    const paces = new Set(
      Array.from({ length: 30 }, (_, i) =>
        traitsFor(fish(`f-${i}`)).pace.toFixed(3),
      ),
    );
    expect(paces.size).toBeGreaterThan(10); // 사실상 전부 다름
  });

  it("크게 그린 물고기는 같은 id 의 작게 그린 물고기보다 느리다", () => {
    const small = traitsFor({ id: "same", drawing: drawingOfSize(20) });
    const big = traitsFor({ id: "same", drawing: drawingOfSize(280) });
    expect(big.pace).toBeLessThan(small.pace);
  });

  it("배속은 0.5~1.8 범위를 벗어나지 않는다", () => {
    for (let i = 0; i < 50; i += 1) {
      const { pace } = traitsFor(fish(`f-${i}`));
      expect(pace).toBeGreaterThanOrEqual(0.5);
      expect(pace).toBeLessThanOrEqual(1.8);
    }
  });

  it("일부 물고기만 무리 성향을 가진다", () => {
    const flags = Array.from({ length: 60 }, (_, i) =>
      traitsFor(fish(`f-${i}`)).schooling,
    );
    expect(flags.some(Boolean)).toBe(true);
    expect(flags.every(Boolean)).toBe(false);
  });
});

describe("applySchooling — 무리 유영", () => {
  function schoolingAt(id, x, y, vx = 0, vy = 0) {
    return { ...spawnSprite(fish(id), BOUNDS), x, y, vx, vy, schooling: true };
  }

  it("무리 물고기는 근처 무리의 중심 쪽으로 끌린다(응집)", () => {
    const a = schoolingAt("a", 100, 100);
    const b = schoolingAt("b", 200, 100); // a 의 오른쪽(SCHOOL_RADIUS 안)
    const [na] = applySchooling([a, b], 16);
    expect(na.vx).toBeGreaterThan(a.vx); // 오른쪽 무리 쪽으로
  });

  it("헤엄 방향을 이웃 평균 속도에 맞춘다(정렬)", () => {
    const a = schoolingAt("a", 100, 100, 0, 60); // 아래로 가던 물고기
    const b = schoolingAt("b", 150, 100, 80, 0); // 오른쪽으로 가는 이웃
    const [na] = applySchooling([a, b], 16);
    expect(na.vx).toBeGreaterThan(a.vx); // 이웃 방향 성분이 섞인다
    expect(na.vy).toBeLessThan(a.vy);
  });

  it("무리 성향이 없는 물고기는 영향을 받지 않는다", () => {
    const loner = { ...schoolingAt("a", 100, 100, 10, 0), schooling: false };
    const b = schoolingAt("b", 150, 100, 80, 0);
    const [nl] = applySchooling([loner, b], 16);
    expect(nl.vx).toBe(loner.vx);
    expect(nl.vy).toBe(loner.vy);
  });

  it("무리 반경 밖의 물고기에는 반응하지 않는다", () => {
    const a = schoolingAt("a", 100, 100, 10, 0);
    const b = schoolingAt("b", 100 + SCHOOL_RADIUS + 50, 100, 80, 0);
    const [na] = applySchooling([a, b], 16);
    expect(na.vx).toBe(a.vx);
  });
});
