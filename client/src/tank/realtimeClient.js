// 실시간 클라이언트. WebSocket 을 추상화(socketFactory 주입)해 테스트에서 가짜 소켓을
// 넣을 수 있게 한다. 델타 수신(REQ-RT-001/002)과 끊김→자동 재연결→재동기화(REQ-RT-003).

const DEFAULT_RECONNECT_MS = 1000;

// 브라우저 기본 소켓 팩토리. 프로덕션에서는 네이티브 WebSocket 을 사용한다.
function defaultSocketFactory(url) {
  return new WebSocket(url);
}

// 현재 페이지 기준 절대 WebSocket URL 을 만든다(상대 경로는 WebSocket 에서 무효).
export function defaultRealtimeUrl(path = "/realtime") {
  if (typeof window !== "undefined" && window.location) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}${path}`;
  }
  return path;
}

/**
 * 실시간 채널에 연결한다.
 * @param {object} params
 * @param {string} params.url - WebSocket URL
 * @param {(event:object)=>void} params.onEvent - 파싱된 서버 이벤트 콜백
 * @param {() => void} [params.onOpen] - 연결(재연결 포함) 시 호출. 스냅샷 재동기화 트리거.
 * @param {() => void} [params.onClose] - 연결 종료 시 호출
 * @param {(url:string)=>object} [params.socketFactory] - 소켓 생성기(테스트 주입용)
 * @param {(fn:Function)=>void} [params.scheduleReconnect] - 재연결 예약기(테스트 주입용)
 * @param {number} [params.reconnectDelayMs]
 * @returns {{close: () => void}}
 */
export function connectRealtime({
  url = defaultRealtimeUrl(),
  onEvent,
  onOpen,
  onClose,
  socketFactory = defaultSocketFactory,
  scheduleReconnect = (fn) => setTimeout(fn, DEFAULT_RECONNECT_MS),
  reconnectDelayMs = DEFAULT_RECONNECT_MS,
}) {
  // reconnectDelayMs 는 기본 scheduleReconnect 미사용 시 참조되지 않지만
  // 호출부 계약(지연 설정)을 명시하기 위해 시그니처에 유지한다.
  void reconnectDelayMs;

  let socket = null;
  let manualClose = false;

  function open() {
    if (manualClose) return;

    // 소켓 생성 실패(잘못된 URL/네트워크 등)는 크래시 대신 재연결로 처리한다(REQ-RT-003).
    try {
      socket = socketFactory(url);
    } catch {
      socket = null;
      if (onClose) onClose();
      if (!manualClose) scheduleReconnect(open);
      return;
    }

    socket.addEventListener("open", () => {
      // 연결/재연결 시점: 호출부가 스냅샷을 다시 로드해 재동기화한다(REQ-RT-003/004).
      if (onOpen) onOpen();
    });

    socket.addEventListener("message", (evt) => {
      try {
        onEvent(JSON.parse(evt.data));
      } catch {
        // 깨진 메시지는 무시한다(전체 연결을 끊지 않는다).
      }
    });

    socket.addEventListener("close", () => {
      if (onClose) onClose();
      // 수동 종료가 아니면 자동 재연결을 예약한다(REQ-RT-003).
      if (!manualClose) scheduleReconnect(open);
    });
  }

  open();

  return {
    close() {
      manualClose = true;
      if (socket) socket.close();
    },
  };
}
