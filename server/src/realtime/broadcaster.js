// @MX:ANCHOR: [AUTO] 실시간 이벤트 브로드캐스터 계약 — 쓰기 경로와 WS 게이트웨이가 만나는 지점
// @MX:REASON: REQ-RT-001/002. 물고기 추가/삭제 이벤트가 모두 이 pub/sub 를 통과해
//   접속 클라이언트로 전파된다. WS 게이트웨이(wsGateway)와 라우트(fish)가 함께 의존한다(fan_in >= 3 예상).

/**
 * 인메모리 pub/sub 브로드캐스터. 라이브 WebSocket 없이도 이벤트 전파를 테스트할 수 있게 한다.
 * 실제 배포에서는 WS 게이트웨이가 이 브로드캐스터를 구독해 소켓으로 전달한다.
 */
export class InMemoryBroadcaster {
  constructor() {
    this._listeners = new Set();
  }

  /**
   * 이벤트 리스너를 등록하고 구독 해지 함수를 반환한다.
   * @param {(event:object)=>void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * 등록된 모든 리스너에게 이벤트를 전달한다.
   * 한 리스너의 예외가 다른 리스너 전달을 막지 않도록 격리한다.
   * @param {object} event
   */
  broadcast(event) {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // 개별 리스너(끊긴 소켓 등) 오류는 전체 전파를 중단시키지 않는다.
      }
    }
  }
}

// 물고기 추가 이벤트. 반드시 공개 물고기(toPublicFish 결과)만 담는다(REQ-OWN-004).
export function fishAddedEvent(publicFish) {
  return { type: "fish_added", fish: publicFish };
}

// 물고기 삭제 이벤트. 삭제된 물고기 id 만 전파한다(M4 삭제 엔드포인트가 재사용).
export function fishDeletedEvent(id) {
  return { type: "fish_deleted", id };
}

// @MX:NOTE: [AUTO] 먹이주기 실시간 공유 이벤트. 오직 좌표(x,y)만 전파하고 소유자 신원은
//   절대 담지 않는다(REQ-INT-003, REQ-OWN-004). 먹이는 저장되지 않는 임시 효과다.
export function foodDroppedEvent({ x, y }) {
  return { type: "food_dropped", food: { x, y } };
}
