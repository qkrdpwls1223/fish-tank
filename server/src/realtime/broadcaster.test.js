import { describe, it, expect, vi } from "vitest";
import {
  InMemoryBroadcaster,
  fishAddedEvent,
  fishDeletedEvent,
  foodDroppedEvent,
} from "./broadcaster.js";

// 실시간 브로드캐스터 계약 단위 테스트 (REQ-RT-001, REQ-RT-002).
// 라이브 WebSocket 서버 없이 pub/sub 로직과 이벤트 메시지 형태를 검증한다.

describe("InMemoryBroadcaster", () => {
  it("broadcast 는 구독한 모든 리스너에게 이벤트를 전달한다", () => {
    const bus = new InMemoryBroadcaster();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    const event = { type: "fish_added", fish: { id: "x1" } };
    bus.broadcast(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it("subscribe 는 구독 해지 함수를 반환하고, 해지 후에는 전달하지 않는다", () => {
    const bus = new InMemoryBroadcaster();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe(listener);

    unsubscribe();
    bus.broadcast({ type: "fish_deleted", id: "gone" });

    expect(listener).not.toHaveBeenCalled();
  });

  it("한 리스너가 던져도 다른 리스너 전달은 계속된다", () => {
    const bus = new InMemoryBroadcaster();
    const bad = vi.fn(() => {
      throw new Error("listener boom");
    });
    const good = vi.fn();
    bus.subscribe(bad);
    bus.subscribe(good);

    expect(() => bus.broadcast({ type: "fish_added", fish: {} })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});

describe("이벤트 메시지 형태", () => {
  it("fishAddedEvent 는 fish_added 타입에 공개 물고기만 담는다 (REQ-RT-001)", () => {
    const publicFish = {
      id: "f1",
      drawing: { version: 1 },
      displayMode: "anonymous",
      displayName: null,
      createdAt: "2026-07-09T00:00:00.000Z",
    };
    const event = fishAddedEvent(publicFish);

    expect(event).toEqual({ type: "fish_added", fish: publicFish });
  });

  it("fishAddedEvent 는 ownerId 를 절대 포함하지 않는다 (REQ-OWN-004)", () => {
    const publicFish = {
      id: "f2",
      drawing: {},
      displayMode: "named",
      displayName: "홍길동",
      createdAt: "2026-07-09T00:00:00.000Z",
    };
    const event = fishAddedEvent(publicFish);

    expect("ownerId" in event.fish).toBe(false);
    expect(JSON.stringify(event)).not.toContain("ownerId");
  });

  it("fishDeletedEvent 는 fish_deleted 타입에 id 만 담는다 (REQ-RT-002)", () => {
    const event = fishDeletedEvent("dead-fish-id");
    expect(event).toEqual({ type: "fish_deleted", id: "dead-fish-id" });
  });

  it("foodDroppedEvent 는 food_dropped 타입에 좌표만 담는다 (REQ-INT-003)", () => {
    const event = foodDroppedEvent({ x: 320, y: 240 });
    expect(event).toEqual({ type: "food_dropped", food: { x: 320, y: 240 } });
  });

  it("foodDroppedEvent 는 소유자 신원을 절대 포함하지 않는다 (REQ-OWN-004, REQ-INT-003)", () => {
    // 상위에서 실수로 신원 필드를 섞어도 이벤트에는 좌표만 남아야 한다.
    const event = foodDroppedEvent({
      x: 10,
      y: 20,
      ownerId: "user-secret",
      displayName: "홍길동",
    });
    expect(event.food).toEqual({ x: 10, y: 20 });
    expect("ownerId" in event.food).toBe(false);
    expect(JSON.stringify(event)).not.toContain("user-secret");
    expect(JSON.stringify(event)).not.toContain("홍길동");
  });
});
