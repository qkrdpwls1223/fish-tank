import { describe, it, expect, vi } from "vitest";
import { connectRealtime } from "./realtimeClient.js";

// 실시간 클라이언트: 소켓을 추상화해 주입 가능한 가짜 소켓으로 검증한다.
// (REQ-RT-001/002 델타 수신, REQ-RT-003 재연결/재동기화)

function makeFakeSocket() {
  const listeners = {};
  return {
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    close: vi.fn(),
    emit(type, evt) {
      (listeners[type] || []).forEach((fn) => fn(evt));
    },
  };
}

describe("connectRealtime", () => {
  it("주어진 url 로 소켓을 생성하고 핸들러를 연결한다", () => {
    const socket = makeFakeSocket();
    const socketFactory = vi.fn(() => socket);

    connectRealtime({ url: "ws://x/realtime", socketFactory, onEvent: vi.fn() });

    expect(socketFactory).toHaveBeenCalledWith("ws://x/realtime");
  });

  it("수신 메시지를 파싱해 onEvent 로 전달한다 (REQ-RT-001/002)", () => {
    const socket = makeFakeSocket();
    const onEvent = vi.fn();
    connectRealtime({ url: "u", socketFactory: () => socket, onEvent });

    const event = { type: "fish_added", fish: { id: "f1" } };
    socket.emit("message", { data: JSON.stringify(event) });

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it("깨진 메시지는 예외 없이 무시한다", () => {
    const socket = makeFakeSocket();
    const onEvent = vi.fn();
    connectRealtime({ url: "u", socketFactory: () => socket, onEvent });

    expect(() => socket.emit("message", { data: "{not json" })).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("open 시 onOpen 을 호출한다(재동기화 트리거 지점, REQ-RT-003/004)", () => {
    const socket = makeFakeSocket();
    const onOpen = vi.fn();
    connectRealtime({
      url: "u",
      socketFactory: () => socket,
      onEvent: vi.fn(),
      onOpen,
    });

    socket.emit("open", {});
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("연결이 끊기면 재연결을 예약하고 새 소켓을 생성한다 (REQ-RT-003)", () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const socketFactory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    let scheduled = null;
    const scheduleReconnect = vi.fn((fn) => {
      scheduled = fn;
    });

    connectRealtime({
      url: "u",
      socketFactory,
      onEvent: vi.fn(),
      scheduleReconnect,
    });

    first.emit("close", {});
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);

    scheduled(); // 예약된 재연결 실행
    expect(socketFactory).toHaveBeenCalledTimes(2);
  });

  it("close() 로 수동 종료하면 이후 재연결을 예약하지 않는다", () => {
    const socket = makeFakeSocket();
    const scheduleReconnect = vi.fn();
    const conn = connectRealtime({
      url: "u",
      socketFactory: () => socket,
      onEvent: vi.fn(),
      scheduleReconnect,
    });

    conn.close();
    expect(socket.close).toHaveBeenCalled();

    socket.emit("close", {}); // 서버/소켓발 close 이벤트가 뒤따라 와도
    expect(scheduleReconnect).not.toHaveBeenCalled();
  });
});
