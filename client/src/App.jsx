import { useReducer, useEffect, useCallback, useState } from "react";
import {
  initialAuthState,
  authReducer,
  canWrite,
} from "./auth/authMachine.js";
import { acquireMsalToken } from "./auth/msalAuth.js";
import FishComposer from "./fish/FishComposer.jsx";
import FishTank from "./tank/FishTank.jsx";
import MyCollection from "./catch/MyCollection.jsx";
import MyTank from "./mytank/MyTank.jsx";
import { createMyTankFish as createMyTankFishApi } from "./mytank/myTankApi.js";

// 내 어항에 물고기를 그려 넣을 때의 기본 배치 위치(px). 넣은 뒤 드래그/방향키로 옮길 수 있다.
const DEFAULT_FISH_POS = { x: 300, y: 180 };

// 기본 인증 함수: Microsoft SSO(MSAL) 토큰을 획득하고 백엔드에서 신원을 검증받는다.
// 테스트에서는 authenticate prop 을 주입해 이 경로를 대체한다. (REQ-AUTH-001/002)
// 토큰은 쓰기 작업(물고기 생성) 제출에 사용하므로 신원과 함께 반환한다.
async function defaultAuthenticate() {
  // 개발 전용 우회: 로컬에서 실제 로그인 없이 시험용. 개발 빌드 + 플래그일 때만.
  // 프로덕션 빌드에서는 import.meta.env.DEV 가 false 이므로 절대 활성화되지 않는다.
  if (import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS) {
    return {
      userId: "dev-user-local",
      displayName: "개발자(로컬)",
      token: "dev-bypass-token",
    };
  }

  const token = await acquireMsalToken();
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
 *   collectionProps 는 수집함(MyCollection)에 주입할 조회 의존성(테스트용).
 */
export default function App({
  authenticate = defaultAuthenticate,
  tankProps = {},
  collectionProps = {},
  myTankProps = {},
  // 공유 어항 그리기 제출(미지정 시 FishComposer 기본=공유 /api/fish). 테스트 주입용.
  submitFish,
  // 내 어항 그리기 제출용 API(테스트 주입). 기본은 POST /api/my-tank/fish.
  createMyTankFish = createMyTankFishApi,
}) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  // 쓰기 제출용 토큰(신원과 별도로 보관, 인증 머신은 변경하지 않음).
  const [token, setToken] = useState(null);
  const [composing, setComposing] = useState(false);
  // 상위 뷰 전환(3탭): 공유 어항(tank, 기본) / 내 수집함(collection) / 내 어항(mytank).
  const [view, setView] = useState("tank");
  // 내 어항 뷰가 마운트된 채 물고기를 새로 넣으면 재로드해야 하므로, 이 카운터를 key 로 써서 재마운트한다.
  const [myTankRefresh, setMyTankRefresh] = useState(0);

  // 인증 시도(최초 마운트 + 재시도 공용). REQ-AUTH-001.
  const runAuth = useCallback(async () => {
    dispatch({ type: "AUTH_START" });
    try {
      const identity = await authenticate();
      setToken(identity?.token ?? null);
      dispatch({ type: "AUTH_SUCCESS", identity });
    } catch (error) {
      // 임시 진단: 로그인 실패의 실제 원인(코드/메시지/MSAL cause)을 콘솔에 노출.
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

  // 내 어항용 제출 래퍼: FishComposer 는 { token, drawing, displayMode } 만 넘기므로 기본 위치를 더해
  // POST /api/my-tank/fish 로 보낸다. [PRIVACY] 내 어항에서 그린 물고기는 오직 이 경로로만 저장되어
  // 공유 어항(POST /api/fish)에는 절대 나타나지 않는다.
  const submitToMyTank = useCallback(
    ({ token: t, drawing, displayMode }) =>
      createMyTankFish({
        token: t,
        drawing,
        displayMode,
        x: DEFAULT_FISH_POS.x,
        y: DEFAULT_FISH_POS.y,
      }),
    [createMyTankFish],
  );

  // 현재 뷰에 맞는 그리기 제출 함수. 내 어항이면 my-tank 경로, 그 외(공유 어항)는 기본/주입값.
  const composerSubmit = view === "mytank" ? submitToMyTank : submitFish;

  // 그리기 성공 시 모달을 닫고, 내 어항 뷰였다면 재마운트해 방금 넣은 물고기를 다시 로드한다.
  const handleComposerSuccess = useCallback(() => {
    setComposing(false);
    if (view === "mytank") setMyTankRefresh((n) => n + 1);
  }, [view]);

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* 공유 어항(감상 전용): 인증 완료 + 어항 뷰일 때 화면 전체 배경으로 채운다 (REQ-RT-004).
          낚시 UI/게임 루프는 fishing prop 미지정이라 동작하지 않는다. */}
      {state.status === "authenticated" && view === "tank" && (
        <FishTank token={token} {...tankProps} />
      )}

      {/* 낚시 모드: 공유 어항과 동일한 물고기 시뮬레이션 위에서 낚시 미니게임을 켜고
          배경 상단에 하늘+수면 레이어를 덧입힌다(FishTank fishing). */}
      {state.status === "authenticated" && view === "fishing" && (
        <FishTank token={token} fishing {...tankProps} />
      )}

      {/* 내 수집함: 공유 어항과 분리된 별도 화면 (REQ-COLL-002) */}
      {state.status === "authenticated" && view === "collection" && (
        <MyCollection token={token} {...collectionProps} />
      )}

      {/* 내 어항: 본인만 보는 개인 어항. 방금 넣은 물고기 반영을 위해 refresh 카운터를 key 로 재마운트한다. */}
      {state.status === "authenticated" && view === "mytank" && (
        <MyTank key={`mytank-${myTankRefresh}`} token={token} {...myTankProps} />
      )}

      {/* 상단 우측: 뷰 전환(공유 어항 ↔ 내 수집함). 실제 버튼이라 키보드 조작 가능(NFR-A11Y-001). */}
      {state.status === "authenticated" && (
        <div
          role="group"
          aria-label="화면 전환"
          style={{
            position: "absolute",
            top: 14,
            right: 16,
            zIndex: 10,
            display: "flex",
            gap: 8,
          }}
        >
          {[
            { key: "tank", label: "공유 어항" },
            { key: "fishing", label: "낚시" },
            { key: "collection", label: "내 수집함" },
            { key: "mytank", label: "내 어항" },
          ].map((v) => {
            const active = view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                aria-pressed={active}
                onClick={() => setView(v.key)}
                style={{
                  border: "none",
                  borderRadius: 999,
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  background: active ? "#1d4ed8" : "rgba(255,255,255,0.92)",
                  color: active ? "#fff" : "#1f2933",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
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

      {/* 하단 좌측: 물고기 그리기 플로팅 버튼 (공유 어항·내 어항 뷰에서 노출, 미인증 시 비활성 — REQ-AUTH-004).
          공유 어항에서는 공유 물고기로, 내 어항에서는 내 어항 전용으로 저장된다(수집함 뷰에서는 숨김). */}
      {(view === "tank" || view === "mytank") && (
      <div
        style={{
          position: "absolute",
          left: 16,
          bottom: 20,
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
      )}

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
              submitFish={composerSubmit}
              onSuccess={handleComposerSuccess}
            />
          </div>
        </div>
      )}
    </main>
  );
}
