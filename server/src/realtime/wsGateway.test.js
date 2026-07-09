import { describe, it, expect, vi } from "vitest";
import { broadcastToClients, attachRealtime } from "./wsGateway.js";
import { InMemoryBroadcaster, fishAddedEvent } from "./broadcaster.js";

// WebSocket 게이트웨이의 팬아웃 로직 단위 테스트.
// 라이브 소켓 서버 없이 가짜 클라이언트로 검증한다(REQ-RT-001, NFR-RT-001).

const OPEN = 1;
const CLOSED = 3;

function fakeClient(readyState = OPEN) {
  return { readyState, send: vi.fn() };
}

describe("broadcastToClients", () => {
  it("열린 클라이언트에게만 직렬화된 이벤트를 전송한다", () => {
    const open1 = fakeClient(OPEN);
    const open2 = fakeClient(OPEN);
    const closed = fakeClient(CLOSED);
    const event = { type: "fish_deleted", id: "z9" };

    broadcastToClients([open1, open2, closed], event, OPEN);

    expect(open1.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(open2.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(closed.send).not.toHaveBeenCalled();
  });

  it("한 클라이언트 전송이 실패해도 나머지에 계속 전송한다", () => {
    const boom = fakeClient(OPEN);
    boom.send = vi.fn(() => {
      throw new Error("socket write failed");
    });
    const ok = fakeClient(OPEN);

    expect(() =>
      broadcastToClients([boom, ok], { type: "fish_added", fish: {} }, OPEN),
    ).not.toThrow();
    expect(ok.send).toHaveBeenCalled();
  });
});

describe("attachRealtime", () => {
  it("브로드캐스터에 올라온 이벤트를 현재 접속 클라이언트 전체에 전파한다", () => {
    const broadcaster = new InMemoryBroadcaster();
    const clients = new Set([fakeClient(OPEN), fakeClient(OPEN)]);
    const wss = { clients, on: vi.fn() };

    attachRealtime({ wss, broadcaster, OPEN });

    const event = fishAddedEvent({ id: "new-fish", displayMode: "anonymous" });
    broadcaster.broadcast(event);

    for (const c of clients) {
      expect(c.send).toHaveBeenCalledWith(JSON.stringify(event));
    }
  });

  it("연결 해지(반환된 detach) 후에는 더 이상 전파하지 않는다", () => {
    const broadcaster = new InMemoryBroadcaster();
    const client = fakeClient(OPEN);
    const wss = { clients: new Set([client]), on: vi.fn() };

    const detach = attachRealtime({ wss, broadcaster, OPEN });
    detach();
    broadcaster.broadcast(fishAddedEvent({ id: "x" }));

    expect(client.send).not.toHaveBeenCalled();
  });
});
