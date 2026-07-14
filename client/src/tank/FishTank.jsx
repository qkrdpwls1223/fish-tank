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
  rollResidentBiter,
  applyLure,
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

// @MX:NOTE: [AUTO] 수면(하늘/수면 밴드) 높이 비율. 밴드 CSS height "20%"와 동일해야 배가 수면에 얹힌다.
const SURFACE_RATIO = 0.2;
// @MX:NOTE: [AUTO] 낚싯대 끝(rodTip=낚싯줄 시작점)의 우측 여백(px). 배/낚시꾼과 이 값을 공유해
//   창 크기가 바뀌어도 낚싯줄이 낚시꾼 손끝(낚싯대 끝)에 정확히 붙게 한다.
const ROD_TIP_MARGIN_RIGHT = 46;
// @MX:NOTE: [AUTO] 낚싯대 끝을 수면보다 이만큼 위에 둔다(px). 줄이 수면 위 낚싯대 끝에서 시작해
//   수면을 지나 수중 찌로 내려가는 연결감을 만든다.
const ROD_TIP_ABOVE_SURFACE = 12;

// @MX:NOTE: [AUTO] 방향키(←/→) 또는 A/D 한 번에 배가 좌우로 움직이는 거리(px). 키보드만으로 조준 가능하게 한다.
const BOAT_KEY_STEP = 28;
// @MX:NOTE: [AUTO] 배(rodTip.x 기준)가 화면 좌/우 가장자리에서 유지하는 최소 여백(px).
//   우측 여백을 ROD_TIP_MARGIN_RIGHT 와 같게 두어, 이동 전 기본 위치가 기존 고정 위치와 동일해진다.
const BOAT_EDGE_MARGIN_LEFT = 16;
const BOAT_EDGE_MARGIN_RIGHT = ROD_TIP_MARGIN_RIGHT;

