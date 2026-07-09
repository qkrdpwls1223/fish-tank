import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import { initialTankState, tankReducer } from "./tankReducer.js";
import {
  spawnSprite,
  stepSprites,
  selectAnimated,
} from "./tankModel.js";
import { dropFood, stepFoods, reactToFoods } from "./feedingModel.js";
import { fishInfo } from "./fishInfo.js";
import { fetchFishSnapshot, deleteFish as deleteFishApi } from "../fish/fishApi.js";
import { sendFeed as sendFeedApi } from "./feedApi.js";
import { connectRealtime, defaultRealtimeUrl } from "./realtimeClient.js";
import { colors } from "../theme/colors.js";

const TANK_WIDTH = 800;
const TANK_HEIGHT = 600;

// 물고기 표시 라벨: 이름 물고기는 표시 이름, 익명은 "익명"만 노출한다(REQ-OWN-004).
function labelFor(f) {
  return f.displayMode === "named" && f.displayName ? f.displayName : "익명";
}

/**
 * 어항 렌더링 + 실시간 반영 컴포넌트.
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
  const canvasRef = useRef(null);
  const spritesRef = useRef(new Map()); // id → sprite(위치/속도), 프레임 간 유지
  const foodsRef = useRef([]); // 임시 먹이 아이템(REQ-INT-001), 프레임 간 유지

  // 진입/재연결 공용 스냅샷 로드 → 전체 치환 (REQ-RT-004, REQ-RT-003).
  const resync = useCallback(async () => {
    const fish = await loadSnapshot(token);
    dispatch({ type: "SNAPSHOT", fish });
  }, [loadSnapshot, token]);

  // 어항에 임시 먹이를 떨어뜨린다(REQ-INT-001). 애니메이션 루프가 소비한다.
  const addFoodLocal = useCallback((x, y) => {
    foodsRef.current = [...foodsRef.current, dropFood({ x, y }, Date.now())];
    setFeedMessage("물고기에게 먹이를 주었어요.");
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
    const x = TANK_WIDTH / 2;
    const y = TANK_HEIGHT / 2;
    addFoodLocal(x, y);
    onFeed({ token, x, y }).catch(() => {
      /* 공유 실패해도 로컬 먹이 효과는 유지한다(어항 상태 불변) */
    });
  }, [addFoodLocal, onFeed, token]);

  const bounds = { width: TANK_WIDTH, height: TANK_HEIGHT };

  // 선택된 물고기 정보(REQ-INT-002). 삭제 등으로 사라지면 패널도 자동으로 닫힌다.
  const selectedFish = state.fish.find((f) => f.id === selectedId) ?? null;
  const selectedInfo = selectedFish ? fishInfo(selectedFish) : null;

  // 물고기 목록이 바뀌면 스프라이트 맵을 조정한다(추가 스폰/삭제 정리).
  useEffect(() => {
    const map = spritesRef.current;
    const ids = new Set(state.fish.map((f) => f.id));
    for (const f of state.fish) {
      if (!map.has(f.id)) map.set(f.id, spawnSprite(f, bounds));
    }
    for (const id of map.keys()) {
      if (!ids.has(id)) map.delete(id);
    }
  }, [state.fish]); // eslint-disable-line react-hooks/exhaustive-deps

  // 애니메이션 루프. jsdom 등 rAF 미지원 환경에서는 조용히 건너뛴다(로직은 tankModel 로 검증).
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return undefined;
    let raf = null;
    let last = null;

    const frame = (now) => {
      const dt = last == null ? 16 : now - last;
      last = now;
      const map = spritesRef.current;
      // 먹이가 있으면 물고기가 먹이 쪽으로 반응한 뒤 전진한다(REQ-INT-001).
      foodsRef.current = stepFoods(foodsRef.current, dt);
      const reacting = reactToFoods([...map.values()], foodsRef.current);
      const stepped = stepSprites(reacting, dt, bounds);
      for (const s of stepped) map.set(s.id, s);
      drawTank(canvasRef.current, selectAnimated(stepped), bounds);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section>
      <h2>어항</h2>
      <canvas
        ref={canvasRef}
        width={TANK_WIDTH}
        height={TANK_HEIGHT}
        aria-label="어항"
        role="img"
        aria-describedby="tank-canvas-desc"
        style={{ border: `1px solid ${colors.border}`, width: "100%", maxWidth: TANK_WIDTH }}
      />
      {/* 캔버스 자체는 키보드로 조작할 수 없으므로, 아래 목록/버튼이 접근성 대체 수단이다(NFR-A11Y-001). */}
      <p id="tank-canvas-desc" style={{ color: colors.muted }}>
        헤엄치는 물고기 그림입니다. 아래 목록에서 각 물고기를 선택해 정보를 보거나,
        본인 물고기를 삭제하고, 먹이 주기 버튼으로 먹이를 줄 수 있어요.
      </p>
      {/* 먹이 주기 (REQ-INT-001). 누르면 물고기가 먹이 쪽으로 반응한다. */}
      <button
        type="button"
        onClick={handleFeed}
        style={{ background: colors.primary, color: colors.onPrimary }}
      >
        먹이 주기
      </button>
      {/* 먹이 안내 라이브 영역. key 로 재마운트해 동일 문구도 재낭독한다(NFR-A11Y-001). */}
      <p
        key={feedAnnounceCount}
        role="status"
        aria-label="먹이 주기 안내"
        aria-live="assertive"
        data-announce-count={feedAnnounceCount}
      >
        {feedMessage}
      </p>

      {/* 접근성/테스트용 텍스트 대체: 현재 어항의 물고기 목록. 익명은 신원 미노출. */}
      <p role="status" aria-live="polite">현재 {state.fish.length}마리가 헤엄치고 있어요.</p>
      <ul>
        {state.fish.map((f) => (
          <li key={f.id}>
            {/* 라벨을 버튼으로 만들어 클릭 시 정보를 조회한다(REQ-INT-002). 키보드 접근 가능. */}
            <button type="button" onClick={() => setSelectedId(f.id)}>
              {labelFor(f)}
            </button>
            {/* 삭제 버튼은 서버가 계산한 deletable(본인 소유)에만 노출한다.
                익명 신원은 노출하지 않으므로 라벨도 일반 문구를 쓴다(REQ-OWN-002/004). */}
            {f.deletable && (
              <button
                type="button"
                aria-label="물고기 삭제"
                onClick={() => handleDelete(f.id)}
                style={{ color: colors.danger }}
              >
                삭제
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* 물고기 정보 패널 (REQ-INT-002). 익명은 "익명"으로만, 소유자 신원은 절대 미노출. */}
      {selectedFish && (
        <div role="status" aria-label="물고기 정보">
          <p>{selectedInfo.label}</p>
          <p>등록 시각: {selectedInfo.createdAt}</p>
        </div>
      )}
    </section>
  );
}

// 캔버스에 스프라이트를 그린다. 2D 컨텍스트 미지원(jsdom) 환경에서는 무시한다.
function drawTank(canvas, sprites, bounds) {
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return;

  ctx.clearRect(0, 0, bounds.width, bounds.height);
  for (const sprite of sprites) {
    drawFishSprite(ctx, sprite);
  }
}

// 손그림 스트로크를 스프라이트 위치에 방향(facing)에 맞춰 그린다(REQ-DRAW-003).
function drawFishSprite(ctx, sprite) {
  const { drawing } = sprite;
  if (!drawing || !Array.isArray(drawing.strokes)) return;
  ctx.save();
  ctx.translate(sprite.x, sprite.y);
  ctx.scale(sprite.facing, 1); // 진행 방향으로 좌우 반전
  for (const stroke of drawing.strokes) {
    if (!stroke.points || stroke.points.length === 0) continue;
    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i += 1) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
