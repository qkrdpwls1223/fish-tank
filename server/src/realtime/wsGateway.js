// @MX:NOTE: [AUTO] WebSocket 게이트웨이. 브로드캐스터 이벤트를 접속 소켓으로 팬아웃한다.
//   `ws` 패키지에 직접 의존하지 않도록 순수 팬아웃 로직(broadcastToClients)과
//   배선(attachRealtime)을 분리해 라이브 서버 없이 단위 테스트가 가능하게 한다.
//   실제 소켓 서버 생성/연결은 server.js 에서 주입한다(REQ-RT-001, NFR-RT-001: WS push 로 저지연 전파).

/**
 * 이벤트를 열린 클라이언트에게만 직렬화해 전송한다.
 * @param {Iterable<{readyState:number, send:Function}>} clients
 * @param {object} event
 * @param {number} openState - 열린 상태 코드(ws.OPEN, 보통 1).
 */
export function broadcastToClients(clients, event, openState) {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState !== openState) continue;
    try {
      client.send(payload);
    } catch {
      // 끊긴 소켓 쓰기 실패는 나머지 전파를 막지 않는다.
    }
  }
}

/**
 * 브로드캐스터를 WebSocket 서버에 연결한다.
 * 브로드캐스터에 올라온 이벤트를 접속 중인 모든 소켓으로 전파한다.
 * @param {{wss:{clients:Iterable, on:Function}, broadcaster:{subscribe:Function}, openState?:number, OPEN?:number}} params
 * @returns {() => void} detach - 구독 해지 함수.
 */
export function attachRealtime({ wss, broadcaster, openState, OPEN = 1 }) {
  const state = openState ?? OPEN;
  return broadcaster.subscribe((event) => {
    broadcastToClients(wss.clients, event, state);
  });
}
