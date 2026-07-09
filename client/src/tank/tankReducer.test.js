import { describe, it, expect } from "vitest";
import { initialTankState, tankReducer } from "./tankReducer.js";

// 어항 상태 리듀서: 스냅샷 로드 + 실시간 델타 반영 (REQ-RT-001/002/003/004).
// 재연결 재동기화 안전성을 위해 추가는 멱등(중복 id 무시), 스냅샷은 전체 치환.

function fish(id, extra = {}) {
  return {
    id,
    drawing: {},
    displayMode: "named",
    displayName: "물고기",
    createdAt: "2026-07-09T00:00:00.000Z",
    ...extra,
  };
}

describe("tankReducer", () => {
  it("초기 상태는 빈 물고기 목록이다", () => {
    expect(initialTankState).toEqual({ fish: [] });
  });

  it("SNAPSHOT 은 전체 물고기 목록을 치환한다 (REQ-RT-004)", () => {
    const next = tankReducer(initialTankState, {
      type: "SNAPSHOT",
      fish: [fish("a"), fish("b")],
    });
    expect(next.fish.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("FISH_ADDED 는 새 물고기를 추가한다 (REQ-RT-001)", () => {
    const start = { fish: [fish("a")] };
    const next = tankReducer(start, { type: "FISH_ADDED", fish: fish("b") });
    expect(next.fish.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("FISH_ADDED 는 이미 존재하는 id 를 중복 추가하지 않는다(멱등, 재연결 안전)", () => {
    const start = { fish: [fish("a")] };
    const next = tankReducer(start, { type: "FISH_ADDED", fish: fish("a") });
    expect(next.fish).toHaveLength(1);
  });

  it("FISH_DELETED 는 해당 id 물고기를 제거한다 (REQ-RT-002)", () => {
    const start = { fish: [fish("a"), fish("b")] };
    const next = tankReducer(start, { type: "FISH_DELETED", id: "a" });
    expect(next.fish.map((f) => f.id)).toEqual(["b"]);
  });

  it("FISH_DELETED 로 없는 id 를 지워도 상태가 안전하게 유지된다", () => {
    const start = { fish: [fish("a")] };
    const next = tankReducer(start, { type: "FISH_DELETED", id: "zzz" });
    expect(next.fish.map((f) => f.id)).toEqual(["a"]);
  });

  it("재연결 시 SNAPSHOT 은 누락/삭제분을 포함해 현재 상태와 재동기화한다 (REQ-RT-003)", () => {
    // 연결 끊긴 동안 b 추가, a 삭제가 일어난 서버 상태로 스냅샷 치환.
    const stale = { fish: [fish("a"), fish("old")] };
    const resynced = tankReducer(stale, {
      type: "SNAPSHOT",
      fish: [fish("b"), fish("c")],
    });
    expect(resynced.fish.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("알 수 없는 액션은 동일 상태 참조를 반환한다", () => {
    const start = { fish: [fish("a")] };
    expect(tankReducer(start, { type: "NOPE" })).toBe(start);
  });
});