// 배(수면 위 낚시꾼)의 수평 위치를 화면 안으로 제한한다. 인자/반환은 rodTip.x(낚싯줄 시작점) 기준이며,
// 선체가 좌우로 화면 밖으로 빠져나가지 않도록 클램프한다. 배·rodTip·낚싯줄이 모두 이 x 를 공유한다.
function clampBoatX(x, width) {
  const max = Math.max(BOAT_EDGE_MARGIN_LEFT, width - BOAT_EDGE_MARGIN_RIGHT);
  return Math.max(BOAT_EDGE_MARGIN_LEFT, Math.min(max, x));
}

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
 * @param {boolean} [props.fishing] - 낚시 모드 여부(기본 false). true 일 때만 낚시 UI/게임 루프/
 *   캔버스 조준이 동작하고, 배경 위에 하늘+수면 레이어를 덧입힌다. false 면 순수 어항 감상 화면이다.
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
  fishing = false,
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
  // 낚시 배의 수평 위치(rodTip.x = 낚싯줄 시작점 기준). null 이면 기본(우측) 위치를 쓴다.
  // 방향키/드래그로 바꾸며, 배와 rodTip·낚싯줄이 모두 이 값을 공유해 함께 움직인다(낚시 모드 전용).
  const [boatX, setBoatX] = useState(null);

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
  // rAF 그리기 루프와 이벤트 핸들러(캐스트/드래그)가 리렌더 없이 현재 배 x 를 읽도록 미러링한다.
  const boatXRef = useRef(null);
  // 배 포인터 드래그 진행 여부(마우스/터치). true 인 동안 pointermove 로 배 x 를 갱신한다.
  const boatDragRef = useRef(false);
  // 찌 반경 안에 "현재 들어와 있는" 물고기 id 집합. 새로 진입한 물고기만 입질 확률을 굴리기 위해
  // 이전 틱의 집합과 비교한다(같은 물고기를 매 틱 재굴림하지 않도록, BITE_CHANCE).
  const zoneRef = useRef(new Set());
  // 체류 물고기 상시 재굴림(rollResidentBiter)의 마지막 굴림 시각(ms). 캐스트 밖에서는 null 로 리셋.
  const residentRollRef = useRef(null);
  // 이번 입질에 이미 챔질(REEL+catchFish)이 시작됐는지 나타내는 동기 가드. gameRef.current 는 리렌더
  // 시점에만 갱신되므로, 스페이스 오토리핏/버튼 연타가 리렌더 전에 겹치면 phase 가 아직 BITING 으로 보여
  // catchFish 가 이중 호출될 여지가 있다. 이 ref 를 handleReel 진입 시 즉시 true 로 올려 재진입을 막고,
  // idle 로 복귀할 때만 false 로 되돌린다(다음 캐스트 준비).
  const reelingRef = useRef(false);

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

  // 낚싯대 던지기 (REQ-CATCH-001 게임 진입). 조준은 배 위치로만 결정된다 — 찌를 배(낚시꾼 손)
  // 바로 아래로 수직 낙하시킨다. x 는 현재 배 x(=rodTip.x), y 는 수면 아래 목표 지점(어항 중앙 깊이).
  // 버튼/스페이스 어느 경로로 던져도 배 아래 수직으로 나간다(NFR-A11Y-001, 조준 불필요).
  const handleCast = useCallback(() => {
    if (gameRef.current.phase !== IDLE) return; // 찌는 한 번에 하나
    const bounds = boundsRef.current;
    dispatchGame({
      type: "CAST",
      x: boatXRef.current, // 배 바로 아래(수직)
      y: bounds.height / 2,
      now: Date.now(),
    });
  }, []);

  // 컨테이너 픽셀 좌표계에서의 현재 포인터 x. 캔버스/오버레이는 CSS 로 100% 늘어나므로
  // 표시 크기 대비 내부(bounds) 좌표계로 환산한다(캔버스 클릭 조준과 동일한 스케일 처리).
  const pointerToBoundsX = useCallback((clientX) => {
    const el = containerRef.current;
    if (!el) return clientX;
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width ? boundsRef.current.width / rect.width : 1;
    return (clientX - rect.left) * scaleX;
  }, []);

  // 배 드래그 시작(마우스/터치). 던진 상태(찌가 물에 있음)에는 배 이동을 잠근다 — IDLE 에서만 잡힌다.
  const handleBoatPointerDown = useCallback((e) => {
    if (gameRef.current.phase !== IDLE) return;
    boatDragRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault(); // 드래그 중 페이지 선택/스크롤 방지
  }, []);

  // 배 드래그 이동: 선체 중심이 포인터를 따라오도록 x 를 갱신한다(rodTip.x = 중심 bx - 30).
  const handleBoatPointerMove = useCallback(
    (e) => {
      if (!boatDragRef.current) return;
      const cx = pointerToBoundsX(e.clientX);
      setBoatX(clampBoatX(cx - 30, boundsRef.current.width));
    },
    [pointerToBoundsX],
  );

  // 배 드래그 종료: 포인터 캡처를 놓고 드래그 상태를 해제한다.
  const handleBoatPointerUp = useCallback((e) => {
    if (!boatDragRef.current) return;
    boatDragRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  // 건져올리기 (REQ-CATCH-001). 입질 중(타이밍 창 안)일 때만 성공한다. 성공 시 물고기의 원본 ID로
  // catch API 를 호출해 개인 수집함에 담는다. [CRITICAL] 비파괴(REQ-CATCH-003): 어항 상태(state.fish)를
  // 바꾸지 않고 실시간 이벤트도 보내지 않는다(REQ-PRIV-002). 결과는 본인 안내 문구로만 반영한다.
  const handleReel = useCallback(() => {
    const g = gameRef.current;
    if (g.phase !== BITING || !g.biterId) return; // 타이밍을 놓치면 헛챔질
    // 동기 가드: 리렌더로 phase 가 CAUGHT 로 갱신되기 전에 스페이스 오토리핏/연타가 겹쳐도
    // catchFish 가 두 번 호출되지 않게 한다(idle 복귀 시 reelingRef 를 되돌린다).
    if (reelingRef.current) return;
    reelingRef.current = true;
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
  // 낚시 모드(fishing)일 때만 돌린다 — 공유 어항 감상 화면에서는 불필요한 타이머가 돌지 않는다.
  useEffect(() => {
    if (!fishing) return undefined;
    const id = setInterval(() => {
      const g = gameRef.current;
      if (g.phase === CAST) {
        // 찌가 포물선으로 날아가 착수하기 전에는 입질이 없다(연출 후 판정 시작).
        if (Date.now() - (g.castAt ?? 0) < CAST_DROP_MS) return;
        const now = Date.now();
        // 반경 안 물고기 중 "이번에 새로 진입한" 물고기는 진입당 1회 굴린다(BITE_CHANCE).
        const zone = fishInZone(spritePositions(), g.bobber, BITE_RADIUS);
        const fresh = [];
        for (const fid of zone) if (!zoneRef.current.has(fid)) fresh.push(fid);
        zoneRef.current = zone;
        let biter = rollBiter(fresh, BITE_CHANCE, rng);
        // 진입 굴림에 아무도 안 물었으면, 반경 안에 머무는 물고기를 주기적으로 재굴림한다
        // (던져놓고 한참 무반응 방지). rolledAt 을 다음 틱의 lastRollAt 으로 넘긴다.
        if (!biter) {
          const res = rollResidentBiter(zone, now, residentRollRef.current, undefined, undefined, rng);
          residentRollRef.current = res.rolledAt;
          biter = res.biterId;
        }
        if (biter) dispatchGame({ type: "BITE", biterId: biter, now });
      } else {
        // 캐스트 상태가 아니면 진입 이력과 재굴림 타이머를 비운다 — 다음 캐스트에서 처음부터 새로 굴리도록.
        if (zoneRef.current.size) zoneRef.current = new Set();
        residentRollRef.current = null;
        // 예신→본신 전이, 본신→도망 전이는 리듀서가 시각을 보고 판단한다.
        if (g.phase === NIBBLE || g.phase === BITING) {
          dispatchGame({ type: "TICK", now: Date.now() });
        }
      }
    }, GAME_TICK_MS);
    return () => clearInterval(id);
  }, [fishing, spritePositions, rng]);

  // 스페이스바 즉시 조작(NFR-A11Y-001 향상): 대기 중이면 던지고, 본신(챔질 창)이면 즉시 건져올린다.
  // 버튼으로 커서를 옮기는 지연 없이 "지금!" 타이밍에 바로 챔질할 수 있게 하는 게 핵심.
  // 낚시 모드(fishing)일 때만 등록/해제한다. 입력 요소 포커스 시에는 무시하고, 스크롤/버튼 더블트리거를
  // 막기 위해 preventDefault 한다. 기존 던지기/건져올리기 버튼(접근성 경로)은 그대로 유지된다.
  // 방향키(←/→) 또는 A/D 로 배 좌우 이동, 스페이스로 던지기/챔질을 함께 처리한다(키보드만으로 완전 조작).
  useEffect(() => {
    if (!fishing) return undefined;
    const onKeyDown = (e) => {
      const el = e.target;
      const tag = el?.tagName;
      // 입력 중(텍스트 입력/편집 영역)에는 게임/이동 조작을 가로채지 않게 한다.
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      const phase = gameRef.current.phase;
      // ←/→ 또는 A/D: 배 좌우 이동. 던진 상태(찌가 물에 있음)에는 이동을 잠근다 — IDLE 에서만 움직인다.
      const lowerKey = typeof e.key === "string" ? e.key.toLowerCase() : "";
      const moveLeft = e.key === "ArrowLeft" || lowerKey === "a";
      const moveRight = e.key === "ArrowRight" || lowerKey === "d";
      if (moveLeft || moveRight) {
        if (phase !== IDLE) return;
        e.preventDefault(); // 페이지 좌우 스크롤 방지
        const dir = moveLeft ? -1 : 1;
        setBoatX((prev) => {
          const base = prev == null ? boatXRef.current : prev;
          return clampBoatX(base + dir * BOAT_KEY_STEP, boundsRef.current.width);
        });
        return;
      }
      // 스페이스: 대기 중이면 던지고, 본신(챔질 창)이면 즉시 건져올린다.
      if (e.key !== " " && e.code !== "Space") return;
      if (phase === IDLE) {
        e.preventDefault();
        handleCast();
      } else if (phase === BITING) {
        e.preventDefault();
        handleReel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fishing, handleCast, handleReel]);

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

  // idle 로 복귀하면 챔질 동기 가드를 되돌려 다음 입질에 다시 챔질할 수 있게 한다(이중호출 방지 리셋).
  useEffect(() => {
    if (game.phase === IDLE) reelingRef.current = false;
  }, [game.phase]);

  // 선택된 물고기 정보(REQ-INT-002). 삭제 등으로 사라지면 패널도 자동으로 닫힌다.
  const selectedFish = state.fish.find((f) => f.id === selectedId) ?? null;
  const selectedInfo = selectedFish ? fishInfo(selectedFish) : null;

  // 배의 현재 실효 x(이동 반영 + 현재 창 크기로 클램프). 미이동(null)이면 기존 고정 위치(우측)를 쓴다.
  // rAF 그리기 루프(boatXRef)와 SVG/드래그 오버레이(effectiveBoatX)가 같은 값을 공유해 함께 움직인다.
  const effectiveBoatX = clampBoatX(boatX ?? size.width - ROD_TIP_MARGIN_RIGHT, size.width);
  boatXRef.current = effectiveBoatX;

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
      // 미끼 유인(낚시 전용): 찌가 물에 착수해 있을 때만 반경 안 물고기를 찌 쪽으로 약하게 끈다.
      //  - 착수(CAST 낙하 완료) 이후, 예신/본신 단계에서 찌 주변으로 물고기를 모아 무반응을 줄인다.
      //  - fishing=false(공유/개인 어항 감상)면 game.bobber 가 null 이라 유인은 발생하지 않는다.
      // 훅에 걸린 물고기는 아래 applyHookedMotion 이 위치를 다시 덮어쓰므로 유인 영향이 없다.
      const g = gameRef.current;
      const bobberInWater =
        g.bobber &&
        (g.phase === NIBBLE ||
          g.phase === BITING ||
          (g.phase === CAST && Date.now() - (g.castAt ?? 0) >= CAST_DROP_MS));
      const lured = bobberInWater ? applyLure(flocked, g.bobber, dt) : flocked;
      const stepped = stepSprites(lured, dt, bounds);
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
        boatXRef.current, // 낚싯줄 시작점(rodTip.x)이 배를 따라가도록 현재 배 x 를 넘긴다
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
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      {/* 캔버스는 키보드로 조작할 수 없으므로, 아래 목록/버튼이 접근성 대체 수단이다(NFR-A11Y-001).
          낚시는 방향키(←/→)로 배를 옮기고 스페이스/버튼으로 던지므로 키보드만으로 완전히 조작 가능하다.
          배 드래그(마우스/터치)는 조준을 돕는 향상일 뿐이다. */}
      <p id="tank-canvas-desc" style={srOnly}>
        헤엄치는 물고기 그림입니다. 목록에서 각 물고기를 선택해 정보를 보거나,
        본인 물고기를 삭제하고, 먹이 주기 버튼으로 먹이를 줄 수 있어요.
        {fishing &&
          " 왼쪽/오른쪽 방향키나 A/D 키로 배를 좌우로 움직여 물고기 위로 옮긴 뒤, 낚싯대 던지기 버튼이나 스페이스바로 찌를 배 바로 아래에 던지세요. 물고기가 입질하면 건져올리기 버튼으로 낚아 수집함에 담을 수 있어요. 입질(찌가 쑥 들어간 순간) 때 스페이스바를 누르면 바로 챔질할 수 있어요."}
      </p>

      {/* 낚시 모드 배경 확장(장식): 화면 상단에 하늘+수면 레이어를 덧입힌다.
          물고기 좌표계/유영 로직은 절대 바꾸지 않고(공유 어항과 동일 시뮬레이션),
          이 레이어를 캔버스 위(z-index 2)에 얹어 수면 근처로 올라온 물고기가 자연스럽게
          수면 위로 가려지게만 한다. 하늘은 위에서 아래로 서서히 투명해져(밴드 하단 = 수면)
          경계가 부드럽고, 낚싯줄/찌 캐스팅이 과하게 가려지지 않도록 밴드 높이는 상단 20%로 둔다.
          순수 시각 장식이라 스크린리더에는 숨긴다(aria-hidden). */}
      {fishing && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "20%",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          {/* 하늘 그라디언트: 밴드 하단에서 투명해져 수중 배경과 부드럽게 이어진다. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: dark
                ? "linear-gradient(to bottom, #0b1a2b 0%, #14344d 68%, rgba(20,52,77,0) 100%)"
                : "linear-gradient(to bottom, #aee3ff 0%, #cdeeff 68%, rgba(205,238,255,0) 100%)",
            }}
          />
          {/* 수면 하이라이트 라인: 하늘과 물의 경계를 살짝 반짝이게 한다. */}
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 6,
              background: dark
                ? "linear-gradient(to bottom, rgba(120,180,220,0.35), rgba(120,180,220,0))"
                : "linear-gradient(to bottom, rgba(255,255,255,0.65), rgba(255,255,255,0))",
            }}
          />
        </div>
      )}

      {/* 수면 위 배 + 낚시꾼(장식). 낚싯대 끝을 rodTip 과 같은 좌표로 두어, 캔버스(z≈0)에 그려지는
          낚싯줄이 낚시꾼 손끝에서 시작하는 것처럼 이어진다. 하늘/수면 밴드(z2)와 컨트롤(z5) 사이(z3)에
          얹어 낚싯줄의 수면 위 구간(손끝 근처)을 배/낚시꾼이 살짝 가린다. 낚시 모드에서만 노출한다. */}
      {fishing && (
        <FishermanBoat width={size.width} height={size.height} dark={dark} boatX={effectiveBoatX} />
      )}

      {/* 배 드래그 히트 영역(마우스/터치 향상). 배 SVG 는 pointerEvents:none 이라 이 투명 오버레이가
          포인터를 받아 배를 좌우로 잡아끈다. 배 위(z3)·컨트롤(z5) 사이(z4)에 얹는다.
          던진 상태(찌가 물에 있음)에는 이동을 잠그려 pointerEvents 를 끈다(IDLE 에서만 잡힌다).
          순수 조작용이라 스크린리더에는 숨긴다(키보드는 방향키로 대체 — NFR-A11Y-001). */}
      {fishing && (
        <div
          data-testid="boat-drag-handle"
          aria-hidden="true"
          onPointerDown={handleBoatPointerDown}
          onPointerMove={handleBoatPointerMove}
          onPointerUp={handleBoatPointerUp}
          style={{
            position: "absolute",
            left: effectiveBoatX - 20,
            top: size.height * SURFACE_RATIO - 46,
            width: 100,
            height: 80,
            zIndex: 4,
            cursor: "grab",
            touchAction: "none",
            pointerEvents: game.phase === IDLE ? "auto" : "none",
          }}
        />
      )}

      {/* 하단 중앙 플로팅 컨트롤: 낚시 미니게임(던지기/건져올리기) + 안내 라이브 영역.
          두 버튼 모두 실제 <button> 이라 키보드로 완전히 조작 가능하다(NFR-A11Y-001).
          낚시 모드(fishing)일 때만 노출한다 — 공유 어항 감상 화면에는 낚시 UI가 없다. */}
      {fishing && (
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

        {/* 조작키 가이드(시각 안내). 키보드 조작법을 화면에 노출한다. 스크린리더에는
            위 캔버스 설명(tank-canvas-desc)이 이미 안내하므로 여기서는 중복 낭독을 피해 aria-hidden. */}
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 6,
            fontSize: 12,
            color: "#fff",
          }}
        >
          {[
            { keys: "A / D  또는  ← / →", desc: "배 이동" },
            { keys: "스페이스바", desc: "던지기 · 챔질" },
          ].map((g) => (
            <span
              key={g.desc}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "4px 10px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.38)",
                backdropFilter: "blur(2px)",
                textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              }}
            >
              <strong style={{ fontWeight: 700 }}>{g.keys}</strong>
              <span style={{ opacity: 0.85 }}>{g.desc}</span>
            </span>
          ))}
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
      )}

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

