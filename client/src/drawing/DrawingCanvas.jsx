import { useReducer, useEffect, useRef, useCallback, useState } from "react";
import {
  initialDrawingState,
  drawingReducer,
  toDrawing,
  TAIL_FOLD_FRACTION,
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

  // 확정 스트로크가 바뀔 때마다 상위에 그림을 알린다(REQ-DRAW-003 캡처 전달).
  useEffect(() => {
    if (onChange) onChange(toDrawing(state));
  }, [state.strokes, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // 꼬리 접힘 가이드라인(연한 점선). 저장되는 그림(strokes)에는 포함되지 않는다.
    // 이 선의 왼쪽에 그린 부분이 어항에서 꼬리로 파닥거린다.
    const foldX = Math.round(width * TAIL_FOLD_FRACTION);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#e3e9ee";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(foldX, 12);
    ctx.lineTo(foldX, height - 12);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#c2ccd4";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("← 꼬리", 10, 18);
    ctx.fillText("몸통·머리 →", foldX + 8, 18);

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
        마우스나 터치로 물고기를 자유롭게 그려 주세요. 점선 왼쪽에 그린 부분이
        어항에서 꼬리처럼 파닥거립니다. 지우개 버튼을 켜면 문지른 부분이 지워지고,
        실행 취소·초기화 버튼으로 마지막 획을 되돌리거나 전체를 지울 수 있어요.
      </p>

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
