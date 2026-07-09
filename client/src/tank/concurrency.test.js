import { describe, it, expect } from "vitest";
import { spawnSprite, selectAnimated, MAX_ANIMATED } from "./tankModel.js";
import { initialTankState, tankReducer } from "./tankReducer.js";

// M6 동시성/규모 로직 검증 (NFR-CONC-001, NFR-PERF-001).
// 실제 부하 인프라 없이, 다수 물고기/버스트 델타 상황을 순수 로직 수준에서 검증한다.

const BOUNDS = { width: 800, height: 600 };

function fish(id, extra = {}) {
  return {
    id,
    drawing: { version: 1, width: 100, height: 60, strokes: [] },
    displayMode: "named",
    displayName: `물고기-${id}`,
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

describe("다수 물고기 렌더링 상한 (NFR-CONC-001 / NFR-PERF-001)", () => {
  it("수백 마리 스냅샷도 애니메이션 대상은 상한(MAX_ANIMATED)으로 제한된다", () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      spawnSprite(fish(`f${i}`), BOUNDS),
    );
    const animated = selectAnimated(many);
    expect(animated.length).toBe(MAX_ANIMATED);
    // 상한 대상은 모두 경계 안의 유효 스프라이트여야 한다(손상 없음).
    for (const s of animated) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(BOUNDS.width);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(BOUNDS.height);
    }
  });

  it("상한 이하의 대규모(정확히 MAX_ANIMATED)는 전부 애니메이션한다", () => {
    const exact = Array.from({ length: MAX_ANIMATED }, (_, i) =>
      spawnSprite(fish(`f${i}`), BOUNDS),
    );
    expect(selectAnimated(exact)).toHaveLength(MAX_ANIMATED);
  });
});

describe("버스트 델타 처리 무결성 (NFR-CONC-001)", () => {
  it("대량 추가/삭제가 교차로 들어와도 상태가 손상되지 않는다", () => {
    let state = initialTankState;

    // 300마리 연속 추가.
    for (let i = 0; i < 300; i += 1) {
      state = tankReducer(state, { type: "FISH_ADDED", fish: fish(`b${i}`) });
    }
    expect(state.fish).toHaveLength(300);

    // 짝수 인덱스 삭제와 신규 추가를 교차로 적용(버스트).
    for (let i = 0; i < 300; i += 2) {
      state = tankReducer(state, { type: "FISH_DELETED", id: `b${i}` });
      state = tankReducer(state, { type: "FISH_ADDED", fish: fish(`c${i}`) });
    }

    // 홀수 b(150) + 신규 c(150) = 300. 중복 id 없음.
    const ids = state.fish.map((f) => f.id);
    expect(ids).toHaveLength(300);
    expect(new Set(ids).size).toBe(300); // 중복 없음
    expect(ids).not.toContain("b0"); // 삭제된 짝수 b 는 없어야 함
    expect(ids).toContain("b1"); // 홀수 b 는 유지
    expect(ids).toContain("c0"); // 신규 c 는 추가
  });

  it("동일 물고기 중복 추가(경합)에도 멱등하게 한 마리만 유지된다", () => {
    let state = initialTankState;
    for (let i = 0; i < 50; i += 1) {
      state = tankReducer(state, { type: "FISH_ADDED", fish: fish("dup") });
    }
    expect(state.fish).toHaveLength(1);
  });

  it("스냅샷 재동기화는 누적 델타와 무관하게 서버 상태로 전체 치환한다", () => {
    let state = initialTankState;
    for (let i = 0; i < 100; i += 1) {
      state = tankReducer(state, { type: "FISH_ADDED", fish: fish(`x${i}`) });
    }
    const server = [fish("s1"), fish("s2")];
    state = tankReducer(state, { type: "SNAPSHOT", fish: server });
    expect(state.fish.map((f) => f.id)).toEqual(["s1", "s2"]);
  });
});