// 낚싯줄이 시작되는 낚싯대 끝(rod tip) 위치. 화면 상단 우측 수면 위 — 배 위 낚시꾼이 든
// 낚싯대의 끝 지점이다. 배/낚시꾼 SVG 레이어(FishermanBoat)와 같은 bounds·상수(SURFACE_RATIO,
// ROD_TIP_MARGIN_RIGHT, ROD_TIP_ABOVE_SURFACE)로 계산하므로, 창 크기가 바뀌어도 낚싯줄이
// 낚시꾼 손끝에 붙는다. 여기서 반환하는 좌표는 캔버스 좌표계(= 컨테이너 픽셀, 1:1)이다.
// @MX:ANCHOR: [AUTO] 낚싯줄 시작점 계약 — drawBobber(낚싯줄 렌더)와 FishermanBoat(배/낚시꾼 SVG)가
//   이 함수로 같은 지점을 공유해 손끝-줄 연결을 유지한다.
// @MX:REASON: 두 렌더 경로(캔버스 낚싯줄 + SVG 낚시꾼)가 반드시 같은 좌표를 써야 시각적 연결이 깨지지 않는다.
function rodTip(bounds, boatX) {
  const surfaceY = bounds.height * SURFACE_RATIO;
  const x = clampBoatX(boatX == null ? bounds.width - ROD_TIP_MARGIN_RIGHT : boatX, bounds.width);
  return { x, y: surfaceY - ROD_TIP_ABOVE_SURFACE };
}

