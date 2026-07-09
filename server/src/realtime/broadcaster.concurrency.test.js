import { describe, it, expect, vi } from "vitest";
import {
  InMemoryBroadcaster,
  fishAddedEvent,
  fishDeletedEvent,
} from "./broadcaster.js";

// M6 동시성/규모 검증 (NFR-CONC-001): 수십~수백 명 동시 접속 팬아웃을
// 실제 WebSocket 없이 브로드캐스터 pub/sub 수준에서 검증한다.

describe("브로드캐스터 대규모 팬아웃 (NFR-CONC-001)", () => {
  it("수백 구독자에게 이벤트를 한 번씩 정확히 전달한다", () => {
    const bus = new InMemoryBroadcaster();
    const listeners = Array.from({ length: 300 }, () => vi.fn());
    listeners.forEach((l) => bus.subscribe(l));

    const event = fishAddedEvent({
      id: "f1",
      drawing: {},
      displayMode: "anonymous",
      displayName: null,
      createdAt: "2026-07-09T00:00:00.000Z",
    });
    bus.broadcast(event);

    for (const l of listeners) {
      expect(l).toHaveBeenCalledTimes(1);
      expect(l).toHaveBeenCalledWith(event);
    }
  });

  it("일부 구독 해지 후에도 남은 구독자에게만 정확히 전달한다", () => {
    const bus = new InMemoryBroadcaster();
    const listeners = [];
    const unsubs = [];
    for (let i = 0; i < 200; i += 1) {
      const l = vi.fn();
      listeners.push(l);
      unsubs.push(bus.subscribe(l));
    }

    // 짝수 인덱스 구독 해지.
    for (let i = 0; i < 200; i += 2) unsubs[i]();

    bus.broadcast(fishDeletedEvent("gone"));

    for (let i = 0; i < 200; i += 1) {
      if (i % 2 === 0) expect(listeners[i]).not.toHaveBeenCalled();
      else expect(listeners[i]).toHaveBeenCalledTimes(1);
    }
  });

  it("연속 이벤트 버스트를 모든 구독자에게 순서대로 전달한다", () => {
    const bus = new InMemoryBroadcaster();
    const received = Array.from({ length: 100 }, () => []);
    received.forEach((buf) => bus.subscribe((e) => buf.push(e.id ?? e.fish.id)));

    for (let i = 0; i < 50; i += 1) {
      bus.broadcast(
        fishAddedEvent({
          id: `f${i}`,
          drawing: {},
          displayMode: "named",
          displayName: "n",
          createdAt: "2026-07-09T00:00:00.000Z",
        }),
      );
    }

    for (const buf of received) {
      expect(buf).toHaveLength(50);
      expect(buf[0]).toBe("f0");
      expect(buf[49]).toBe("f49");
    }
  });

  it("한 구독자(끊긴 소켓)가 던져도 나머지 수백 구독자 전달은 계속된다 (NFR-CONC-001)", () => {
    const bus = new InMemoryBroadcaster();
    const good = Array.from({ length: 150 }, () => vi.fn());
    // 중간에 예외를 던지는 구독자 삽입.
    good.slice(0, 75).forEach((l) => bus.subscribe(l));
    bus.subscribe(() => {
      throw new Error("dead socket");
    });
    good.slice(75).forEach((l) => bus.subscribe(l));

    expect(() =>
      bus.broadcast(fishDeletedEvent("x")),
    ).not.toThrow();
    for (const l of good) expect(l).toHaveBeenCalledTimes(1);
  });
});
