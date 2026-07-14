import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchMyTank as defaultFetchMyTank,
  moveMyTankFish as defaultMoveFish,
  deleteMyTankFish as defaultDeleteFish,
  createMyTankDecor as defaultCreateDecor,
  moveMyTankDecor as defaultMoveDecor,
  deleteMyTankDecor as defaultDeleteDecor,
} from "./myTankApi.js";
import { DECOR_KINDS, DEFAULT_DECOR_POS, decorLabel, decorHitRadius, drawDecor } from "./decor.js";
import { nextScale, canScaleUp, canScaleDown } from "./scale.js";
import { spawnSprite, stepSprites, applySeparation, applySchooling } from "../tank/tankModel.js";
import { fishInfo } from "../tank/fishInfo.js";
import { colors } from "../theme/colors.js";
// 렌더 캐싱/애니메이션은 어항과 동일한 공용 모듈을 쓴다(SPEC-RASTER-001 M3, DRY).
import { createSpriteCache, drawFishBitmap } from "../drawing/fishSprite.js";

// 캔버스 드래그 히트테스트에서 물고기로 인정하는 반경(px, 화면 좌표계).
const FISH_HIT_RADIUS = 46;
// 키보드 방향키 한 번에 이동하는 거리(px). 접근성 이동 수단(NFR-A11Y-001).
const NUDGE_STEP = 12;
// jsdom 등 측정 전 기본 어항 크기.
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;

// 방향키 → 이동 델타. 좌표계는 화면과 동일(아래로 갈수록 y 증가).
const KEY_DELTA = {
  ArrowUp: { dx: 0, dy: -NUDGE_STEP },
  ArrowDown: { dx: 0, dy: NUDGE_STEP },
  ArrowLeft: { dx: -NUDGE_STEP, dy: 0 },
  ArrowRight: { dx: NUDGE_STEP, dy: 0 },
};

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

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * "내 어항"(개인 전용) 화면. 본인만 보고 본인만 추가한다. 그린 물고기는 여기에만 담기며
 * 공유 어항에는 절대 나타나지 않는다(오직 /api/my-tank 스코프). 물고기는 어항처럼 헤엄치고
 * (tankModel 재사용), 장식은 놓은 자리에 고정된다. 드래그로 위치를 옮기며(드롭 시 PATCH),
 * 캔버스는 포인터 전용이라 목록/버튼 + 방향키 이동을 접근성 대체 수단으로 제공한다(NFR-A11Y-001).
 * @param {object} props
 * @param {string} props.token - 인증 토큰(본인 어항 조회/편집용)
 * @param {(p:{token:string})=>Promise<{fish:object[],decor:object[]}>} [props.loadMyTank]
 * @param {Function} [props.moveFish] @param {Function} [props.deleteFish]
 * @param {Function} [props.createDecor] @param {Function} [props.moveDecor] @param {Function} [props.deleteDecor]
 *   모두 테스트 주입용 API 클라이언트(기본은 myTankApi).
 */
