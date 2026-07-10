import { useEffect, useRef, useCallback, useState } from "react";
import {
  GUIDE_LIMITS,
  TAIL_FOLD_FRACTION,
  MOUTH_FRACTION,
  RASTER_LIMITS,
  floodFill,
  hexToRgba,
  isBlankImageData,
  buildRasterDrawing,
} from "./drawingModel.js";

// 실행 취소(undo) 스택 상한 — 메모리 폭주를 막기 위해 ImageData 스냅샷 수를 제한한다.
const UNDO_CAP = 20;
// 플러드필 색 허용 오차(채널 합 거리). 안티에일리어싱 경계를 자연스럽게 흡수한다(REQ-FILL-002).
const FILL_TOLERANCE = 96;
// 업로드 허용 이미지 MIME (REQ-UPLOAD-002). 정지 이미지만 — GIF/SVG/동영상 제외.
const ALLOWED_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"];
// 2D 컨텍스트가 없는 환경(jsdom 등)에서 toDataURL 이 불가능할 때 쓰는, 형식상 유효한
// 1x1 투명 PNG data URL. 실제 브라우저에서는 절대 쓰이지 않는다(프로덕션 fallback 아님).
const FALLBACK_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// 포인터 이벤트에서 캔버스 내부 좌표를 계산한다(마우스/터치/펜 공통).
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

// 업로드 이미지를 캔버스 규격에 "contain"(비율 유지, 넘치지 않게)으로 맞춘 배치 사각형.
function containFit(srcW, srcH, dstW, dstH) {
  if (srcW <= 0 || srcH <= 0) return { dx: 0, dy: 0, dw: dstW, dh: dstH };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}

// 세로 가이드 선 하나를 오버레이에 그린다: 점선 + 하단 라벨(위치 참조용, 조정은 슬라이더로).
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

// 토글 버튼(지우개/페인트통)의 눌림 상태 스타일.
function toolButtonStyle(active) {
  return {
    ...controlButtonStyle,
    borderColor: active ? "#0e7c8c" : "#dbe3e8",
    color: active ? "#0e7c8c" : "#5b6672",
    background: active ? "#e3f2f4" : "#fff",
  };
}

/**
 * 래스터 페인트 캔버스. 포인터로 픽셀에 직접 그리고, 페인트통(플러드필)·이미지 업로드·
 * 지우개·실행 취소·초기화를 제공한다. onChange 에는 version 2 래스터 그림 객체를 전달한다.
 * children 은 캔버스와 도구 버튼 사이에 렌더된다(색상/굵기 컨트롤 슬롯).
 * @param {{
 *   width?:number, height?:number, color?:string, strokeWidth?:number,
 *   onChange?:(drawing:object)=>void, onEmptyChange?:(empty:boolean)=>void,
 *   children?:import("react").ReactNode
 * }} props
 */
