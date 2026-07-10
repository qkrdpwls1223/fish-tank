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
import {
  gameReducer,
  initialGameState,
  fishInZone,
  rollBiter,
  BITE_RADIUS,
  BITE_CHANCE,
  IDLE,
  CAST,
  NIBBLE,
  BITING,
  CAUGHT,
  ESCAPED,
} from "./fishingGame.js";
import { fishInfo } from "./fishInfo.js";
import { fetchFishSnapshot, deleteFish as deleteFishApi } from "../fish/fishApi.js";
import { catchFish as catchFishApi } from "../catch/catchApi.js";
import { sendFeed as sendFeedApi } from "./feedApi.js";
import { connectRealtime, defaultRealtimeUrl } from "./realtimeClient.js";
import { colors } from "../theme/colors.js";
// 렌더 캐싱/애니메이션은 세 렌더러 공용 모듈에 있다(SPEC-RASTER-001 M3). SPRITE_SCALE 은 이름표 위치에 쓴다.
import { createSpriteCache, drawFishBitmap, SPRITE_SCALE } from "../drawing/fishSprite.js";

// 창 크기 측정 전 초기 기본값(가변 어항). jsdom 등 ResizeObserver 미지원 시에도 유지된다.
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;

// @MX:NOTE: [AUTO] 낚시 게임 틱 주기(ms). 이 주기마다 입질 판정/도망 타이머를 갱신한다.
//   rAF(그리기)와 분리해 두어 테스트에서 가짜 타이머로 결정적으로 구동할 수 있다.
const GAME_TICK_MS = 100;
// @MX:NOTE: [AUTO] 건짐 성공/도망 연출을 보여준 뒤 찌를 걷어 다시 던질 수 있게 되기까지의 지연(ms).
const CLEAR_DELAY_MS = 1400;
// @MX:NOTE: [AUTO] 입질 중 물고기가 바둥바둥 제자리에서 떠는 진폭(px). 훅 지점 주위 오실레이션 크기.
const STRUGGLE_AMPLITUDE = 6;
// @MX:NOTE: [AUTO] 건져올리기 성공 시 물고기가 수면 위로 끌려 올라가는 모션 길이(ms). CLEAR_DELAY_MS 안에 끝나야 한다.
const REEL_UP_MS = 650;
// @MX:NOTE: [AUTO] 낚싯대를 던질 때 찌가 목표 지점으로 수직 낙하하는 시간(ms). 이 시간 뒤에 착수(입질 활성).
const CAST_DROP_MS = 500;
// @MX:NOTE: [AUTO] 찌가 낙하를 시작하는, 목표 지점 위쪽 높이(px). 이 높이에서 곧장 아래로 떨어진다.
const CAST_DROP_HEIGHT = 70;
// @MX:NOTE: [AUTO] 착수 물보라/입질 파문 링이 퍼지며 사라지는 시간(ms).
const RIPPLE_MS = 700;
// @MX:NOTE: [AUTO] 파문 링이 퍼지는 최대 반지름(px).
const RIPPLE_MAX_R = 34;
// @MX:NOTE: [AUTO] 본신(strike) 시 찌가 수면 아래로 쑥 들어가는 깊이(px). 명확한 "지금!" 신호.
const DIP_DEPTH = 16;
// @MX:NOTE: [AUTO] 대기 중 찌의 잔잔한 아이들 보빙 진폭(px)과 속도(rad/s). 살아있는 느낌.
const IDLE_BOB_AMP = 2.5;
const IDLE_BOB_SPEED = 1.8;
// @MX:NOTE: [AUTO] 예신(nibble) 시 찌가 톡톡 떨리는 진폭(px). 본신 전 전조 신호.
const NIBBLE_TREMBLE = 3;