export default function MyTank({
  token,
  loadMyTank = defaultFetchMyTank,
  moveFish = defaultMoveFish,
  deleteFish = defaultDeleteFish,
  createDecor = defaultCreateDecor,
  moveDecor = defaultMoveDecor,
  deleteDecor = defaultDeleteDecor,
}) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [fish, setFish] = useState([]);
  const [decor, setDecor] = useState([]);
  const [selected, setSelected] = useState(null); // { type:'fish'|'decor', id } | null
  const [editing, setEditing] = useState(false); // 편집 모드(꺼짐=감상 전용). 기본은 꺼짐이라 편집 UI가 숨는다.
  const [message, setMessage] = useState("");
  const [announceCount, setAnnounceCount] = useState(0);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const [dark, setDark] = useState(false); // OS 다크 모드 여부(공유 어항과 동일 배경 전환)

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const spritesRef = useRef(new Map()); // id → 헤엄치는 스프라이트(프레임 간 유지)
  const spriteCacheRef = useRef(createSpriteCache()); // id → 오프스크린 비트맵 캐시(어항과 동일, REQ-RENDER-003)
  const decorRef = useRef([]); // rAF 루프가 최신 장식을 리렌더 없이 읽도록 미러링
  const boundsRef = useRef({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const draggingRef = useRef(null); // { type, id } 드래그 중인 항목

  decorRef.current = decor;

  // 동일 문구여도 콘텐츠 키를 올려 라이브 영역이 재낭독되게 한다(NFR-A11Y-001).
  const announce = useCallback((msg) => {
    setMessage(msg);
    setAnnounceCount((n) => n + 1);
  }, []);

  // OS 다크 모드에 따라 배경 이미지를 전환한다(공유 어항 FishTank 와 동일 방식). jsdom 등 미지원 시 라이트 유지.
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

  // 진입 시 본인 어항(물고기+장식)을 로드한다. 호출자 스코프만 응답된다.
  useEffect(() => {
    let active = true;
    setStatus("loading");
    loadMyTank({ token })
      .then((data) => {
        if (!active) return;
        setFish(Array.isArray(data?.fish) ? data.fish : []);
        setDecor(Array.isArray(data?.decor) ? data.decor : []);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [loadMyTank, token]);

  // 컨테이너 크기에 맞춰 헤엄 범위/캔버스 크기를 가변 조정한다(미지원 환경은 기본값 유지).
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

  // 물고기 목록이 바뀌면 스프라이트 맵을 조정한다: 새 물고기는 저장된 (x,y)에서 스폰하고,
  // 사라진 물고기의 스프라이트는 정리한다(어항 렌더러와 동일한 패턴).
  useEffect(() => {
    const map = spritesRef.current;
    const ids = new Set(fish.map((f) => f.id));
    for (const f of fish) {
      if (!map.has(f.id)) {
        const s = spawnSprite(f, boundsRef.current);
        // 해시 기반 초기 좌표 대신 사용자가 배치한 위치에서 헤엄을 시작한다.
        s.x = typeof f.x === "number" ? f.x : s.x;
        s.y = typeof f.y === "number" ? f.y : s.y;
        // 저장된 크기를 스프라이트에 실어 렌더러가 축소 비율에 곱하게 한다(기본 1.0).
        s.scale = typeof f.scale === "number" ? f.scale : 1;
        map.set(f.id, s);
      }
    }
    for (const id of map.keys()) {
      if (!ids.has(id)) map.delete(id);
    }
    // 사라진 물고기의 비트맵 캐시를 축출한다(REQ-RENDER-002).
    spriteCacheRef.current.prune(ids);
  }, [fish]);

  // 헤엄 애니메이션 루프(어항과 동일 방식 재사용). rAF/2D 미지원 환경(jsdom)에서는 조용히 건너뛴다.
  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return undefined;
    let raf = null;
    let last = null;
    const frame = (now) => {
      const dt = last == null ? 16 : now - last;
      last = now;
      const bounds = boundsRef.current;
      const map = spritesRef.current;
      // 드래그 중인 물고기는 물리 갱신에서 제외하고 손끝 위치에 고정한다.
      const dragId =
        draggingRef.current?.type === "fish" ? draggingRef.current.id : null;
      const moving = [...map.values()].filter((s) => s.id !== dragId);
      const flocked = applySeparation(applySchooling(moving, dt), dt);
      const stepped = stepSprites(flocked, dt, bounds);
      for (const s of stepped) map.set(s.id, s);
      drawMyTank(canvasRef.current, [...map.values()], decorRef.current, bounds, now, spriteCacheRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, []);

  // 위치 이동(로컬 즉시 반영). persist=true 면 서버에도 저장한다(PATCH). 항상 어항 경계 안으로 클램프.
  const applyMove = useCallback(
    (type, id, x, y, persist) => {
      const b = boundsRef.current;
      const nx = clamp(x, 0, b.width);
      const ny = clamp(y, 0, b.height);
      if (type === "fish") {
        setFish((prev) => prev.map((f) => (f.id === id ? { ...f, x: nx, y: ny } : f)));
        const s = spritesRef.current.get(id);
        if (s) spritesRef.current.set(id, { ...s, x: nx, y: ny });
        if (persist) moveFish({ token, id, x: nx, y: ny }).catch(() => {});
      } else {
        setDecor((prev) => prev.map((d) => (d.id === id ? { ...d, x: nx, y: ny } : d)));
        if (persist) moveDecor({ token, id, x: nx, y: ny }).catch(() => {});
      }
    },
    [token, moveFish, moveDecor],
  );

  // 방향키로 선택 항목을 미세 이동하고 새 위치를 저장한다(접근성 이동 경로, NFR-A11Y-001).
  const handleItemKeyDown = useCallback(
    (e, type, item) => {
      if (!editing) return; // 편집 모드에서만 방향키 이동을 허용(목록은 편집 시에만 보이지만 일관성 유지).
      const delta = KEY_DELTA[e.key];
      if (!delta) return;
      e.preventDefault();
      applyMove(type, item.id, item.x + delta.dx, item.y + delta.dy, true);
      announce(`${labelFor(type, item)}을(를) 옮겼어요.`);
    },
    [editing, applyMove, announce],
  );

  // 장식 추가: 기본 위치에 POST 하고, 서버가 준 장식을 목록에 더한 뒤 선택 상태로 만든다.
  const handleAddDecor = useCallback(
    (kind) => {
      const { x, y } = DEFAULT_DECOR_POS;
      createDecor({ token, kind, x, y })
        .then((created) => {
          if (!created) return;
          setDecor((prev) => [...prev, created]);
          setSelected({ type: "decor", id: created.id });
          announce(`${decorLabel(kind)}을(를) 넣었어요. 방향키나 드래그로 옮겨보세요.`);
        })
        .catch(() => announce("장식을 넣지 못했어요. 잠시 후 다시 시도해 주세요."));
    },
    [createDecor, token, announce],
  );

  // 선택 항목 삭제(로컬 즉시 제거 + DELETE). 실패해도 개인 어항이라 다음 로드에서 정정된다.
  const handleDelete = useCallback(
    (type, id) => {
      if (type === "fish") {
        setFish((prev) => prev.filter((f) => f.id !== id));
        spritesRef.current.delete(id);
        deleteFish({ token, id }).catch(() => {});
      } else {
        setDecor((prev) => prev.filter((d) => d.id !== id));
        deleteDecor({ token, id }).catch(() => {});
      }
      setSelected((s) => (s && s.id === id ? null : s));
      announce("삭제했어요.");
    },
    [deleteFish, deleteDecor, token, announce],
  );

  // 선택 항목 크기 조절(direction>0 크게 / <0 작게). 로컬 즉시 반영 후 현재 x,y + 새 scale 로 PATCH.
  // 경계에서 변화가 없으면 아무 것도 하지 않는다(버튼도 비활성화되지만 방어).
  const handleScale = useCallback(
    (type, item, direction) => {
      const current = typeof item.scale === "number" ? item.scale : 1;
      const scale = nextScale(current, direction);
      if (scale === current) return;
      if (type === "fish") {
        setFish((prev) => prev.map((f) => (f.id === item.id ? { ...f, scale } : f)));
        const s = spritesRef.current.get(item.id);
        if (s) spritesRef.current.set(item.id, { ...s, scale });
        moveFish({ token, id: item.id, x: item.x, y: item.y, scale }).catch(() => {});
      } else {
        setDecor((prev) => prev.map((d) => (d.id === item.id ? { ...d, scale } : d)));
        moveDecor({ token, id: item.id, x: item.x, y: item.y, scale }).catch(() => {});
      }
      announce(direction > 0 ? "크게 했어요." : "작게 했어요.");
    },
    [token, moveFish, moveDecor, announce],
  );

  // 캔버스 클릭 좌표 → 어항 내부 좌표(CSS 100% 늘림 보정).
  const toTankCoords = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = rect.width ? boundsRef.current.width / rect.width : 1;
    const scaleY = rect.height ? boundsRef.current.height / rect.height : 1;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  // 드래그 시작: 클릭 지점 근처의 장식(위) → 물고기 순으로 히트테스트해 하나를 잡는다.
  // 편집 모드가 꺼져 있으면(감상 전용) 배치 변경을 막는다 — 항목을 잡지도 선택하지도 않는다.
  const handlePointerDown = useCallback(
    (e) => {
      if (!editing) return;
      const { x, y } = toTankCoords(e);
      const hit = hitTest(x, y, decorRef.current, spritesRef.current);
      if (!hit) return;
      draggingRef.current = hit;
      setSelected(hit);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [editing, toTankCoords],
  );

  // 드래그 중: 잡은 항목을 손끝 위치로 로컬 이동(서버 저장은 드롭 시 한 번).
  const handlePointerMove = useCallback(
    (e) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const { x, y } = toTankCoords(e);
      applyMove(drag.type, drag.id, x, y, false);
    },
    [toTankCoords, applyMove],
  );

  // 드롭: 최종 위치를 서버에 저장(PATCH)한다.
  const handlePointerUp = useCallback(
    (e) => {
      const drag = draggingRef.current;
      if (!drag) return;
      draggingRef.current = null;
      const { x, y } = toTankCoords(e);
      applyMove(drag.type, drag.id, x, y, true);
      announce("옮긴 자리에 두었어요.");
    },
    [toTankCoords, applyMove, announce],
  );

  // 편집 모드 토글. 켜면 편집 UI(장식 팔레트·배치 목록)가 나타나고, 끄면 감상 전용으로 돌아간다.
  // 끌 때는 선택도 해제해 다시 켰을 때 깔끔한 상태로 시작하게 한다.
  const toggleEditing = useCallback(() => {
    setEditing((prev) => {
      const next = !prev;
      if (!next) setSelected(null);
      announce(next ? "편집 모드를 켰어요." : "편집 모드를 껐어요.");
      return next;
    });
  }, [announce]);

  const isEmpty = status === "ready" && fish.length === 0 && decor.length === 0;
  // public/ 에서 서빙되는 배경 SVG(공유 어항과 동일 자산). 캔버스는 투명이라 위에 물고기/장식이 얹힌다.
  const bgUrl = dark ? "/tank-bg-dark.svg" : "/tank-bg-light.svg";

  return (
    <section
      ref={containerRef}
      aria-label="내 어항"
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <h2 style={srOnly}>내 어항</h2>

      {/* 물고기가 헤엄치고 장식이 놓이는 캔버스. 포인터 드래그로 위치를 옮긴다(선택적 향상). */}
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        aria-label="내 어항 캔버스"
        role="img"
        aria-describedby="my-tank-desc"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          touchAction: "none",
        }}
      />
      {/* 캔버스는 포인터 전용이므로 아래 목록/버튼 + 방향키 이동이 접근성 대체 수단이다(NFR-A11Y-001). */}
      <p id="my-tank-desc" style={srOnly}>
        나만 보는 개인 어항입니다. 기본은 감상 전용이고, 꾸미기 버튼으로 편집 모드를 켜면 꾸밀 수 있어요.
        편집 모드에서는 장식 버튼으로 수초·바위·성을 놓고, 목록에서 항목을 선택한 뒤 방향키로 위치를 옮기거나
        삭제 버튼으로 지울 수 있어요.
      </p>

      {status === "loading" && (
        <p role="status" style={overlayTextStyle}>
          내 어항을 불러오는 중이에요…
        </p>
      )}
      {status === "error" && (
        <p role="alert" style={{ ...overlayTextStyle, color: colors.danger }}>
          내 어항을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}
      {isEmpty && (
        <p role="status" style={overlayTextStyle}>
          아직 비어 있어요 — 물고기를 그려 넣어보세요.
        </p>
      )}

      {/* 상단 중앙: 장식 팔레트. 편집 모드에서만 노출. 각 종류를 실제 버튼으로 노출해 키보드로 조작 가능(NFR-A11Y-001). */}
      {status === "ready" && editing && (
        <div
          role="group"
          aria-label="장식 추가"
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 6,
            display: "flex",
            gap: 8,
            background: "rgba(255,255,255,0.92)",
            borderRadius: 999,
            padding: "6px 10px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
          }}
        >
          {DECOR_KINDS.map((d) => (
            <button
              key={d.kind}
              type="button"
              onClick={() => handleAddDecor(d.kind)}
              style={{
                border: "none",
                borderRadius: 999,
                padding: "8px 14px",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                background: colors.primary,
                color: colors.onPrimary,
              }}
            >
              {d.label} 넣기
            </button>
          ))}
        </div>
      )}

      {/* 하단 우측: 배치 목록(편집 모드 전용, 접근성 대체 수단). 항목 선택 → 방향키 이동 / 삭제. */}
      {/* 편집 토글 버튼 위에 얹히도록 bottom 을 올려 버튼과 겹치지 않게 한다. */}
      {status === "ready" && editing && (fish.length > 0 || decor.length > 0) && (
        <div
          style={{
            position: "absolute",
            right: 16,
            bottom: 64,
            zIndex: 6,
            width: "min(320px, 82vw)",
            maxHeight: "56vh",
            overflowY: "auto",
            background: "rgba(255,255,255,0.97)",
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: "12px 14px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            fontSize: 14,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
            물고기 {fish.length}마리 · 장식 {decor.length}개
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 12.5, color: colors.muted }}>
            항목을 선택한 뒤 방향키로 옮기세요.
          </p>
          <ul aria-label="내 어항 배치 목록" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {fish.map((f) => (
              <ItemRow
                key={`fish-${f.id}`}
                type="fish"
                item={f}
                label={`${fishInfo(f).label}의 물고기`}
                selected={selected?.type === "fish" && selected.id === f.id}
                onSelect={() => setSelected({ type: "fish", id: f.id })}
                onKeyDown={(e) => handleItemKeyDown(e, "fish", f)}
                onDelete={() => handleDelete("fish", f.id)}
                onScaleUp={() => handleScale("fish", f, 1)}
                onScaleDown={() => handleScale("fish", f, -1)}
              />
            ))}
            {decor.map((d) => (
              <ItemRow
                key={`decor-${d.id}`}
                type="decor"
                item={d}
                label={decorLabel(d.kind)}
                selected={selected?.type === "decor" && selected.id === d.id}
                onSelect={() => setSelected({ type: "decor", id: d.id })}
                onKeyDown={(e) => handleItemKeyDown(e, "decor", d)}
                onDelete={() => handleDelete("decor", d.id)}
                onScaleUp={() => handleScale("decor", d, 1)}
                onScaleDown={() => handleScale("decor", d, -1)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* 하단 우측 고정: 편집 모드 토글. 항상 보이며(감상 중에도) aria-pressed 로 상태를 드러낸다. */}
      {/* 배치 목록은 이 버튼 위(bottom:64)에 얹혀 겹치지 않는다. */}
      {status === "ready" && (
        <button
          type="button"
          aria-pressed={editing}
          onClick={toggleEditing}
          style={{
            position: "absolute",
            right: 16,
            bottom: 20,
            zIndex: 7,
            border: "none",
            borderRadius: 999,
            padding: "10px 18px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            background: editing ? colors.text : colors.primary,
            color: colors.onPrimary,
            boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
          }}
        >
          {editing ? "편집 끝" : "꾸미기"}
        </button>
      )}

      {/* 안내 라이브 영역. key 로 재마운트해 동일 문구도 재낭독한다(NFR-A11Y-001). */}
      {message && (
        <p
          key={announceCount}
          role="status"
          aria-label="내 어항 안내"
          aria-live="polite"
          data-announce-count={announceCount}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 20,
            transform: "translateX(-50%)",
            margin: 0,
            zIndex: 6,
            fontSize: 13,
            color: colors.text,
            background: "rgba(255,255,255,0.9)",
            borderRadius: 999,
            padding: "6px 14px",
            maxWidth: "70vw",
          }}
        >
          {message}
        </p>
      )}
    </section>
  );
}

const overlayTextStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 6,
  margin: 0,
  fontSize: 15,
  color: colors.text,
  textAlign: "center",
  padding: "0 24px",
};

// 목록 항목 한 줄: 선택 버튼(방향키 이동) + 크게/작게(선택 시) + 삭제 버튼.
// 모두 실제 <button> 이라 키보드 조작 가능(NFR-A11Y-001). 크기 버튼은 선택된 항목에만 노출하고
// 최대/최소에서 비활성화한다. label 을 접근성 이름에 넣어 어떤 항목의 조작인지 스크린리더가 안다.
function ItemRow({ type, item, label, selected, onSelect, onKeyDown, onDelete, onScaleUp, onScaleDown }) {
  return (
    <li
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "6px 0",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        style={{
          flex: 1,
          textAlign: "left",
          background: selected ? "rgba(29,78,216,0.10)" : "transparent",
          color: colors.text,
          border: "none",
          borderRadius: 8,
          padding: "6px 8px",
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        {type === "decor" ? "장식 · " : ""}
        {label}
      </button>
      {selected && (
        <>
          <button
            type="button"
            aria-label={`${label} 크게`}
            onClick={onScaleUp}
            disabled={!canScaleUp(item.scale)}
            style={resizeButtonStyle}
          >
            크게 (+)
          </button>
          <button
            type="button"
            aria-label={`${label} 작게`}
            onClick={onScaleDown}
            disabled={!canScaleDown(item.scale)}
            style={resizeButtonStyle}
          >
            작게 (−)
          </button>
        </>
      )}
      <button
        type="button"
        aria-label={`${label} 삭제`}
        onClick={onDelete}
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
    </li>
  );
}

// 크기 조절 버튼 공통 스타일. disabled 상태는 브라우저 기본 흐림 + 커서로 구분된다.
const resizeButtonStyle = {
  background: "rgba(29,78,216,0.10)",
  color: colors.primary,
  border: `1px solid ${colors.primary}`,
  borderRadius: 8,
  padding: "4px 8px",
  fontSize: 13,
  cursor: "pointer",
  flexShrink: 0,
};

// 이동 안내 문구용 라벨.
function labelFor(type, item) {
  if (type === "decor") return decorLabel(item.kind);
  return `${fishInfo(item).label}의 물고기`;
}

// 클릭 지점에서 가장 가까운 항목을 찾는다: 장식(뒤에 그린 것 우선) → 물고기 순.
function hitTest(x, y, decorList, spriteMap) {
  for (let i = decorList.length - 1; i >= 0; i -= 1) {
    const d = decorList[i];
    if (Math.hypot(d.x - x, d.y - y) <= decorHitRadius(d.kind)) {
      return { type: "decor", id: d.id };
    }
  }
  const sprites = [...spriteMap.values()];
  for (let i = sprites.length - 1; i >= 0; i -= 1) {
    const s = sprites[i];
    if (Math.hypot(s.x - x, s.y - y) <= FISH_HIT_RADIUS) {
      return { type: "fish", id: s.id };
    }
  }
  return null;
}

// 캔버스에 장식(정적) → 물고기(헤엄)를 순서대로 그린다. 2D 미지원(jsdom)이면 무시.
function drawMyTank(canvas, sprites, decorList, bounds, now, cache = null) {
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return;
  ctx.clearRect(0, 0, bounds.width, bounds.height);
  for (const item of decorList) drawDecor(ctx, item);
  for (const s of sprites) drawFish(ctx, s, now, cache);
}

// 물고기를 스프라이트 위치에 방향·축소(+개별 scale)·꼬리 파닥임을 적용해 그린다(어항과 동일 공용 blit).
// 벡터/래스터 모두 오프스크린 캐시 비트맵을 blit 한다. 저장된 개별 크기(scale)를 배수로 넘긴다.
function drawFish(ctx, sprite, now, cache) {
  if (!cache) return;
  const entry = cache.getEntry(sprite);
  if (!entry) return;
  const itemScale = typeof sprite.scale === "number" ? sprite.scale : 1;
  drawFishBitmap(ctx, entry, sprite, now, itemScale);
}