// 수면에 떠 있는 배 + 낚시꾼(순수 시각 장식). SVG 벡터로 그려 앱 팔레트/라이트·다크와 어울리는
// 귀엽고 단순한 톤을 낸다. 낚싯대 끝을 rodTip 과 같은 bounds·상수로 계산하므로, 캔버스에 그려지는
// 낚싯줄이 이 낚시꾼의 손끝(낚싯대 끝)에서 시작하는 것처럼 이어진다(창 크기가 바뀌어도 유지).
// viewBox 를 컨테이너 픽셀 크기와 1:1 로 맞춰 절대 좌표로 그린다(캔버스 좌표계와 동일).
// 물결에 살짝 흔들리는 보빙 애니메이션을 넣되, prefers-reduced-motion 이면 정지한다(NFR-A11Y).
function FishermanBoat({ width, height, dark, boatX }) {
  const rt = rodTip({ width, height }, boatX); // 낚싯대 끝(= 낚싯줄 시작점). 배 x 를 공유해 함께 움직인다.
  const surfaceY = height * SURFACE_RATIO;
  const bx = rt.x + 30; // 선체 중심 x(낚싯대 끝의 오른쪽 아래)
  const by = surfaceY; // 선체가 얹히는 수면 라인 y

  // 낚시꾼 각 부위 기준점(선체 왼쪽에 앉아 왼쪽 수면으로 낚싯대를 드리운다).
  const headCx = bx - 12;
  const headCy = by - 33;
  const handX = bx - 16;
  const handY = by - 18;

  // 라이트/다크 팔레트: 나무 선체 + 재킷(앱 primary 계열) + 밝은 피부 + 챙모자.
  const pal = dark
    ? { hull: "#7c4a1e", rim: "#a9702f", jacket: "#2b4a8a", skin: "#d9b48c", hat: "#8a2f2f", rod: "#5a3a1e" }
    : { hull: "#b5651d", rim: "#d98a3b", jacket: colors.primary, skin: "#f2c8a0", hat: "#c0392b", rod: "#6b4226" };

  return (
    <svg
      data-testid="fishing-boat"
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      <style>{`
        @keyframes fisherBob {
          0%, 100% { transform: translateY(0) rotate(-1.2deg); }
          50% { transform: translateY(3px) rotate(1.2deg); }
        }
        .fisher-boat-group {
          animation: fisherBob 3.6s ease-in-out infinite;
          transform-box: fill-box;
          transform-origin: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .fisher-boat-group { animation: none; }
        }
      `}</style>
      <g className="fisher-boat-group">
        {/* 선체(둥근 사다리꼴) */}
        <path
          d={`M ${bx - 42} ${by} Q ${bx} ${by + 4} ${bx + 42} ${by} L ${bx + 30} ${by + 16} Q ${bx} ${by + 22} ${bx - 30} ${by + 16} Z`}
          fill={pal.hull}
          stroke={pal.rim}
          strokeWidth="1.5"
        />
        {/* 갑판 림(수면에 얹힌 윗선) */}
        <path
          d={`M ${bx - 42} ${by} Q ${bx} ${by + 4} ${bx + 42} ${by}`}
          fill="none"
          stroke={pal.rim}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* 낚시꾼 몸통(재킷) */}
        <path
          d={`M ${headCx - 7} ${by - 2} Q ${headCx} ${by - 26} ${headCx + 7} ${by - 2} Z`}
          fill={pal.jacket}
        />
        {/* 팔: 어깨 → 손(낚싯대 손잡이) */}
        <line
          x1={headCx + 2}
          y1={by - 18}
          x2={handX}
          y2={handY}
          stroke={pal.jacket}
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* 머리 */}
        <circle cx={headCx} cy={headCy} r="7" fill={pal.skin} />
        {/* 챙모자 */}
        <path
          d={`M ${headCx - 9} ${headCy - 3} Q ${headCx} ${headCy - 12} ${headCx + 9} ${headCy - 3} Z`}
          fill={pal.hat}
        />
        <rect x={headCx - 11} y={headCy - 3} width="22" height="3" rx="1.5" fill={pal.hat} />
        {/* 낚싯대: 손 → 낚싯대 끝(rodTip). 캔버스 낚싯줄이 정확히 이 끝에서 이어진다. */}
        <line
          x1={handX}
          y1={handY}
          x2={rt.x}
          y2={rt.y}
          stroke={pal.rod}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

// 캔버스에 먹이와 스프라이트를 그린다. 2D 컨텍스트 미지원(jsdom) 환경에서는 무시한다.
function drawTank(canvas, sprites, bounds, now, foods = [], game = null, ripples = [], cache = null, boatX = null) {
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
    drawBobber(ctx, game, now, bounds, boatX);
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
function drawBobber(ctx, game, now, bounds, boatX = null) {
  const pos = bobberScreenPos(game, now, bounds);
  const tip = rodTip(bounds, boatX);
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
