import { useState, useCallback } from "react";
import DrawingCanvas from "../drawing/DrawingCanvas.jsx";
import { validateDrawing } from "../drawing/drawingModel.js";
import { canWrite } from "../auth/authMachine.js";
import { submitFish as defaultSubmitFish } from "./fishApi.js";

// 검증 실패 사유를 한국어 안내 문구로 변환한다(REQ-DRAW-004 안내).
const REASON_MESSAGE = {
  empty: "그림이 비어 있습니다. 물고기를 그려 주세요.",
  too_small: "그림이 너무 작습니다. 조금 더 크게 그려 주세요.",
  too_large: "그림이 너무 큽니다. 획을 줄여 주세요.",
  invalid_format: "그림 형식이 올바르지 않습니다.",
};

function messageForReason(reason) {
  return REASON_MESSAGE[reason] ?? "물고기를 등록할 수 없습니다.";
}

// 그리기 색상 팔레트(디자인 시안 10색). 이름은 스크린리더 안내용.
const PALETTE = [
  { value: "#2b2018", name: "검정" },
  { value: "#c0392b", name: "빨강" },
  { value: "#e67e22", name: "주황" },
  { value: "#e3b722", name: "노랑" },
  { value: "#7dc383", name: "초록" },
  { value: "#2b9aa8", name: "청록" },
  { value: "#3358b5", name: "파랑" },
  { value: "#8e3a80", name: "자주" },
  { value: "#e05fa9", name: "분홍" },
  { value: "#ffffff", name: "흰색" },
];

// 주요 액션 청록색. 흰 글자 기준 대비 약 4.9:1 로 WCAG AA 를 만족한다(NFR-A11Y-001).
const TEAL = "#0e7c8c";
const TEAL_SOFT = "#e3f2f4";

// 스크린리더 전용(시각적으로 숨김) 스타일 — 세그먼트 토글의 실제 라디오 입력용.
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

const fieldLabelStyle = {
  margin: "18px 0 8px",
  fontSize: 14,
  fontWeight: 600,
  color: "#1f2933",
};

/**
 * 물고기 등록 UI. 자유 드로잉 + 색상/브러쉬 선택 + 이름/익명 선택 + 사전 검증 +
 * 인증 게이트 제출.
 * @param {{authState:object, token:string|null,
 *          submitFish?:typeof defaultSubmitFish,
 *          onSuccess?:()=>void}} props - onSuccess 는 등록 성공 직후 호출된다(모달 닫기).
 */
