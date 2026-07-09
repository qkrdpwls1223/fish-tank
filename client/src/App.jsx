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
  // 개발 전용 우회: Teams 밖(브라우저)에서 로컬 시험용. 개발 빌드 + 플래그일 때만.
  // 프로덕션 빌드에서는 import.meta.env.DEV 가 false 이므로 절대 활성화되지 않는다.
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS) {
    return {
      userId: "dev-user-local",
      displayName: "개발자(로컬)",
      token: "dev-bypass-token",
    };
  }

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
      // 임시 진단: 로그인 실패의 실제 원인(코드/메시지/Teams SDK cause)을 콘솔에 노출.
      // 원인 파악 후 제거 예정.
      console.error(
        "[fish-tank auth 실패]",
        "code=", error?.code,
        "message=", error?.message,
        "cause=", error?.cause,
      );
      dispatch({ type: "AUTH_FAILURE", error });
    }
  }, [authenticate]);

  useEffect(() => {
    runAuth();
  }, [runAuth]);

  const writeEnabled = canWrite(state);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* 어항: 인증 완료 시 화면 전체 배경으로 채운다 (REQ-RT-004) */}
      {state.status === "authenticated" && (
        <FishTank token={token} {...tankProps} />
      )}

      {/* 상단 좌측: 타이틀 + 인사 (플로팅) */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          zIndex: 10,
          color: "#fff",
          textShadow: "0 1px 4px rgba(0,0,0,0.55)",
          pointerEvents: "none",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>랜선어항</h1>
        {state.status === "authenticated" && state.identity && (
          <p style={{ margin: "2px 0 0", fontSize: 14 }}>
            안녕하세요, {state.identity.displayName}님
          </p>
        )}
      </div>

      {/* 인증 중 / 오류 상태: 화면 중앙 오버레이 */}
      {(state.status === "authenticating" || state.status === "error") && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#bfe6e4",
            zIndex: 20,
          }}
        >
          {state.status === "authenticating" && <p>인증 중…</p>}
          {state.status === "error" && (
            <div
              role="alert"
              style={{
                background: "#fff",
                borderRadius: 12,
                padding: "20px 24px",
                boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
                textAlign: "center",
              }}
            >
              <p>로그인에 실패했습니다. 다시 시도해 주세요.</p>
              <button type="button" onClick={runAuth}>
                다시 시도
              </button>
            </div>
          )}
        </div>
      )}

      {/* 하단 중앙: 물고기 그리기 플로팅 버튼 (항상 렌더, 미인증 시 비활성 — REQ-AUTH-004) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 20,
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <button
          type="button"
          disabled={!writeEnabled}
          onClick={() => setComposing(true)}
          style={{
            border: "none",
            borderRadius: 999,
            padding: "14px 28px",
            fontSize: 16,
            fontWeight: 600,
            cursor: writeEnabled ? "pointer" : "not-allowed",
            background: writeEnabled ? "#1d4ed8" : "#9aa3ad",
            color: "#fff",
            boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
          }}
        >
          물고기 그리기
        </button>
      </div>

      {/* 그리기 모달: 인증 완료 + 그리기 시작 시에만 노출 */}
      {composing && writeEnabled && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="물고기 그리기"
          onClick={() => setComposing(false)}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          {/* 카드 내부 클릭은 닫히지 않도록 전파 차단 */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 22,
              padding: 24,
              maxWidth: 560,
              width: "100%",
              maxHeight: "92vh",
              overflowY: "auto",
              position: "relative",
              boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
            }}
          >
            <button
              type="button"
              aria-label="닫기"
              onClick={() => setComposing(false)}
              style={{
                position: "absolute",
                top: 18,
                right: 18,
                width: 36,
                height: 36,
                border: "none",
                borderRadius: "50%",
                background: "#f1f4f6",
                color: "#5b6672",
                fontSize: 16,
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
            <FishComposer
              authState={state}
              token={token}
              onSuccess={() => setComposing(false)}
            />
          </div>
        </div>
      )}
    </main>
  );
}