// 기본 스냅샷 로더는 모듈 스코프에 두어 참조를 고정한다. 컴포넌트 안에서 인라인 화살표로
// 기본값을 주면 매 렌더마다 새 함수가 생겨 resync → 마운트 useEffect 가 재실행되고,
// WS 연결이 끊겼다 붙기를 반복하며 GET /api/fish 가 무한 재요청되는 루프가 생긴다.
const defaultLoadSnapshot = (t) => fetchFishSnapshot({ token: t });

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
 * @param {(params:{token:string,id:string})=>Promise<object>} [props.catchFish] - 낚시 API(테스트 주입, REQ-CATCH-001)
 * @param {()=>{id:string,x:number,y:number}[]} [props.getSpritePositions] - 입질 판정용 현재 물고기 위치 제공자(테스트 주입). 기본은 실시간 시뮬레이션 렌더 위치.
 * @param {()=>number} [props.rng] - 입질 확률 굴림용 난수원(테스트 주입, 기본 Math.random).
 */
export default function FishTank({
  token,
  loadSnapshot = defaultLoadSnapshot,
  connect = connectRealtime,
  realtimeUrl = defaultRealtimeUrl(),
  deleteFish = deleteFishApi,
  onFeed = sendFeedApi,
  catchFish = catchFishApi,
  getSpritePositions,
  rng = Math.random,
}) {
  const [state, dispatch] = useReducer(tankReducer, initialTankState);
  const [selectedId, setSelectedId] = useState(null); // 정보 조회 대상(REQ-INT-002)
  const [feedMessage, setFeedMessage] = useState(""); // 먹이주기 접근성 안내(aria-live)
  const [catchMessage, setCatchMessage] = useState(""); // 낚시 게임 진행/결과 접근성 안내(aria-live)
  // 동일 낚시 문구를 반복해도 라이브 영역이 재낭독되도록 콘텐츠 키를 바꾸는 카운터(NFR-A11Y-001).
  const [catchAnnounceCount, setCatchAnnounceCount] = useState(0);
  // 낚시 미니게임 상태(던지기→입질→건짐|도망). 순수 리듀서(fishingGame.js)로 전이한다.
  const [game, dispatchGame] = useReducer(gameReducer, undefined, initialGameState);
  // @MX:NOTE: [AUTO] 먹이 안내 재낭독 카운터. 동일 문구를 반복해도 라이브 영역 콘텐츠가
  //   바뀌도록(key 재마운트) 하여 스크린리더가 매번 재낭독하게 한다(NFR-A11Y-001).
  const [feedAnnounceCount, setFeedAnnounceCount] = useState(0);
  const [listOpen, setListOpen] = useState(false); // 물고기 목록 패널 토글(기본 닫힘)
  const [dark, setDark] = useState(false); // 어항 배경 라이트/다크 선택
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const spritesRef = useRef(new Map()); // id → sprite(위치/속도), 프레임 간 유지
  const spriteCacheRef = useRef(createSpriteCache()); // id → 오프스크린 비트맵 캐시(REQ-RENDER-001/002)
  const foodsRef = useRef([]); // 임시 먹이 아이템(REQ-INT-001), 프레임 간 유지
  const ripplesRef = useRef([]); // 착수/입질 물보라 파문(캔버스 전용 시각 효과), 프레임 간 유지
  const boundsRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }); // 애니메이션 루프가 읽는 현재 헤엄 범위
  // 게임 루프(setInterval)와 rAF 그리기가 최신 게임 상태를 리렌더 없이 읽도록 미러링한다.
  const gameRef = useRef(game);
  gameRef.current = game;
  // 찌 반경 안에 "현재 들어와 있는" 물고기 id 집합. 새로 진입한 물고기만 입질 확률을 굴리기 위해
  // 이전 틱의 집합과 비교한다(같은 물고기를 매 틱 재굴림하지 않도록, BITE_CHANCE).
  const zoneRef = useRef(new Set());

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
        if (active) resync().catch(() => { });
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

  // 동일 문구여도 콘텐츠 키를 올려 라이브 영역이 재낭독되게 하는 공용 안내 함수(NFR-A11Y-001).
  const announce = useCallback((msg) => {
    setCatchMessage(msg);
    setCatchAnnounceCount((n) => n + 1);
  }, []);

  // 입질 판정에 쓸 현재 물고기 위치 제공자. 기본은 실시간 시뮬레이션의 렌더 좌표(spritesRef).
  // 테스트는 getSpritePositions prop 으로 결정적 위치를 주입한다.
  const spritePositions = useCallback(() => {
    if (getSpritePositions) return getSpritePositions();
    return Array.from(spritesRef.current.values()).map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
    }));
  }, [getSpritePositions]);

  // 낚싯대 던지기 (REQ-CATCH-001 게임 진입). target 이 있으면 그 지점(캔버스 클릭 조준),
  // 없으면 어항 중앙 수면 근처로 던진다(버튼 = 조준 불필요한 접근성 경로, NFR-A11Y-001).
  const handleCast = useCallback((target) => {
    if (gameRef.current.phase !== IDLE) return; // 찌는 한 번에 하나
    const bounds = boundsRef.current;
    const pos = target ?? { x: bounds.width / 2, y: bounds.height / 2 };
    dispatchGame({ type: "CAST", x: pos.x, y: pos.y, now: Date.now() });
  }, []);

  // 캔버스 클릭 조준(선택적 향상). 대기 상태에서만 클릭 지점으로 던진다.
  const handleCanvasClick = useCallback(
    (e) => {
      if (gameRef.current.phase !== IDLE) return;
      const rect = e.currentTarget.getBoundingClientRect();
      // 캔버스는 CSS 로 100% 늘어나므로 표시 크기 대비 내부 좌표계로 환산한다.
      const scaleX = rect.width ? boundsRef.current.width / rect.width : 1;
      const scaleY = rect.height ? boundsRef.current.height / rect.height : 1;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      handleCast({ x, y });
    },
    [handleCast],
  );

  // 건져올리기 (REQ-CATCH-001). 입질 중(타이밍 창 안)일 때만 성공한다. 성공 시 물고기의 원본 ID로
  // catch API 를 호출해 개인 수집함에 담는다. [CRITICAL] 비파괴(REQ-CATCH-003): 어항 상태(state.fish)를
  // 바꾸지 않고 실시간 이벤트도 보내지 않는다(REQ-PRIV-002). 결과는 본인 안내 문구로만 반영한다.
  const handleReel = useCallback(() => {
    const g = gameRef.current;
    if (g.phase !== BITING || !g.biterId) return; // 타이밍을 놓치면 헛챔질
    const biterId = g.biterId;
    dispatchGame({ type: "REEL", now: Date.now() }); // biting → caught (끌어올리기 모션 시작)
    catchFish({ token, id: biterId })
      .then((res) => {
        // 신규면 담김, 중복(alreadyCollected)이면 멱등 안내(REQ-CATCH-005).
        announce(
          res?.alreadyCollected ? "이미 수집함에 있어요." : "잡았다! 수집함에 담겼어요.",
        );
      })
      .catch((err) => {
        // 원본이 사라진 경우(404) 안내(REQ-CATCH-004). 그 외는 일반 실패 안내.
        announce(
          err?.code === "not_found"
            ? "물고기가 사라졌어요."
            : "낚기에 실패했어요. 잠시 후 다시 시도해 주세요.",
        );
      });
  }, [catchFish, token, announce]);

  // 게임 루프: 입질 판정(확률) + 예신→본신→도망 타이머. rAF(그리기)와 분리한 setInterval 로 돌려
  // 테스트에서 가짜 타이머로 결정적으로 구동한다. Date.now() 는 가짜 타이머에 함께 묶인다.
  useEffect(() => {
    const id = setInterval(() => {
      const g = gameRef.current;
      if (g.phase === CAST) {
        // 찌가 포물선으로 날아가 착수하기 전에는 입질이 없다(연출 후 판정 시작).
        if (Date.now() - (g.castAt ?? 0) < CAST_DROP_MS) return;
        // 반경 안 물고기 중 "이번에 새로 진입한" 물고기만 확률 굴림한다(진입당 1회, 매 틱 재굴림 아님).
        const zone = fishInZone(spritePositions(), g.bobber, BITE_RADIUS);
        const fresh = [];
        for (const fid of zone) if (!zoneRef.current.has(fid)) fresh.push(fid);
        zoneRef.current = zone;
        const biter = rollBiter(fresh, BITE_CHANCE, rng);
        if (biter) dispatchGame({ type: "BITE", biterId: biter, now: Date.now() });
      } else {
        // 캐스트 상태가 아니면 진입 이력을 비운다 — 다음 캐스트에서 처음부터 새로 굴리도록.
        if (zoneRef.current.size) zoneRef.current = new Set();
        // 예신→본신 전이, 본신→도망 전이는 리듀서가 시각을 보고 판단한다.
        if (g.phase === NIBBLE || g.phase === BITING) {
          dispatchGame({ type: "TICK", now: Date.now() });
        }
      }
    }, GAME_TICK_MS);
    return () => clearInterval(id);
  }, [spritePositions, rng]);

  // 단계 전이에 따른 안내(던짐/예신/본신/도망). 건짐 성공 문구는 handleReel 의 API 응답에서 낸다.
  useEffect(() => {
    if (game.phase === CAST) announce("낚싯대를 던졌어요. 입질을 기다려요.");
    else if (game.phase === NIBBLE) announce("찌가 톡톡… 입질이 오고 있어요.");
    else if (game.phase === BITING) announce("찌가 쑥 들어갔어요! 지금 건져올리기!");
    else if (game.phase === ESCAPED) announce("미끼만 먹고 도망갔어요!");
  }, [game.phase, announce]);

  // 착수 물보라: 찌가 수직으로 떨어져 착수하는 순간(CAST_DROP_MS 뒤) 파문을 남긴다.
  useEffect(() => {
    if (game.phase !== CAST || !game.bobber) return undefined;
    const { x, y } = game.bobber;
    const t = setTimeout(() => {
      ripplesRef.current.push({ x, y, start: Date.now() });
    }, CAST_DROP_MS);
    return () => clearTimeout(t);
  }, [game.phase, game.castAt, game.bobber]);

  // 입질 물보라: 본신(strike)으로 찌가 쑥 들어가는 순간 잔물결을 남긴다.
  useEffect(() => {
    if (game.phase !== BITING || !game.bobber) return;
    ripplesRef.current.push({ x: game.bobber.x, y: game.bobber.y, start: Date.now() });
  }, [game.phase, game.bobber]);

  // 도망 연출: 입질하던 물고기가 찌에서 멀어지는 방향으로 확 튀게 속도를 준다(캔버스 시각 효과).
  // 어항 상태(state.fish)는 건드리지 않으므로 비파괴 불변식과 무관하다(REQ-CATCH-003).
  useEffect(() => {
    if (game.phase !== ESCAPED || !game.biterId || !game.bobber) return;
    const s = spritesRef.current.get(game.biterId);
    if (!s) return;
    const dx = s.x - game.bobber.x;
    const dy = s.y - game.bobber.y;
    const d = Math.hypot(dx, dy) || 1;
    const DART = 300; // 도망 순간 속도(px/s)
    spritesRef.current.set(game.biterId, {
      ...s,
      vx: (dx / d) * DART,
      vy: (dy / d) * DART,
      facing: dx >= 0 ? 1 : -1,
    });
  }, [game.phase, game.biterId, game.bobber]);

  // 건짐/도망 후 잠시 연출을 보여준 뒤 찌를 걷어 다시 던질 수 있게 한다(idle 복귀).
  useEffect(() => {
    if (game.phase !== CAUGHT && game.phase !== ESCAPED) return undefined;
    const t = setTimeout(() => dispatchGame({ type: "CLEAR" }), CLEAR_DELAY_MS);
    return () => clearTimeout(t);
  }, [game.phase]);

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
    // 사라진 물고기의 비트맵 캐시를 축출한다(REQ-RENDER-002, 캐시 무한 증가 방지).
    spriteCacheRef.current.prune(ids);
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
      // 훅에 걸린 물고기 시각 오버라이드(공유 어항 state.fish 는 불변 — 비파괴 REQ-CATCH-003):
      //  - 예신/본신: 찌 근처 훅 지점에 고정하고 바둥바둥 떨게 한다(제자리 스트러글).
      //  - 건짐 성공: 훅 지점에서 수면 위로 끌려 올라가는 모션.
      applyHookedMotion(map, gameRef.current, now);
      // 수명이 지난 파문은 제거한다(퍼졌다 사라지는 물보라 링).
      const nowMs = Date.now();
      ripplesRef.current = ripplesRef.current.filter((r) => nowMs - r.start < RIPPLE_MS);
      drawTank(
        canvasRef.current,
        selectAnimated(stepped),
        bounds,
        now,
        foodsRef.current,
        gameRef.current,
        ripplesRef.current,
        spriteCacheRef.current,
      );
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
        onClick={handleCanvasClick}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {/* 캔버스는 키보드로 조작할 수 없으므로, 아래 목록/버튼이 접근성 대체 수단이다(NFR-A11Y-001).
          낚시도 캔버스 조준(클릭)은 마우스 전용 향상일 뿐, '낚싯대 던지기'/'건져올리기' 버튼으로 완전히 조작 가능하다. */}
      <p id="tank-canvas-desc" style={srOnly}>
        헤엄치는 물고기 그림입니다. 목록에서 각 물고기를 선택해 정보를 보거나,
        본인 물고기를 삭제하고, 먹이 주기 버튼으로 먹이를 줄 수 있어요.
        낚싯대 던지기 버튼으로 찌를 던지고, 물고기가 입질하면 건져올리기 버튼으로 낚아 수집함에 담을 수 있어요.
      </p>

      {/* 하단 중앙 플로팅 컨트롤: 낚시 미니게임(던지기/건져올리기) + 안내 라이브 영역.
          두 버튼 모두 실제 <button> 이라 키보드로 완전히 조작 가능하다(NFR-A11Y-001). */}
      <div
        role="group"
        aria-label="낚시"
        style={{
          position: "absolute",
          left: "50%",
          bottom: 20,
          transform: "translateX(-50%)",
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          maxWidth: "min(360px, 90vw)",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {/* 낚싯대 던지기: 대기 상태에서만 활성. 조준 없이 기본 지점으로 던지는 접근성 경로. */}
          <button
            type="button"
            onClick={() => handleCast()}
            disabled={game.phase !== IDLE}
            aria-disabled={game.phase !== IDLE}
            style={{
              background: game.phase === IDLE ? colors.primary : "#9aa3ad",
              color: colors.onPrimary,
              border: "none",
              borderRadius: 999,
              padding: "10px 16px",
              fontWeight: 600,
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              cursor: game.phase === IDLE ? "pointer" : "not-allowed",
            }}
          >
            낚싯대 던지기
          </button>
          {/* 건져올리기: 입질 중(타이밍 창)일 때만 활성. 놓치면 물고기가 도망간다. */}
          <button
            type="button"
            onClick={handleReel}
            disabled={game.phase !== BITING}
            aria-disabled={game.phase !== BITING}
            style={{
              background: game.phase === BITING ? colors.danger : "#9aa3ad",
              color: colors.onPrimary,
              border: "none",
              borderRadius: 999,
              padding: "10px 16px",
              fontWeight: 600,
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              cursor: game.phase === BITING ? "pointer" : "not-allowed",
            }}
          >
            건져올리기
          </button>
        </div>

        {/* 낚시 안내 라이브 영역. key 로 재마운트해 동일 문구도 재낭독한다(NFR-A11Y-001). */}
        {catchMessage && (
          <p
            key={catchAnnounceCount}
            role="status"
            aria-label="낚시 안내"
            aria-live="assertive"
            data-announce-count={catchAnnounceCount}
            style={{
              margin: 0,
              fontSize: 13,
              color: "#fff",
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
              minHeight: 18,
            }}
          >
            {catchMessage}
          </p>
        )}
      </div>

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
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                <div role="status" aria-label="물고기 정보" style={{ color: colors.text }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>{selectedInfo.label}</p>
                  <p style={{ margin: "2px 0 0", color: colors.muted, fontSize: 13 }}>
                    등록 시각: {selectedInfo.createdAt}
                  </p>
                </div>
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

// 어항 좌상단 기준 낚싯대 끝(rod tip) 위치. 우상단 모서리 근처에 고정한다(바닥 중앙 캐스트 버튼과 대비).
function rodTip(bounds) {
  return { x: bounds.width - 24, y: 12 };
}

// 캔버스에 먹이와 스프라이트를 그린다. 2D 컨텍스트 미지원(jsdom) 환경에서는 무시한다.
function drawTank(canvas, sprites, bounds, now, foods = [], game = null, ripples = [], cache = null) {
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return;

  ctx.clearRect(0, 0, bounds.width, bounds.height);
  for (const ripple of ripples) {
    drawRipple(ctx, ripple);
  }
  for (const food of foods) {
    drawFoodPellet(ctx, food);
  }
  for (const sprite of sprites) {
    drawFishSprite(ctx, sprite, now, cache);
  }
  if (game && game.bobber) {
    drawBobber(ctx, game, now, bounds);
  }
}

// 착수/입질 파문: 퍼지며 옅어지는 물보라 링 2겹.
function drawRipple(ctx, ripple) {
  const age = Date.now() - ripple.start;
  const p = Math.min(1, Math.max(0, age / RIPPLE_MS));
  if (p >= 1) return;
  const alpha = (1 - p) * 0.6;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, 4 + p * RIPPLE_MAX_R, 0, Math.PI * 2);
  ctx.stroke();
  // 안쪽에 조금 뒤따르는 두 번째 링.
  const p2 = Math.max(0, p - 0.25);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.35})`;
  ctx.beginPath();
  ctx.arc(ripple.x, ripple.y, 2 + p2 * RIPPLE_MAX_R * 0.7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// 건져올리기 진행도(0..1). CAUGHT 상태에서 caughtAt 이후 경과 시간을 REEL_UP_MS 로 정규화한다.
// 그리기(rAF)와 게임 타이머가 같은 Date 클록을 쓰도록 Date.now() 기준으로 계산한다.
function reelProgress(game) {
  if (game.phase !== CAUGHT || game.caughtAt == null) return 0;
  return Math.min(1, Math.max(0, (Date.now() - game.caughtAt) / REEL_UP_MS));
}

// 훅에 걸린 물고기의 위치를 시각적으로 오버라이드한다(스프라이트 객체를 제자리 변형).
// map 의 스프라이트는 stepped 배열과 같은 참조이므로 여기서 바꾸면 그리기에 즉시 반영된다.
// state.fish(공유 어항)는 절대 건드리지 않는다 — 비파괴/비공유 불변식 유지(REQ-CATCH-003/PRIV-002).
function applyHookedMotion(map, game, now) {
  if (!game.biterId || !game.bobber) return;
  const s = map.get(game.biterId);
  if (!s) return;
  const t = (typeof now === "number" ? now : 0) / 1000;
  if (game.phase === NIBBLE) {
    // 예신: 훅 지점에 고정하되 아주 작게 톡톡 떨기만 한다(본신 전 전조).
    s.x = game.bobber.x + Math.sin(t * 26) * NIBBLE_TREMBLE;
    s.y = game.bobber.y + Math.sin(t * 31) * NIBBLE_TREMBLE * 0.6;
    s.vx = 0;
    s.vy = 0;
    s.eat = 0;
  } else if (game.phase === BITING) {
    // 바둥바둥: 훅 지점(찌)에 고정하고 서로 다른 주파수의 진동으로 제자리에서 발버둥친다.
    s.x = game.bobber.x + Math.sin(t * 30) * STRUGGLE_AMPLITUDE;
    s.y = game.bobber.y + Math.cos(t * 37) * STRUGGLE_AMPLITUDE;
    s.vx = 0;
    s.vy = 0;
    s.eat = 0;
  } else if (game.phase === CAUGHT) {
    // 끌려 올라가기: 훅 지점에서 수면 위(-40)로 선형 이동.
    const p = reelProgress(game);
    s.x = game.bobber.x;
    s.y = game.bobber.y * (1 - p) - 40 * p;
    s.vx = 0;
    s.vy = 0;
  }
  map.set(game.biterId, s);
}

// 찌가 그려질 현재 화면 위치를 단계별로 계산한다.
//   cast(비행): 낚싯대 끝 → 목표 지점 포물선 / cast(착수): 잔잔한 아이들 보빙 /
//   nibble: 톡톡 미세 떨림 / biting(본신): 수면 아래로 쑥(dip) / caught: 수면 위로 끌려 올라감.
function bobberScreenPos(game, now, bounds) {
  const { x, y } = game.bobber;
  const t = (typeof now === "number" ? now : 0) / 1000;

  if (game.phase === CAST) {
    const age = Date.now() - (game.castAt ?? 0);
    if (age < CAST_DROP_MS) {
      // 수직 낙하: 목표 지점 바로 위에서 x는 고정한 채 곧장 아래로 떨어진다(중력감 있게 가속).
      const p = age / CAST_DROP_MS;
      const startY = y - CAST_DROP_HEIGHT;
      return { x, y: startY + (y - startY) * (p * p), flying: true };
    }
    // 착수 후 대기: 잔잔한 아이들 보빙(살아있는 느낌).
    return { x, y: y + Math.sin(t * IDLE_BOB_SPEED) * IDLE_BOB_AMP, flying: false };
  }
  if (game.phase === NIBBLE) {
    // 예신: 톡톡 미세 떨림.
    return { x: x + Math.sin(t * 26) * 1.5, y: y + Math.sin(t * 22) * NIBBLE_TREMBLE, flying: false };
  }
  if (game.phase === BITING) {
    // 본신: 수면 아래로 쑥 들어간 채 부르르 떤다.
    return { x, y: y + DIP_DEPTH + Math.sin(t * 20) * 2, flying: false };
  }
  if (game.phase === CAUGHT) {
    // 건짐: 물고기와 함께 수면 위로 끌려 올라간다.
    const rise = (y + 40) * reelProgress(game);
    return { x, y: y - rise, flying: false };
  }
  return { x, y, flying: false };
}

// 찌(bobber)와 낚싯대 끝→찌 낚싯줄을 그린다. 단계별 위치는 bobberScreenPos 가 계산한다.
function drawBobber(ctx, game, now, bounds) {
  const pos = bobberScreenPos(game, now, bounds);
  const tip = rodTip(bounds);
  const biting = game.phase === BITING;
  const r = biting ? 8 : 6;

  ctx.save();
  // 낚싯대 끝에서 찌까지 이어지는 낚싯줄(캐스트/스트러글/끌어올리기 내내 찌를 따라간다).
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(pos.x, pos.y - r);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 찌 몸통: 위(빨강)/아래(흰) 반반. 본신 땐 조금 커진다.
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#e11d48";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y + r * 0.5, r * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();
}

// 먹이 알갱이를 그린다(물고기 뒤 레이어). 작은 단색 점 하나로 단순하게.
function drawFoodPellet(ctx, food) {
  ctx.beginPath();
  ctx.arc(food.x, food.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#c98a3b";
  ctx.fill();
}

// 물고기 위 이름표 텍스트: "{이름}의 물고기" / 익명은 "익명의 물고기"(REQ-OWN-004).
function nameTagFor(sprite) {
  const name =
    sprite.displayMode === "named" && sprite.displayName ? sprite.displayName : "익명";
  return `${name}의 물고기`;
}

// 물고기를 스프라이트 위치에 방향·축소·꼬리 파닥임·입 벌림을 적용해 그린다(REQ-DRAW-003, REQ-RENDER-*).
// 벡터(version 1)·래스터(version 2) 모두 오프스크린 캐시 비트맵을 blit 하는 공용 구현으로 처리한다.
function drawFishSprite(ctx, sprite, now, cache) {
  if (!cache) return;
  const entry = cache.getEntry(sprite);
  if (!entry) return; // 유효한 그림이 없으면(구 조기 반환과 동일) 이름표도 그리지 않는다.
  drawFishBitmap(ctx, entry, sprite, now); // 몸통 blit + 꼬리/입 스트립 애니메이션(래스터 디코드 전이면 무동작)

  // 이름표: 반전(facing) 변환 밖에서 그려 글자가 뒤집히지 않게 한다.
  const tagY = sprite.y - (entry.height * SPRITE_SCALE) / 2 - 8;
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
