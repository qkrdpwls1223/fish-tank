// 먹이주기 실시간 공유 API 클라이언트 (REQ-INT-003). 검증된 토큰을 Bearer 로 전달한다(NFR-SEC-001).
// 서버는 좌표만 브로드캐스트하고 신원은 절대 노출하지 않는다(REQ-OWN-004).
// fetchImpl 을 주입 가능하게 해 테스트에서 네트워크 없이 검증한다.

/**
 * 먹이 좌표를 서버에 전송해 접속 사용자에게 실시간 공유한다.
 * @param {{token:string, x:number, y:number}} params
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 * @throws {Error & {code?:string}} 실패 시(400/401 등)
 */
export async function sendFeed({ token, x, y }, fetchImpl = fetch) {
  const res = await fetchImpl("/api/feed", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ x, y }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error("먹이주기에 실패했습니다.");
    err.code = body?.error?.code;
    throw err;
  }
}
