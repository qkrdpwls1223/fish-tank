import { useReducer, useEffect, useRef, useCallback } from "react";
import {
  initialDrawingState,
  drawingReducer,
  toDrawing,
  TAIL_FOLD_FRACTION,
} from "./drawingModel.js";

// 포인터 이벤트에서 캔버스 상대 좌표를 계산한다(마우스/터치/펜 공통, REQ-DRAW-001).
function pointFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/**
 * 자유 드로잉 캔버스. 포인터로 손그림을 그리고 undo/clear 를 제공한다.
 * @param {{width?:number,height?:number,color?:string,strokeWidth?:number,
 *          onChange?:(drawing:object)=>void}} props
 */
export default function DrawingCanvas({
  width = 300,
  height = 200,
  color = "#000000",
  strokeWidth = 3,
  onChange,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [state, dispatch] = useReducer(
    drawingReducer,
    undefined,
    () => initialDrawingState(width, height),
  );

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

    // 꼬리 접힘 가이드라인(점선). 저장되는 그림(strokes)에는 포함되지 않는 시각 가이드다.
    // 이 선의 왼쪽에 그린 부분이 어항에서 꼬리로 파닥거린다.
    const foldX = Math.round(width * TAIL_FOLD_FRACTION);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "#9aa3ad";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(foldX, 0);
    ctx.lineTo(foldX, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText("← 꼬리", 6, 16);
    ctx.fillText("몸통·머리 →", foldX + 6, 16);
    ctx.restore();
  }, [state, width, height]);

  const handleDown = useCallback(
    (e) => {
      drawingRef.current = true;
      const { x, y } = pointFromEvent(e, canvasRef.current);
      dispatch({ type: "BEGIN_STROKE", x, y, color, width: strokeWidth });
    },
    [color, strokeWidth],
  );

  const handleMove = useCallback((e) => {
    if (!drawingRef.current) return;
    const { x, y } = pointFromEvent(e, canvasRef.current);
    dispatch({ type: "ADD_POINT", x, y });
  }, []);

  const handleUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    dispatch({ type: "END_STROKE" });
  }, []);

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-label="물고기 그리기 캔버스"
        role="img"
        aria-describedby="draw-canvas-desc"
        style={{ border: "1px solid #ccc", touchAction: "none" }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
      />
      {/* 대체 안내: 캔버스는 포인터(마우스/터치/펜) 전용이며, 아래 컨트롤은 키보드로 조작 가능하다(NFR-A11Y-001). */}
      <p id="draw-canvas-desc">
        마우스나 터치로 물고기를 자유롭게 그려 주세요. 점선 왼쪽에 그린 부분이
        어항에서 꼬리처럼 파닥거립니다. 아래 실행 취소·초기화 버튼으로 마지막 획을
        되돌리거나 전체를 지울 수 있어요.
      </p>
      <div>
        <button type="button" onClick={() => dispatch({ type: "UNDO" })}>
          실행 취소
        </button>
        <button type="button" onClick={() => dispatch({ type: "CLEAR" })}>
          초기화
        </button>
      </div>
    </div>
  );
}
