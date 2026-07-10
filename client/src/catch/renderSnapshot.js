// 수집함 스냅샷 렌더러 (REQ-COLL-003). 저장된 그림 데이터(공개 물고기와 동일한
// {version,width,height,strokes[]} 형태)를 캔버스에 "정적으로" 그린다. 어항의 애니메이션
// 렌더러(drawFishSprite)와 달리 꼬리 흔들림/입 벌림 없이 한 장으로 렌더하며, 주어진 박스
// 안에 비율을 유지해 맞춘다. 순수 계산부(computeFit)는 캔버스 없이 단위 검증할 수 있다.

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
 * 그림 스냅샷을 캔버스에 정적으로 그린다. 2D 컨텍스트 미지원(jsdom) 또는 그림 없음이면
 * 조용히 무시한다(FishTank.drawTank 와 동일한 방어 패턴).
 * @param {HTMLCanvasElement|null} canvas
 * @param {{strokes?:Array}} drawing
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
  if (!ctx || !drawing || !Array.isArray(drawing.strokes)) return;

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
