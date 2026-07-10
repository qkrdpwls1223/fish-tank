// 수집함 스냅샷 렌더러 (REQ-COLL-003). 저장된 그림 데이터를 캔버스에 "정적으로" 그린다.
// 어항의 애니메이션 렌더러와 달리 꼬리 흔들림/입 벌림 없이 한 장으로 렌더하며, 주어진 박스 안에
// 비율을 유지해 맞춘다. 벡터(version 1: {strokes[]})와 래스터(version 2: {kind:"raster",image})를
// 모두 처리한다(REQ-RENDER-003, REQ-COMPAT-001). 순수 계산부(computeFit)는 캔버스 없이 단위 검증한다.

/**
 * 그림을 박스 안에 비율 유지로 맞추는 변환(배율/오프셋)을 계산한다.
 * @param {{width?:number, height?:number}} drawing
 * @param {{width:number, height:number}} box - 렌더 캔버스 크기(px)
 * @param {number} [padding] - 박스 안쪽 여백(px)
 * @returns {{scale:number, offsetX:number, offsetY:number}}
 */
export function computeFit(drawing, box, padding = 8) {
  const w = drawing?.width || 300;
  const h = drawing?.height || 200;
  const availW = Math.max(1, box.width - padding * 2);
  const availH = Math.max(1, box.height - padding * 2);
  const scale = Math.min(availW / w, availH / h);
  const offsetX = (box.width - w * scale) / 2;
  const offsetY = (box.height - h * scale) / 2;
  return { scale, offsetX, offsetY };
}

/**
 * 그림 스냅샷을 캔버스에 정적으로 그린다(애니메이션 없음). 2D 컨텍스트 미지원(jsdom) 또는 그림 없음이면
 * 조용히 무시한다(FishTank.drawTank 와 동일한 방어 패턴). 벡터/래스터를 version 으로 분기한다.
 * @param {HTMLCanvasElement|null} canvas
 * @param {{version?:number, kind?:string, strokes?:Array, image?:string}} drawing
 * @param {{width:number, height:number}} box
 */
export function drawSnapshot(canvas, drawing, box) {
  if (!canvas) return;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx || !drawing) return;

  // 래스터(version 2): 이미지를 디코드해 박스에 비율 유지로 맞춰 그린다(비동기 — 로드 완료 시 그린다).
  if (drawing.version === 2 || drawing.kind === "raster") {
    drawRasterSnapshot(ctx, drawing, box);
    return;
  }

  // 벡터(version 1): 획을 정적으로 그린다(기존 동작 보존, REQ-COMPAT-002).
  if (!Array.isArray(drawing.strokes)) return;
  const { scale, offsetX, offsetY } = computeFit(drawing, box);
  ctx.clearRect(0, 0, box.width, box.height);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
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

// 래스터 스냅샷: PNG data URL 을 Image 로 디코드해 박스에 fit 로 그린다. Image 미지원(구 jsdom) 또는
// 이미지 문자열이 없으면 무동작. 디코드는 비동기이므로 onload 에서 그린다(정적 한 장, 애니메이션 없음).
function drawRasterSnapshot(ctx, drawing, box) {
  if (typeof drawing.image !== "string" || typeof Image === "undefined") return;
  const { scale, offsetX, offsetY } = computeFit(drawing, box);
  const w = (drawing.width || 300) * scale;
  const h = (drawing.height || 200) * scale;
  const img = new Image();
  img.onload = () => {
    try {
      ctx.clearRect(0, 0, box.width, box.height);
      ctx.drawImage(img, offsetX, offsetY, w, h);
    } catch {
      /* 그리기 실패 무시 */
    }
  };
  img.onerror = () => {};
  try {
    img.src = drawing.image;
  } catch {
    /* data URL 할당 실패 무시 */
  }
}