export default function DrawingCanvas({
  width = 300,
  height = 200,
  color = "#000000",
  strokeWidth = 3,
  onChange,
  onEmptyChange,
  children,
}) {
  const paintRef = useRef(null); // 실제 픽셀(투명 배경) — 저장 대상
  const overlayRef = useRef(null); // 가이드/플레이스홀더 — 저장되지 않음
  const drawingRef = useRef(false); // 브러시/지우개 드래그 중 여부
  const lastPointRef = useRef(null);
  const undoStackRef = useRef([]); // ImageData 스냅샷 스택(변경 직전 상태)

  const [tool, setTool] = useState("brush"); // "brush" | "eraser" | "bucket"
  const [tailFraction, setTailFraction] = useState(TAIL_FOLD_FRACTION);
  const [mouthFraction, setMouthFraction] = useState(MOUTH_FRACTION);
  const [isEmpty, setIsEmpty] = useState(true);
  const [revision, setRevision] = useState(0); // 픽셀이 바뀔 때마다 증가 → onChange 재전파
  const [notice, setNotice] = useState(null); // 업로드 오류 등 사용자 안내

  // 2D 컨텍스트를 안전히 얻는다(jsdom 등 미지원 환경에서는 null).
  const getPaintCtx = useCallback(() => {
    const canvas = paintRef.current;
    if (!canvas) return null;
    try {
      return canvas.getContext("2d");
    } catch {
      return null;
    }
  }, []);

  // 캔버스 픽셀을 PNG data URL 로 읽는다. 미지원 환경에서는 형식상 유효한 fallback 을 준다.
  const readImage = useCallback(() => {
    const canvas = paintRef.current;
    // 2D 컨텍스트 자체가 없으면(jsdom) toDataURL 호출도 생략해 예외 소음을 피한다.
    if (!canvas || typeof canvas.toDataURL !== "function" || !getPaintCtx()) {
      return FALLBACK_PNG;
    }
    try {
      const url = canvas.toDataURL("image/png");
      return url && url.startsWith("data:image/png") ? url : FALLBACK_PNG;
    } catch {
      return FALLBACK_PNG;
    }
  }, [getPaintCtx]);

  // 컨텍스트가 있으면 픽셀을 스캔해 비어있음을 판정한다. 불가하면 null(호출부가 fallback 사용).
  const scanEmpty = useCallback((ctx) => {
    if (!ctx) return null;
    try {
      const img = ctx.getImageData(0, 0, width, height);
      return isBlankImageData(img);
    } catch {
      return null;
    }
  }, [width, height]);

  // 변경 직전 상태를 undo 스택에 스냅샷한다(상한 초과 시 가장 오래된 것부터 버린다).
  const pushUndoSnapshot = useCallback((ctx) => {
    if (!ctx) return;
    try {
      const snap = ctx.getImageData(0, 0, width, height);
      const stack = undoStackRef.current;
      stack.push(snap);
      if (stack.length > UNDO_CAP) stack.shift();
    } catch {
      // 스냅샷 불가 환경은 undo 미지원(테스트/미지원 브라우저) — 조용히 무시.
    }
  }, [width, height]);

  // 픽셀 변경 후 공통 마무리: 비어있음 재판정(스캔 우선, 불가 시 fallback) + revision 증가.
  const finishMutation = useCallback((fallbackEmpty) => {
    const scanned = scanEmpty(getPaintCtx());
    setIsEmpty(scanned === null ? fallbackEmpty : scanned);
    setRevision((r) => r + 1);
  }, [scanEmpty, getPaintCtx]);

  // 픽셀/가이드가 바뀔 때마다 상위에 version 2 래스터 그림을 알린다(REQ-COMPAT-003).
  useEffect(() => {
    if (!onChange) return;
    onChange(
      buildRasterDrawing({ width, height, tailFraction, mouthFraction, image: readImage() }),
    );
  }, [revision, tailFraction, mouthFraction, width, height, onChange, readImage]);

  // 빈 캔버스 여부를 상위에 알린다(FishComposer 의 제출 게이트가 사용).
  useEffect(() => {
    if (onEmptyChange) onEmptyChange(isEmpty);
  }, [isEmpty, onEmptyChange]);

  // 오버레이(가이드 선 + 영역 라벨 + 플레이스홀더)를 그린다. jsdom 미지원 시 무시.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let ctx = null;
    try {
      ctx = overlay.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    const tailX = Math.round(width * tailFraction);
    const mouthX = Math.round(width * mouthFraction);
    drawGuide(ctx, tailX, height, "#0e7c8c", "꼬리");
    drawGuide(ctx, mouthX, height, "#e67e22", "입");
    ctx.save();
    ctx.fillStyle = "#9aa3ad";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("← 꼬리", tailX / 2, 18);
    ctx.fillText("몸통", (tailX + mouthX) / 2, 18);
    ctx.fillText("입/머리 →", (mouthX + width) / 2, 18);
    ctx.restore();

    if (isEmpty) {
      ctx.save();
      ctx.fillStyle = "#9aa3ad";
      ctx.font = "14px system-ui, sans-serif";
      ctx.fillText("✎  그리기·페인트통·이미지 업로드로 물고기를 만들어 보세요", 16, height - 18);
      ctx.restore();
    }
  }, [tailFraction, mouthFraction, width, height, isEmpty, revision]);

  // 한 획 구간(또는 점)을 캔버스에 그린다. 지우개는 destination-out 으로 투명하게 지운다.
  const drawSegment = useCallback(
    (ctx, a, b) => {
      ctx.save();
      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (a.x === b.x && a.y === b.y) {
        // 클릭 한 점 = 원형 점.
        ctx.beginPath();
        ctx.arc(a.x, a.y, Math.max(strokeWidth / 2, 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    },
    [tool, color, strokeWidth],
  );

  // 페인트통: 클릭 지점의 연결 영역을 선택 색으로 채운다(REQ-FILL-001~004).
  const handleFill = useCallback(
    (p) => {
      const ctx = getPaintCtx();
      if (!ctx) return;
      let img;
      try {
        img = ctx.getImageData(0, 0, width, height);
      } catch {
        return;
      }
      pushUndoSnapshot(ctx); // 채우기 직전 상태 보존(undo)
      const { changed } = floodFill(img, p.x, p.y, hexToRgba(color), FILL_TOLERANCE);
      if (!changed) {
        undoStackRef.current.pop(); // 무동작이면 undo 스택을 오염시키지 않는다(REQ-FILL-003).
        return;
      }
      ctx.putImageData(img, 0, 0);
      finishMutation(false);
    },
    [getPaintCtx, pushUndoSnapshot, color, width, height, finishMutation],
  );

  const handleDown = useCallback(
    (e) => {
      const p = pointFromEvent(e, paintRef.current);
      if (tool === "bucket") {
        handleFill(p);
        return;
      }
      drawingRef.current = true;
      lastPointRef.current = p;
      const ctx = getPaintCtx();
      if (ctx) {
        pushUndoSnapshot(ctx);
        drawSegment(ctx, p, p);
      }
    },
    [tool, handleFill, getPaintCtx, pushUndoSnapshot, drawSegment],
  );

  const handleMove = useCallback(
    (e) => {
      if (!drawingRef.current) return;
      const p = pointFromEvent(e, paintRef.current);
      const ctx = getPaintCtx();
      if (ctx && lastPointRef.current) drawSegment(ctx, lastPointRef.current, p);
      lastPointRef.current = p;
    },
    [getPaintCtx, drawSegment],
  );

  const handleUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    // 브러시는 확실히 내용이 생김(fallback false). 지우개는 스캔 결과에 맡기되 불가하면 현재값 유지.
    finishMutation(tool === "eraser" ? isEmpty : false);
  }, [finishMutation, tool, isEmpty]);

  const handleUndo = useCallback(() => {
    const ctx = getPaintCtx();
    const stack = undoStackRef.current;
    if (!ctx || stack.length === 0) return;
    const prev = stack.pop();
    try {
      ctx.putImageData(prev, 0, 0);
    } catch {
      return;
    }
    const scanned = scanEmpty(ctx);
    setIsEmpty(scanned === null ? isEmpty : scanned);
    setRevision((r) => r + 1);
  }, [getPaintCtx, scanEmpty, isEmpty]);

  const handleClear = useCallback(() => {
    setNotice(null);
    const ctx = getPaintCtx();
    if (ctx) {
      pushUndoSnapshot(ctx);
      ctx.clearRect(0, 0, width, height);
    }
    undoStackRef.current = ctx ? undoStackRef.current : [];
    setIsEmpty(true);
    setRevision((r) => r + 1);
  }, [getPaintCtx, pushUndoSnapshot, width, height]);

  // 이미지 업로드: 허용 포맷만 받아 캔버스 규격으로 리사이즈(contain)해 그린다(REQ-UPLOAD-*).
  const handleUpload = useCallback(
    (e) => {
      setNotice(null);
      const input = e.target;
      const file = input.files && input.files[0];
      input.value = ""; // 같은 파일 재선택 허용
      if (!file) return;
      if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
        setNotice("PNG·JPEG·WebP 이미지만 올릴 수 있어요.");
        return;
      }
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        setNotice("이 브라우저에서는 이미지 업로드를 사용할 수 없어요.");
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const ctx = getPaintCtx();
          if (ctx) {
            pushUndoSnapshot(ctx);
            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.clearRect(0, 0, width, height);
            const { dx, dy, dw, dh } = containFit(image.width, image.height, width, height);
            ctx.drawImage(image, dx, dy, dw, dh);
            ctx.restore();
            // 직렬화 크기 상한 검사 — 초과하면 되돌리고 안내한다(NFR-STORAGE-001).
            const drawing = buildRasterDrawing({
              width,
              height,
              tailFraction,
              mouthFraction,
              image: readImage(),
            });
            if (JSON.stringify(drawing).length > RASTER_LIMITS.maxBytes) {
              handleUndo();
              setNotice("이미지가 너무 커요. 더 작은 이미지를 사용해 주세요.");
              return;
            }
          }
          setIsEmpty(false);
          setRevision((r) => r + 1);
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        setNotice("이미지를 불러오지 못했어요. 다른 파일을 시도해 주세요.");
      };
      image.src = objectUrl;
    },
    [getPaintCtx, pushUndoSnapshot, width, height, tailFraction, mouthFraction, readImage, handleUndo],
  );

  return (
    <div>
      {/* 픽셀(paint) 캔버스 위에 가이드(overlay) 캔버스를 겹친다. 오버레이는 포인터를 통과시킨다. */}
      <div style={{ position: "relative", width: "100%" }}>
        <canvas
          ref={paintRef}
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
        <canvas
          ref={overlayRef}
          width={width}
          height={height}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* 대체 안내: 캔버스는 포인터 전용이며, 아래 컨트롤은 키보드로 조작 가능하다(NFR-A11Y-001). */}
      <p id="draw-canvas-desc" style={srOnly}>
        마우스나 터치로 물고기를 자유롭게 그려 주세요. 캔버스의 세로 점선은 꼬리(왼쪽)와
        입(오른쪽) 위치를 나타냅니다. 왼쪽 선의 왼쪽에 그린 부분은 어항에서 꼬리처럼
        파닥이고, 오른쪽 선의 오른쪽은 먹이를 먹을 때 입처럼 벌렁거립니다. 아래 꼬리 위치·입
        위치 슬라이더로 두 선의 위치를 조정할 수 있어요. 페인트통 버튼을 켜면 캔버스의 닫힌
        영역을 선택한 색으로 한 번에 채울 수 있고, 이미지 올리기 버튼으로 사진이나 그림 파일을
        불러와 물고기로 쓸 수 있어요. 지우개 버튼을 켜면 문지른 부분이 지워지고, 실행 취소·
        초기화 버튼으로 마지막 작업을 되돌리거나 전체를 지울 수 있어요.
      </p>

      {/* 꼬리/입 위치 조정 슬라이더. 값은 그림 너비 대비 비율(%). */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <GuideSlider
          id="tail-guide"
          label="꼬리 위치"
          color="#0e7c8c"
          value={tailFraction}
          onChange={(fraction) =>
            setTailFraction(
              Math.min(fraction, mouthFraction - GUIDE_LIMITS.minGap),
            )
          }
        />
        <GuideSlider
          id="mouth-guide"
          label="입 위치"
          color="#e67e22"
          value={mouthFraction}
          onChange={(fraction) =>
            setMouthFraction(
              Math.max(fraction, tailFraction + GUIDE_LIMITS.minGap),
            )
          }
        />
      </div>

      {/* 색상/브러쉬 등 상위 컨트롤 슬롯(디자인 순서: 캔버스 → 컨트롤 → 도구 버튼). */}
      {children}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          aria-pressed={tool === "bucket"}
          onClick={() => setTool((t) => (t === "bucket" ? "brush" : "bucket"))}
          style={toolButtonStyle(tool === "bucket")}
        >
          <span aria-hidden="true">🪣</span>
          페인트통
        </button>
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          onClick={() => setTool((t) => (t === "eraser" ? "brush" : "eraser"))}
          style={toolButtonStyle(tool === "eraser")}
        >
          <span aria-hidden="true">◪</span>
          지우개
        </button>
        {/* 이미지 업로드: 라벨이 파일 입력을 감싼 접근 가능한 버튼(키보드 포커스/엔터 동작). */}
        <label style={{ ...controlButtonStyle, position: "relative" }}>
          <span aria-hidden="true">🖼</span>
          이미지 올리기
          <input
            type="file"
            aria-label="이미지 올리기"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleUpload}
            style={srOnly}
          />
        </label>
        <button type="button" onClick={handleUndo} style={controlButtonStyle}>
          <span aria-hidden="true">↶</span>
          실행 취소
        </button>
        <button type="button" onClick={handleClear} style={controlButtonStyle}>
          <span aria-hidden="true">🗑</span>
          초기화
        </button>
      </div>

      {notice && (
        <p role="alert" style={{ margin: "10px 0 0", fontSize: 13.5, color: "#c0392b" }}>
          {notice}
        </p>
      )}
    </div>
  );
}
