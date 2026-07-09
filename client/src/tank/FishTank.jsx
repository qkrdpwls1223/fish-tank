import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import { initialTankState, tankReducer } from "./tankReducer.js";
import {
  spawnSprite,
  stepSprites,
  applySeparation,
  applySchooling,
  selectAnimated,
} from "./tankModel.js";
import { scatterFood, stepFoods, reactToFoods, consumeFoods } from "./feedingModel.js";
import { fishInfo } from "./fishInfo.js";
import { fetchFishSnapshot, deleteFish as deleteFishApi } from "../fish/fishApi.js";
import { sendFeed as sendFeedApi } from "./feedApi.js";
import { connectRealtime, defaultRealtimeUrl } from "./realtimeClient.js";
import { colors } from "../theme/colors.js";
import { TAIL_FOLD_FRACTION, MOUTH_FRACTION } from "../drawing/drawingModel.js";

// 물고기 렌더 크기(원본 그림 대비 축소). 어항에서 아담하게 보이도록.
const SPRITE_SCALE = 0.4;
// 꼬리 파닥임 최대 각도(라디안)와 속도(라디안/초).
const TAIL_MAX_ANGLE = 0.5;
const TAIL_SPEED = 7;

// 입(머리) 꿀렁임: 그림 오른쪽(머리) 영역만 먹이 반응 시 벌렁거린다. 경계선 위치는
// 물고기별 mouthFraction(사용자 지정) 또는 기본 MOUTH_FRACTION 을 쓰며, 스낫 끝에서 가장 크게 벌어진다.
// 입이 최대로 벌어질 때의 상하 벌림 폭(그림 높이 대비 비율).
const MOUTH_MAX_OPEN = 0.16;
// 입을 여닫는 속도(라디안/초). 꼬리보다 빠르게 오물거린다.
const CHOMP_SPEED = 14;

// 창 크기 측정 전 초기 기본값(가변 어항). jsdom 등 ResizeObserver 미지원 시에도 유지된다.
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;

// 떠오르는 물방울 장식(배경 SVG는 이미지라 내부 애니메이션이 없어 별도 레이어로 움직인다).
const BUBBLES = [
  { left: 14, size: 10, dur: 7, delay: 0 },
  { left: 30, size: 6, dur: 9, delay: 2.2 },
  { left: 47, size: 8, dur: 6, delay: 1 },
  { left: 62, size: 5, dur: 10, delay: 3.4 },
  { left: 78, size: 12, dur: 8, delay: 0.6 },
  { left: 90, size: 7, dur: 11, delay: 4.1 },
];

// 스크린리더 전용(시각적으로 숨김) 스타일.
const srOnly = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// 물고기 표시 라벨: 이름 물고기는 표시 이름, 익명은 "익명"만 노출한다(REQ-OWN-004).
function labelFor(f) {
  return f.displayMode === "named" && f.displayName ? f.displayName : "익명";
}

/**
 * 어항 렌더링 + 실시간 반영 컴포넌트. 화면 전체를 채우고, 컨트롤은 플로팅으로 얹는다.
 * @param {object} props
 * @param {string} props.token - 인증 토큰(스냅샷/실시간 접속용)
 * @param {(token:string)=>Promise<object[]>} [props.loadSnapshot] - 스냅샷 로더(테스트 주입)
 * @param {typeof connectRealtime} [props.connect] - 실시간 연결기(테스트 주입)
 * @param {string} [props.realtimeUrl]
 * @param {(params:{token:string,id:string})=>Promise<void>} [props.deleteFish] - 삭제 API(테스트 주입)
 * @param {(params:{token:string,x:number,y:number})=>Promise<void>} [props.onFeed] - 먹이주기 공유 API(테스트 주입, REQ-INT-003)
 */
