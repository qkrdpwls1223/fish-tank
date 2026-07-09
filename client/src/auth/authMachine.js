// 인증 상태 머신 (순수 함수). REQ-AUTH-004 의 핵심:
// 인증되지 않은 동안 쓰기 기능(추가/삭제/먹이주기)을 비활성화하고,
// 실패 시 오류 상태와 재시도 경로를 제공한다.
export const initialAuthState = {
  status: "idle", // idle | authenticating | authenticated | error
  identity: null,
  error: null,
};

export function authReducer(state, action) {
  switch (action.type) {
    case "AUTH_START":
      return { status: "authenticating", identity: null, error: null };
    case "AUTH_SUCCESS":
      return {
        status: "authenticated",
        identity: action.identity,
        error: null,
      };
    case "AUTH_FAILURE":
      return { status: "error", identity: null, error: action.error };
    case "RETRY":
      return { status: "authenticating", identity: null, error: null };
    default:
      return state;
  }
}

// 쓰기 작업 허용 여부: 인증 완료 상태에서만 true.
export function canWrite(state) {
  return state.status === "authenticated";
}