export default function FishComposer({
  authState,
  token,
  submitFish = defaultSubmitFish,
  onSuccess,
}) {
  const [drawing, setDrawing] = useState(null);
  // 래스터 캔버스는 빈 상태(전부 투명)도 유효한 PNG 라 validateDrawing 으로는 감지되지 않는다.
  // DrawingCanvas 가 비어있음을 별도로 알려주면 제출을 막는다(빈 물고기 방지).
  const [canvasEmpty, setCanvasEmpty] = useState(true);
  const [displayMode, setDisplayMode] = useState("named");
  const [message, setMessage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [color, setColor] = useState(PALETTE[0].value);
  const [brushWidth, setBrushWidth] = useState(8);

  const writeEnabled = canWrite(authState);
  // 현재 색이 기본 팔레트에 없으면 "직접 선택" 중으로 본다(스와치 강조 표시용).
  const customColor = !PALETTE.some((c) => c.value === color);
  const handleChange = useCallback((d) => setDrawing(d), []);

  async function handleSubmit() {
    setMessage(null);

    // 빈 캔버스(전부 투명)는 제출을 막는다 — 래스터 PNG 는 비어 있어도 형식상 유효하므로
    // validateDrawing 이전에 별도 게이트로 확인한다.
    if (canvasEmpty) {
      setMessage(messageForReason("empty"));
      return;
    }

    // 클라이언트 사전 검증(서버가 최종 권한, NFR-SEC-003).
    const { valid, reason } = validateDrawing(drawing ?? {});
    if (!valid) {
      setMessage(messageForReason(reason));
      return;
    }

    setSubmitting(true);
    try {
      await submitFish({ token, drawing, displayMode });
      setMessage("물고기를 어항에 풀어놓았어요!");
      onSuccess?.(); // 성공하면 모달을 닫는다(어항에서 바로 확인).
    } catch (err) {
      setMessage(messageForReason(err.reason));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      {/* 헤더: 펜 아이콘 + 제목 + 부제 */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 16 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 12,
            background: TEAL_SOFT,
            color: TEAL,
            fontSize: 20,
            flexShrink: 0,
          }}
        >
          ✒
        </span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#1f2933" }}>물고기 그리기</h2>
          <p style={{ margin: "3px 0 0", fontSize: 13.5, color: "#5b6672" }}>
            나만의 물고기를 그려 어항에 풀어보세요
          </p>
        </div>
      </div>

      <DrawingCanvas
        width={460}
        height={280}
        color={color}
        strokeWidth={brushWidth}
        onChange={handleChange}
        onEmptyChange={setCanvasEmpty}
      >
        {/* 색상: 기본 팔레트 + 직접 선택(자유 RGB 피커) */}
        <p style={fieldLabelStyle}>색상</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div
            role="radiogroup"
            aria-label="색상"
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
            {PALETTE.map((c) => {
              const selected = color === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={c.name}
                  onClick={() => setColor(c.value)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: c.value,
                    cursor: "pointer",
                    border:
                      c.value === "#ffffff" ? "1.5px solid #dbe3e8" : "1.5px solid transparent",
                    outline: selected ? `2.5px solid ${TEAL}` : "none",
                    outlineOffset: 2,
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
          {/* 직접 선택: 네모난 RGB 색상 피커(OS 기본). 팔레트에 없는 색도 자유롭게 고른다.
              팔레트에 없는 색을 고르면 무지개 테두리로 "직접 선택 중"임을 표시한다. */}
          <label
            title="색상 직접 선택"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: "50%",
              cursor: "pointer",
              overflow: "hidden",
              padding: 0,
              // 자유 선택 중이면 그 색을, 기본이면 무지개(자유 선택 유도)를 스와치에 보인다.
              background: customColor
                ? color
                : "conic-gradient(red, orange, yellow, lime, aqua, blue, magenta, red)",
              border: "1.5px solid #dbe3e8",
              outline: customColor ? `2.5px solid ${TEAL}` : "none",
              outlineOffset: 2,
            }}
          >
            <span style={srOnly}>색상 직접 선택</span>
            <input
              type="color"
              aria-label="색상 직접 선택"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{
                width: 46,
                height: 46,
                border: "none",
                padding: 0,
                background: "transparent",
                cursor: "pointer",
                opacity: 0,
              }}
            />
          </label>
        </div>

        {/* 브러쉬 굵기 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            margin: "18px 0 8px",
          }}
        >
          <label htmlFor="brush-width" style={{ ...fieldLabelStyle, margin: 0 }}>
            브러쉬 굵기
          </label>
          <span
            style={{
              background: TEAL_SOFT,
              color: TEAL,
              borderRadius: 999,
              padding: "3px 10px",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            {brushWidth} px
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* 현재 색·굵기 미리보기 점 */}
          <span
            aria-hidden="true"
            style={{
              width: Math.max(4, brushWidth),
              height: Math.max(4, brushWidth),
              borderRadius: "50%",
              background: color,
              border: color === "#ffffff" ? "1px solid #dbe3e8" : "none",
              flexShrink: 0,
            }}
          />
          <input
            id="brush-width"
            type="range"
            min={2}
            max={24}
            step={1}
            value={brushWidth}
            onChange={(e) => setBrushWidth(Number(e.target.value))}
            style={{ flex: 1, accentColor: TEAL }}
          />
        </div>
      </DrawingCanvas>

      {/* 등록 방식: 세그먼트 토글(내부는 라디오 입력, 키보드/스크린리더 접근 유지) */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 18 }}>
        <span style={{ ...fieldLabelStyle, margin: 0 }}>등록 방식</span>
        <div
          role="radiogroup"
          aria-label="등록 방식"
          style={{
            display: "inline-flex",
            background: "#eef2f4",
            borderRadius: 12,
            padding: 3,
            gap: 2,
          }}
        >
          {[
            { value: "named", label: "이름 표시" },
            { value: "anonymous", label: "익명" },
          ].map((opt) => {
            const selected = displayMode === opt.value;
            return (
              <label
                key={opt.value}
                style={{
                  borderRadius: 10,
                  padding: "7px 16px",
                  fontSize: 13.5,
                  fontWeight: selected ? 600 : 400,
                  color: selected ? TEAL : "#5b6672",
                  background: selected ? "#fff" : "transparent",
                  boxShadow: selected ? "0 1px 4px rgba(0,0,0,0.12)" : "none",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="displayMode"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setDisplayMode(opt.value)}
                  style={srOnly}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* 제출 CTA */}
      <button
        type="button"
        disabled={!writeEnabled || submitting}
        onClick={handleSubmit}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          marginTop: 20,
          border: "none",
          borderRadius: 14,
          padding: "14px 0",
          fontSize: 16,
          fontWeight: 700,
          color: "#fff",
          background: !writeEnabled || submitting ? "#9aa3ad" : TEAL,
          cursor: !writeEnabled || submitting ? "not-allowed" : "pointer",
        }}
      >
        <span aria-hidden="true">🐟</span>
        어항에 풀어놓기
      </button>

      {message && (
        <p role="alert" style={{ margin: "12px 0 0", fontSize: 14, color: "#1f2933" }}>
          {message}
        </p>
      )}
    </section>
  );
}