export default function FishTank({
  token,
  loadSnapshot = (t) => fetchFishSnapshot({ token: t }),
  connect = connectRealtime,
  realtimeUrl = defaultRealtimeUrl(),
  deleteFish = deleteFishApi,
  onFeed = sendFeedApi,
}) {
  const [state, dispatch] = useReducer(tankReducer, initialTankState);
  const [selectedId, setSelectedId] = useState(null); // 정보 조회 대상(REQ-INT-002)
  const [feedMessage, setFeedMessage] = useState(""); // 먹이주기 접근성 안내(aria-live)
  // @MX:NOTE: [AUTO] 먹이 안내 재낭독 카운터. 동일 문구를 반복해도 라이브 영역 콘텐츠가
  //   바뀌도록(key 재마운트) 하여 스크린리더가 매번 재낭독하게 한다(NFR-A11Y-001).
  const [feedAnnounceCount, setFeedAnnounceCount] = useState(0);
  const [listOpen, setListOpen] = useState(false); // 물고기 목록 패널 토글(기본 닫힘)
  const [dark, setDark] = useState(false); // 어항 배경 라이트/다크 선택
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const spritesRef = useRef(new Map()); // id → sprite(위치/속도), 프레임 간 유지
  const foodsRef = useRef([]); // 임시 먹이 아이템(REQ-INT-001), 프레임 간 유지
  const boundsRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }); // 애니메이션 루프가 읽는 현재 헤엄 범위

  // OS 다크 모드에 따라 어항 배경 이미지를 전환한다. jsdom 등 matchMedia 미지원 시 라이트 유지.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const onChange = (e) => setDark(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  // public/ 에서 서빙되는 배경 SVG(디자이너 제작). 캔버스는 투명이라 위에 물고기가 얹힌다.
  const bgUrl = dark ? "/tank-bg-dark.svg" : "/tank-bg-light.svg";

  // 컨테이너(창) 크기에 맞춰 캔버스/헤엄 범위를 가변으로 조정한다. ResizeObserver 미지원 환경은 기본값 유지.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const next = {
        width: Math.max(1, Math.round(r.width)),
        height: Math.max(1, Math.round(r.height)),
      };
      boundsRef.current = next;
      setSize(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 진입/재연결 공용 스냅샷 로드 → 전체 치환 (REQ-RT-004, REQ-RT-003).
  const resync = useCallback(async () => {
    const fish = await loadSnapshot(token);
    dispatch({ type: "SNAPSHOT", fish });
  }, [loadSnapshot, token]);

  // 어항에 임시 먹이를 살포한다(REQ-INT-001). 좌표 1개를 살포 중심점으로 삼아
  // 알갱이 여러 개를 흩뿌린다(실시간 공유도 중심 좌표만 전파, 서버 계약 불변).
  const addFoodLocal = useCallback((x, y) => {
    foodsRef.current = [...foodsRef.current, ...scatterFood({ x, y }, Date.now())];
    setFeedMessage("먹이를 뿌렸어요. 물고기들이 먹으러 모여들어요!");
    // 동일 문구여도 카운터를 올려 라이브 영역이 재낭독되게 한다(NFR-A11Y-001).
    setFeedAnnounceCount((n) => n + 1);
  }, []);

  // 최초 진입 시 스냅샷 로드 + 실시간 채널 연결 (REQ-RT-001/002/003/004).
  useEffect(() => {
    let active = true;
    resync().catch(() => {
      /* 로드 실패는 재연결/재시도 경로에서 복구한다 */
    });

    const conn = connect({
      url: realtimeUrl,
      onOpen: () => {
        // 재연결 시점에 현재 어항 상태로 재동기화한다(REQ-RT-003).
        if (active) resync().catch(() => {});
      },
      onEvent: (event) => {
        if (!active) return;
        if (event.type === "fish_added") {
          dispatch({ type: "FISH_ADDED", fish: event.fish });
        } else if (event.type === "fish_deleted") {
          dispatch({ type: "FISH_DELETED", id: event.id });
        } else if (event.type === "food_dropped") {
          // 다른 사용자의 먹이주기를 내 어항에도 반영한다(REQ-INT-003). 좌표만 사용.
          addFoodLocal(event.food.x, event.food.y);
        }
      },
    });

    return () => {
      active = false;
      conn.close();
    };
  }, [connect, realtimeUrl, resync, addFoodLocal]);

  // 본인 물고기 삭제 요청 (REQ-OWN-002). 소유권은 서버가 토큰 신원으로 검증한다(NFR-SEC-002).
  // 실제 어항 제거는 서버가 보내는 실시간 fish_deleted 이벤트가 담당한다(REQ-RT-002).
  const handleDelete = useCallback(
    (id) => {
      deleteFish({ token, id }).catch(() => {
        /* 거부/실패는 어항 상태를 바꾸지 않는다(서버가 권위) */
      });
    },
    [deleteFish, token],
  );

  // 먹이 주기 (REQ-INT-001). 로컬에 즉시 반영하고, 실시간 공유(REQ-INT-003)로도 전파한다.
  // 좌표만 서버로 보내며 신원은 서버가 토큰으로만 판별한다(NFR-SEC-001, REQ-OWN-004).
  const handleFeed = useCallback(() => {
    const { width } = boundsRef.current;
    // 수면 근처의 무작위 지점에서 살포한다(매번 같은 자리가 아니게).
    const x = width * (0.2 + Math.random() * 0.6);
    const y = 30;
    addFoodLocal(x, y);
    onFeed({ token, x, y }).catch(() => {
      /* 공유 실패해도 로컬 먹이 효과는 유지한다(어항 상태 불변) */
    });
  }, [addFoodLocal, onFeed, token]);

  // 선택된 물고기 정보(REQ-INT-002). 삭제 등으로 사라지면 패널도 자동으로 닫힌다.
  const selectedFish = state.fish.find((f) => f.id === selectedId) ?? null;
  const selectedInfo = selectedFish ? fishInfo(selectedFish) : null;

  // 물고기 목록이 바뀌면 스프라이트 맵을 조정한다(추가 스폰/삭제 정리).
  useEffect(() => {
    const map = spritesRef.current;
    const ids = new Set(state.fish.map((f) => f.id));
    for (const f of state.fish) {
      if (!map.has(f.id)) map.set(f.id, spawnSprite(f, boundsRef.current));
    }
    for (const id of map.keys()) {
      if (!ids.has(id)) map.delete(id);
    }
  }, [state.fish]);

  // 애니메이션 루프. jsdom 등 rAF 미지원 환경에서는 조용히 건너뛴다(로직은 tankModel 로 검증).
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return undefined;
    let raf = null;
    let last = null;

    const frame = (now) => {
      const dt = last == null ? 16 : now - last;
      last = now;
      const bounds = boundsRef.current; // 창 크기 변화에 맞춰 매 프레임 현재 범위를 읽는다.
      const map = spritesRef.current;
      // 먹이는 가라앉고, 물고기는 먹이 쪽으로 헤엄쳐 가서 닿으면 먹는다(REQ-INT-001).
      // 무리 성향 물고기는 떼 지어 다니고, 분리 조향으로 서로 겹치지 않는다.
      foodsRef.current = stepFoods(foodsRef.current, dt, bounds);
      const reacting = reactToFoods([...map.values()], foodsRef.current, dt);
      const flocked = applySeparation(applySchooling(reacting, dt), dt);
      const stepped = stepSprites(flocked, dt, bounds);
      foodsRef.current = consumeFoods(stepped, foodsRef.current);
      for (const s of stepped) map.set(s.id, s);
      drawTank(canvasRef.current, selectAnimated(stepped), bounds, now, foodsRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={containerRef}
      aria-label="어항 화면"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <h2 style={srOnly}>어항</h2>

      {/* 떠오르는 물방울 애니메이션(장식). 스크린리더에는 노출하지 않는다. */}
      <style>{`
        @keyframes tankBubbleRise {
          0% { transform: translateY(0); opacity: 0; }
          12% { opacity: 0.75; }
          85% { opacity: 0.5; }
          100% { transform: translateY(-100vh); opacity: 0; }
        }
        .tank-bubbles span {
          position: absolute;
          bottom: -16px;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), rgba(255,255,255,0.2));
          animation-name: tankBubbleRise;
          animation-iteration-count: infinite;
          animation-timing-function: linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .tank-bubbles span { animation: none; opacity: 0; }
        }
      `}</style>
      <div
        className="tank-bubbles"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
      >
        {BUBBLES.map((b, i) => (
          <span
            key={i}
            style={{
              left: `${b.left}%`,
              width: b.size,
              height: b.size,
              animationDuration: `${b.dur}s`,
              animationDelay: `${b.delay}s`,
            }}
          />
        ))}
      </div>

      {/* 물고기가 헤엄치는 투명 캔버스(배경/물방울 위). 창 크기에 맞춰 가변. */}
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        aria-label="어항"
        role="img"
        aria-describedby="tank-canvas-desc"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {/* 캔버스는 키보드로 조작할 수 없으므로, 아래 목록/버튼이 접근성 대체 수단이다(NFR-A11Y-001). */}
      <p id="tank-canvas-desc" style={srOnly}>
        헤엄치는 물고기 그림입니다. 목록에서 각 물고기를 선택해 정보를 보거나,
        본인 물고기를 삭제하고, 먹이 주기 버튼으로 먹이를 줄 수 있어요.
      </p>

      {/* 하단 우측 플로팅 컨트롤: 목록 패널(토글) + 목록/먹이 버튼 + 먹이 안내. */}
      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 20,
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 8,
          maxWidth: "min(320px, 80vw)",
        }}
      >
        {/* 물고기 목록/정보 패널 (기본 열림, 접근성 대체 수단). */}
        {listOpen && (
          <div
            style={{
              background: "rgba(255,255,255,0.97)",
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
              maxHeight: "50vh",
              overflowY: "auto",
              width: "100%",
              fontSize: 14,
            }}
          >
            <p
              role="status"
              aria-live="polite"
              style={{ margin: "0 0 10px", fontWeight: 600, color: colors.text }}
            >
              현재 {state.fish.length}마리가 헤엄치고 있어요.
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {state.fish.map((f) => (
                <li
                  key={f.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 0",
                    borderTop: `1px solid ${colors.border}`,
                  }}
                >
                  {/* 라벨 버튼: 클릭 시 정보 조회(REQ-INT-002). 선택 시 강조. 키보드 접근 가능. */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background:
                        selectedId === f.id ? "rgba(29,78,216,0.10)" : "transparent",
                      color: colors.text,
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 8px",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    {labelFor(f)}
                  </button>
                  {/* 삭제 버튼은 서버가 계산한 deletable(본인 소유)에만 노출(REQ-OWN-002/004). */}
                  {f.deletable && (
                    <button
                      type="button"
                      aria-label="물고기 삭제"
                      onClick={() => handleDelete(f.id)}
                      style={{
                        background: "rgba(185,28,28,0.10)",
                        color: colors.danger,
                        border: `1px solid ${colors.danger}`,
                        borderRadius: 8,
                        padding: "4px 10px",
                        fontSize: 13,
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      삭제
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {/* 물고기 정보 패널 (REQ-INT-002). 익명은 "익명"으로만, 소유자 신원은 절대 미노출. */}
            {selectedFish && (
              <div
                role="status"
                aria-label="물고기 정보"
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px solid ${colors.border}`,
                  color: colors.text,
                }}
              >
                <p style={{ margin: 0, fontWeight: 600 }}>{selectedInfo.label}</p>
                <p style={{ margin: "2px 0 0", color: colors.muted, fontSize: 13 }}>
                  등록 시각: {selectedInfo.createdAt}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 컨트롤 버튼들 */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            aria-expanded={listOpen}
            onClick={() => setListOpen((o) => !o)}
            style={{
              background: "rgba(255,255,255,0.92)",
              color: colors.text,
              border: "none",
              borderRadius: 999,
              padding: "10px 16px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              cursor: "pointer",
            }}
          >
            목록 {listOpen ? "닫기" : "열기"}
          </button>
          {/* 먹이 주기 (REQ-INT-001). 누르면 물고기가 먹이 쪽으로 반응한다. */}
          <button
            type="button"
            onClick={handleFeed}
            style={{
              background: colors.primary,
              color: colors.onPrimary,
              border: "none",
              borderRadius: 999,
              padding: "10px 16px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              cursor: "pointer",
            }}
          >
            먹이 주기
          </button>
        </div>

        {/* 먹이 안내 라이브 영역. key 로 재마운트해 동일 문구도 재낭독한다(NFR-A11Y-001). */}
        <p
          key={feedAnnounceCount}
          role="status"
          aria-label="먹이 주기 안내"
          aria-live="assertive"
          data-announce-count={feedAnnounceCount}
          style={{
            margin: 0,
            fontSize: 13,
            color: "#fff",
            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            minHeight: 18,
          }}
        >
          {feedMessage}
        </p>
      </div>
    </section>
  );
}

// 캔버스에 먹이와 스프라이트를 그린다. 2D 컨텍스트 미지원(jsdom) 환경에서는 무시한다.
function drawTank(canvas, sprites, bounds, now, foods = []) {
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return;

  ctx.clearRect(0, 0, bounds.width, bounds.height);
  for (const food of foods) {
    drawFoodPellet(ctx, food);
  }
  for (const sprite of sprites) {
    drawFishSprite(ctx, sprite, now);
  }
}

// 먹이 알갱이를 그린다(물고기 뒤 레이어). 작은 단색 점 하나로 단순하게.
function drawFoodPellet(ctx, food) {
  ctx.beginPath();
  ctx.arc(food.x, food.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#c98a3b";
  ctx.fill();
}

// 물고기마다 다른 파닥임 위상을 id 에서 결정적으로 뽑는다(서로 엇박자로 흔들리게).
function phaseFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000) * Math.PI * 2;
}

// 접힘선(foldX) 왼쪽 점을 피벗 기준으로 각도만큼 회전시킨다. 선에서 멀수록 크게 휜다.
function bendPoint(p, foldX, pivotY, wave) {
  if (p.x >= foldX) return p; // 몸통·머리 쪽(접힘선 오른쪽)은 그대로.
  const factor = Math.min(1, (foldX - p.x) / foldX); // 접힘선 0 → 꼬리 끝 1
  const angle = wave * factor;
  const dx = p.x - foldX;
  const dy = p.y - pivotY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: foldX + dx * cos - dy * sin,
    y: pivotY + dx * sin + dy * cos,
  };
}

// 입 벌림: 머리 영역(mouthX 오른쪽) 점을 중심선(pivotY) 기준으로 상하로 벌린다.
// 오른쪽 끝(스낫)일수록 크게, 중심선 위/아래로 갈라 입이 열리는 모양을 만든다.
// gapePx 는 이번 프레임의 최대 벌림 폭(px); 0 이면 원본을 그대로 돌려준다.
function chompPoint(p, mouthX, pivotY, gapePx, w) {
  if (gapePx <= 0 || p.x <= mouthX) return p;
  const span = w - mouthX || 1;
  const factor = Math.min(1, (p.x - mouthX) / span); // 경첩(0) → 스낫 끝(1)
  const side = p.y === pivotY ? 0 : p.y > pivotY ? 1 : -1;
  return { x: p.x, y: p.y + side * gapePx * factor };
}

// 물고기 위 이름표 텍스트: "{이름}의 물고기" / 익명은 "익명의 물고기"(REQ-OWN-004).
function nameTagFor(sprite) {
  const name =
    sprite.displayMode === "named" && sprite.displayName ? sprite.displayName : "익명";
  return `${name}의 물고기`;
}

// 손그림 스트로크를 스프라이트 위치에 방향(facing)·축소·꼬리 파닥임을 적용해 그린다(REQ-DRAW-003).
function drawFishSprite(ctx, sprite, now) {
  const { drawing } = sprite;
  if (!drawing || !Array.isArray(drawing.strokes)) return;
  const w = drawing.width || 300;
  const h = drawing.height || 200;
  // 사용자가 물고기 생성 시 지정한 가이드 위치를 쓴다. 구버전(필드 없음)은 기본값으로 폴백.
  const foldX = w * (drawing.tailFraction ?? TAIL_FOLD_FRACTION);
  const mouthX = w * (drawing.mouthFraction ?? MOUTH_FRACTION);
  const pivotY = h / 2;
  // 시간·위상 기반 꼬리 흔들림 각도.
  const t = (typeof now === "number" ? now : 0) / 1000;
  const wave = Math.sin(t * TAIL_SPEED + phaseFromId(sprite.id)) * TAIL_MAX_ANGLE;
  // 입 벌림 폭(px): 먹이 반응 세기(sprite.eat)에 여닫는 오물거림을 곱한다.
  // 0.5-0.5*cos 는 0..1 을 오가며 입을 완전히 다물었다 벌렸다 반복하게 한다.
  const eat = sprite.eat || 0;
  const chomp = 0.5 - 0.5 * Math.cos(t * CHOMP_SPEED + phaseFromId(sprite.id));
  const gapePx = eat * chomp * (h * MOUTH_MAX_OPEN);

  ctx.save();
  ctx.translate(sprite.x, sprite.y);
  ctx.scale(sprite.facing * SPRITE_SCALE, SPRITE_SCALE); // 진행 방향 반전 + 축소
  ctx.translate(-w / 2, -h / 2); // 그림 중심을 스프라이트 위치에 맞춤
  for (const stroke of drawing.strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // 꼬리는 왼쪽(foldX 이하)만, 입은 오른쪽(mouthX 이상)만 변형하므로 두 변형은
    // 서로 다른 영역에 작용해 합성해도 겹치지 않는다.
    const p0 = chompPoint(
      bendPoint(stroke.points[0], foldX, pivotY, wave),
      mouthX,
      pivotY,
      gapePx,
      w,
    );
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      const p = chompPoint(
        bendPoint(stroke.points[i], foldX, pivotY, wave),
        mouthX,
        pivotY,
        gapePx,
        w,
      );
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // 이름표: 반전(facing) 변환 밖에서 그려 글자가 뒤집히지 않게 한다.
  const tagY = sprite.y - (h * SPRITE_SCALE) / 2 - 8;
  ctx.save();
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)"; // 밝은 배경에서도 읽히는 외곽선
  ctx.fillStyle = "#ffffff";
  const tag = nameTagFor(sprite);
  ctx.strokeText(tag, sprite.x, tagY);
  ctx.fillText(tag, sprite.x, tagY);
  ctx.restore();
}
