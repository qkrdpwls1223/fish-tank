import { useReducer, useEffect, useCallback, useState } from "react";
import {
  initialAuthState,
  authReducer,
  canWrite,
} from "./auth/authMachine.js";
import { acquireTeamsSsoToken } from "./auth/teamsAuth.js";
import FishComposer from "./fish/FishComposer.jsx";
import FishTank from "./tank/FishTank.jsx";

// 기본 인증 함수: Teams SSO 토큰을 획득하고 백엔드에서 신원을 검증받는다.
// 테스트에서는 authenticate prop 을 주입해 이 경로를 대체한다. (REQ-AUTH-001/002)
// 토큰은 쓰기 작업(물고기 생성) 제출에 사용하므로 신원과 함께 반환한다.
async function defaultAuthenticate() {
  const token = await acquireTeamsSsoToken();
  const res = await fetch("/api/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error("백엔드 인증에 실패했습니다.");
  }
  const identity = await res.json(); // { userId, displayName }
  return { ...identity, token };
}

/**
 * 앱 셸. 인증 상태에 따라 UI 를 전환한다. (REQ-AUTH-001/002/004)
 * @param {{authenticate?: () => Promise<{userId:string, displayName:string}>,
 *          tankProps?: object}} props
 *   tankProps 는 어항(FishTank)에 주입할 스냅샷/실시간 의존성(테스트용).
 */
export default function App({ authenticate = defaultAuthenticate, tankProps = {} }) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  // 쓰기 제출용 토큰(신원과 별도로 보관, 인증 머신은 변경하지 않음).
  const [token, setToken] = useState(null);
  const [composing, setComposing] = useState(false);

  // 인증 시도(최초 마운트 + 재시도 공용). REQ-AUTH-001.
  const runAuth = useCallback(async () => {
    dispatch({ type: "AUTH_START" });
    try {
      const identity = await authenticate();
      setToken(identity?.token ?? null);
      dispatch({ type: "AUTH_SUCCESS", identity });
    } catch (error) {
      dispatch({ type: "AUTH_FAILURE", error });
    }
  }, [authenticate]);

  useEffect(() => {
    runAuth();
  }, [runAuth]);

  const writeEnabled = canWrite(state);

  return (
    <main>
      <h1>공유 어항</h1>

      {/* 인증 상태별 안내 */}
      {state.status === "authenticating" && <p>인증 중…</p>}

      {state.status === "authenticated" && state.identity && (
        <p>안녕하세요, {state.identity.displayName}님</p>
      )}

      {state.status === "error" && (
        <div role="alert">
          <p>로그인에 실패했습니다. 다시 시도해 주세요.</p>
          <button type="button" onClick={runAuth}>
            다시 시도
          </button>
        </div>
      )}

      {/* 쓰기 액션: 인증 완료 상태에서만 활성화 (REQ-AUTH-004) */}
      <button
        type="button"
        disabled={!writeEnabled}
        onClick={() => setComposing(true)}
      >
        물고기 그리기
      </button>

      {/* 등록 UI: 인증 완료 + 사용자가 그리기 시작을 누른 경우에만 노출 */}
      {composing && writeEnabled && (
        <FishComposer authState={state} token={token} />
      )}

      {/* 어항: 인증 완료 시 진입 스냅샷 로드 + 실시간 반영 (REQ-RT-004) */}
      {state.status === "authenticated" && (
        <FishTank token={token} {...tankProps} />
      )}
    </main>
  );
}
