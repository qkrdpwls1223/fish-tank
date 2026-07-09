// Vitest + Testing Library 공통 셋업: jest-dom 매처 등록
import "@testing-library/jest-dom/vitest";

// jsdom 은 canvas 2D 컨텍스트를 구현하지 않는다. 렌더링 경로가 조용히 무시되도록
// getContext 를 null 반환 스텁으로 대체한다(경고 소음 방지). 그리기 로직은
// drawingModel 순수 함수로 별도 검증한다.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}

// jsdom 은 Pointer Events API 를 구현하지 않아 clientX/clientY 가 유실된다.
// MouseEvent 를 상속한 최소 PointerEvent 폴리필로 좌표 전달을 가능하게 한다.
// (프로덕션은 브라우저 네이티브 PointerEvent 를 사용한다)
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends window.MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
    }
  }
  window.PointerEvent = PointerEventPolyfill;
  globalThis.PointerEvent = PointerEventPolyfill;
}

// jsdom 은 WebSocket 을 구현하지 않는다. 실시간 클라이언트가 기본 소켓을 생성해도
// 크래시하지 않도록 무해한 스텁을 제공한다(실제 실시간 검증은 fake 소켓 주입 테스트로 수행).
if (typeof globalThis.WebSocket === "undefined") {
  class WebSocketStub {
    constructor() {
      this.readyState = 0;
    }
    addEventListener() {}
    removeEventListener() {}
    send() {}
    close() {}
  }
  globalThis.WebSocket = WebSocketStub;
}
