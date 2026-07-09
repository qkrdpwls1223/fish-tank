import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import {
  initialDrawingState,
  drawingReducer,
  toDrawing,
  GUIDE_LIMITS,
} from "./drawingModel.js";

// 포인터 이벤트에서 캔버스 내부 좌표를 계산한다(마우스/터치/펜 공통, REQ-DRAW-001).
// 캔버스가 CSS 로 늘어나도(width:100%) 내부 좌표계로 환산해 그림이 어긋나지 않는다.
function pointFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

// 세로 가이드 선 하나를 그린다: 점선 + 하단 라벨(위치 참조용, 조정은 아래 슬라이더로).
// 저장되는 strokes 에는 포함되지 않고, 위치 비율만 그림과 함께 저장된다.
function drawGuide(ctx, x, height, color, label) {
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 14);
  ctx.lineTo(x, height - 14);
  ctx.stroke();
  ctx.setLineDash([]);
  // 하단 라벨.
  ctx.fillStyle = color;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(label, x, height - 2);
  ctx.restore();
}

// 가이드 위치 슬라이더(꼬리/입 공용). 값은 0..1 비율, 표시는 %. 키보드로도 조작 가능하다.
function GuideSlider({ id, label, color, value, onChange }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 4,
        }}
      >
        <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600, color: "#5b6672" }}>
          {label}
        </label>
        <span style={{ fontSize: 12.5, color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={Math.round(GUIDE_LIMITS.min * 100)}
        max={Math.round(GUIDE_LIMITS.max * 100)}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        style={{ width: "100%", accentColor: color }}
      />
    </div>
  );
}

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

const controlButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1.5px solid #dbe3e8",
  background: "#fff",
  color: "#5b6672",
  borderRadius: 12,
  padding: "9px 16px",
  fontSize: 14,
  cursor: "pointer",
};

/**
 * 자유 드로잉 캔버스. 포인터로 손그림을 그리고 undo/clear 를 제공한다.
 * children 은 캔버스와 실행 취소/초기화 버튼 사이에 렌더된다(색상/굵기 컨트롤 슬롯).
 * @param {{width?:number,height?:number,color?:string,strokeWidth?:number,
 *          onChange?:(drawing:object)=>void,children?:import("react").ReactNode}} props
 */
