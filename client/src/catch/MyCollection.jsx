import { useEffect, useRef, useState } from "react";
import { fetchCatches as defaultFetchCatches } from "./catchApi.js";
import { drawSnapshot } from "./renderSnapshot.js";
import { formatCaughtAt } from "./caughtMeta.js";
import { fishInfo } from "../tank/fishInfo.js";
import { colors } from "../theme/colors.js";

// 수집함 그림 썸네일 크기(px). 캔버스 내부 해상도이며 CSS 로 반응형 축소한다.
const ITEM_W = 240;
const ITEM_H = 160;

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

// 낚은 물고기 한 마리를 스냅샷으로 렌더한다(REQ-COLL-003). 어항 렌더러와 동일한 그림
// 데이터 형태를 정적 렌더러(drawSnapshot)로 그린다. jsdom 은 getContext 가 null 이라 무시된다.
function CaughtFishCanvas({ drawing, label }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    drawSnapshot(canvasRef.current, drawing, { width: ITEM_W, height: ITEM_H });
  }, [drawing]);

  return (
    <canvas
      ref={canvasRef}
      width={ITEM_W}
      height={ITEM_H}
      role="img"
      aria-label={`${label}의 물고기 그림`}
      style={{
        width: "100%",
        height: "auto",
        display: "block",
        background: "#eaf6f7",
        borderRadius: 12,
      }}
    />
  );
}

/**
 * "내 수집함" 화면 (REQ-COLL-002). 공유 어항과 분리된 별도 뷰로, 본인이 낚은 물고기들을
 * 낚은 시점 스냅샷으로 렌더링한다(REQ-COLL-001/003/004). 서버가 최신순으로 정렬해 응답하며
 * (REQ-PRIV-003 본인 스코프), 익명 물고기는 "익명"으로만 표시한다(REQ-PRIV-004).
 * @param {object} props
 * @param {string} props.token - 인증 토큰(본인 수집함 조회용)
 * @param {(params:{token:string})=>Promise<object[]>} [props.loadCatches] - 조회 API(테스트 주입)
 */
export default function MyCollection({ token, loadCatches = defaultFetchCatches }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [catches, setCatches] = useState([]);

  // 수집함 열 때 본인 낚은 목록을 로드한다(REQ-COLL-001). 최신순 정렬은 서버가 보장하므로
  // 응답 순서를 그대로 렌더한다(재정렬하지 않음).
  useEffect(() => {
    let active = true;
    setStatus("loading");
    loadCatches({ token })
      .then((list) => {
        if (!active) return;
        setCatches(Array.isArray(list) ? list : []);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [loadCatches, token]);

  return (
    <section
      aria-label="내 수집함"
      style={{
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        background: "#bfe6e4",
        color: colors.text,
        padding: "72px 20px 32px",
        boxSizing: "border-box",
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: 22, color: colors.text }}>
        내 수집함
      </h2>

      {status === "loading" && (
        <p role="status" style={{ color: colors.text }}>
          수집함을 불러오는 중이에요…
        </p>
      )}

      {status === "error" && (
        <p role="alert" style={{ color: colors.danger }}>
          수집함을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {status === "ready" && catches.length === 0 && (
        // 빈 수집함 안내 (REQ-COLL-005).
        <p role="status" style={{ color: colors.text, fontSize: 15 }}>
          아직 낚은 물고기가 없어요. 어항에서 마음에 드는 물고기를 낚아 보세요!
        </p>
      )}

      {status === "ready" && catches.length > 0 && (
        <>
          <p role="status" style={{ margin: "0 0 12px", color: colors.text }}>
            낚은 물고기 {catches.length}마리를 간직하고 있어요.
          </p>
          <ul
            aria-label="낚은 물고기 목록"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: 16,
              gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            }}
          >
            {catches.map((c) => {
              // 익명 물고기는 "익명"으로만 노출(REQ-PRIV-004). fishInfo 로 신원 노출을 차단한다.
              const label = fishInfo(c).label;
              return (
                <li
                  key={c.id}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 14,
                    padding: 12,
                    boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
                  }}
                >
                  <CaughtFishCanvas drawing={c.drawing} label={label} />
                  <p
                    style={{
                      margin: "10px 0 2px",
                      fontWeight: 600,
                      fontSize: 15,
                      color: colors.text,
                    }}
                  >
                    {label}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: colors.muted }}>
                    <span style={srOnly}>낚은 시각 </span>
                    {formatCaughtAt(c.caughtAt)}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