export default function DrawingCanvas({
  width = 300,
  height = 200,
  color = "#000000",
  strokeWidth = 3,
  onChange,
  children,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [eraser, setEraser] = useState(false); // 지우개 모드 토글
  const [state, dispatch] = useReducer(
    drawingReducer,
    undefined,
    () => initialDrawingState(width, height),
  );

  const isEmpty = state.strokes.length === 0 && !state.current;

  // 확정 스트로크나 가이드 위치가 바뀔 때마다 상위에 그림을 알린다(REQ-DRAW-003 캡처 전달).
  // 가이드(꼬리/입) 위치도 그림의 일부이므로 함께 전파해야 제출 시 반영된다.
  useEffect(() => {
    if (onChange) onChange(toDrawing(state));
  }, [state.strokes, state.tailFraction, state.mouthFraction, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  // 캔버스에 스트로크를 렌더링한다. jsdom 등 2D 미지원 환경에서는 안전히 무시한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    const all = state.current ? [...state.strokes, state.current] : state.strokes;
    for (const stroke of all) {
      if (stroke.points.length === 0) continue;
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

    // 꼬리/입 가이드 선(드래그로 위치 조정). 저장되는 strokes 에는 포함되지 않지만,
    // 위치 비율(tailFraction/mouthFraction)은 그림과 함께 저장돼 어항에서 꼬리 파닥임/입
    // 꿀렁임 기준이 된다. 왼쪽=꼬리, 오른쪽=입(머리)이라는 규약은 그대로 유지한다.
    const tailX = Math.round(width * state.tailFraction);
    const mouthX = Math.round(width * state.mouthFraction);
    drawGuide(ctx, tailX, height, "#0e7c8c", "꼬리");
    drawGuide(ctx, mouthX, height, "#e67e22", "입");
    ctx.save();
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("← 꼬리", (tailX + 0) / 2, 18); // 꼬리 영역(선 왼쪽)
    ctx.fillText("몸통", (tailX + mouthX) / 2, 18); // 몸통 영역(두 선 사이)
    ctx.fillText("입/머리 →", (mouthX + width) / 2, 18); // 입 영역(선 오른쪽)
    ctx.restore();

    // 빈 캔버스 플레이스홀더 안내(그리기 시작하면 사라진다).
    if (isEmpty) {
      ctx.fillStyle = "#9aa3ad";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("✎  마우스나 터치로 자유롭게 그려보세요", 16, height - 18);
    }
    ctx.restore();
  }, [state, width, height, isEmpty]);

  // 지우개 반경: 브러쉬 굵기에 비례하되 최소한의 지우기 면적을 보장한다.
  const eraseRadius = Math.max(10, strokeWidth * 1.5);

  const handleDown = useCallback(
    (e) => {
      drawingRef.current = true;
      const { x, y } = pointFromEvent(e, canvasRef.current);
      if (eraser) {
        dispatch({ type: "ERASE_AT", x, y, radius: eraseRadius });
      } else {
        dispatch({ type: "BEGIN_STROKE", x, y, color, width: strokeWidth });
      }
    },
    [color, strokeWidth, eraser, eraseRadius],
  );

  const handleMove = useCallback(
    (e) => {
      if (!drawingRef.current) return;
      const { x, y } = pointFromEvent(e, canvasRef.current);
      if (eraser) {
        dispatch({ type: "ERASE_AT", x, y, radius: eraseRadius });
      } else {
        dispatch({ type: "ADD_POINT", x, y });
      }
    },
    [eraser, eraseRadius],
  );

  const handleUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (!eraser) dispatch({ type: "END_STROKE" });
  }, [eraser]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-label="물고기 그리기 캔버스"
        role="img"
        aria-describedby="draw-canvas-desc"
        style={{
          display: "block",
          width: "100%",
          border: "1.5px solid #dbe3e8",
          borderRadius: 14,
          background: "#fff",
          touchAction: "none",
          cursor: "crosshair",
        }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
      {/* 대체 안내: 캔버스는 포인터(마우스/터치/펜) 전용이며, 아래 컨트롤은 키보드로 조작 가능하다(NFR-A11Y-001). */}
      <p id="draw-canvas-desc" style={srOnly}>
        마우스나 터치로 물고기를 자유롭게 그려 주세요. 캔버스의 세로 점선은 꼬리(왼쪽)와
        입(오른쪽) 위치를 나타냅니다. 왼쪽 선의 왼쪽에 그린 부분은 어항에서 꼬리처럼
        파닥이고, 오른쪽 선의 오른쪽은 먹이를 먹을 때 입처럼 벌렁거립니다. 아래 꼬리 위치·입
        위치 슬라이더로 두 선의 위치를 조정할 수 있어요. 지우개 버튼을 켜면 문지른 부분이
        지워지고, 실행 취소·초기화 버튼으로 마지막 획을 되돌리거나 전체를 지울 수 있어요.
      </p>

      {/* 꼬리/입 위치 조정(캔버스 아래 슬라이더). 캔버스에서 직접 드래그하면 그림과 겹치므로
          조정은 여기서 한다. 값은 그림 너비 대비 비율(%)이며 리듀서가 순서·범위를 보정한다. */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <GuideSlider
          id="tail-guide"
          label="꼬리 위치"
          color="#0e7c8c"
          value={state.tailFraction}
          onChange={(fraction) => dispatch({ type: "SET_TAIL_FRACTION", fraction })}
        />
        <GuideSlider
          id="mouth-guide"
          label="입 위치"
          color="#e67e22"
          value={state.mouthFraction}
          onChange={(fraction) => dispatch({ type: "SET_MOUTH_FRACTION", fraction })}
        />
      </div>

      {/* 색상/브러쉬 등 상위 컨트롤 슬롯(디자인 순서: 캔버스 → 컨트롤 → 실행취소/초기화). */}
      {children}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          type="button"
          aria-pressed={eraser}
          onClick={() => setEraser((on) => !on)}
          style={{
            ...controlButtonStyle,
            borderColor: eraser ? "#0e7c8c" : "#dbe3e8",
            color: eraser ? "#0e7c8c" : "#5b6672",
            background: eraser ? "#e3f2f4" : "#fff",
          }}
        >
          <span aria-hidden="true">◪</span>
          지우개
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "UNDO" })}
          style={{
            ...controlButtonStyle,
            // 되돌릴 획이 없으면 흐리게(접근성 위해 비활성화 대신 시각적 표시만).
            color: state.strokes.length === 0 ? "#b6bfc7" : "#5b6672",
          }}
        >
          <span aria-hidden="true">↶</span>
          실행 취소
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "CLEAR" })}
          style={controlButtonStyle}
        >
          <span aria-hidden="true">🗑</span>
          초기화
        </button>
      </div>
    </div>
  );
}
