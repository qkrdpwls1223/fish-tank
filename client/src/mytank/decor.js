// 내 어항 장식(수초/바위/성) 프리셋. 데이터 주도 설계라 새 종류를 쉽게 추가할 수 있다:
// DECOR_KINDS 에 { kind, label, draw, hitRadius } 항목 하나만 더하면 팔레트·렌더·히트테스트가
// 모두 자동으로 반영된다. draw(ctx, x, y) 는 (x,y)를 바닥 중심 기준점으로 삼아 단색 벡터로 그린다.
// 캔버스 2D 컨텍스트는 jsdom 에서 no-op 이므로 렌더는 브라우저에서만 유효하다(테스트는 DOM 검증).

// 장식이 놓이는 기본 위치(어항 좌하단 근처). 넣자마자 드래그로 옮길 수 있다.
export const DEFAULT_DECOR_POS = { x: 120, y: 220 };

// 수초: 바닥에서 위로 자라는 물결 모양 잎 몇 가닥(초록 계열).
function drawSeaweed(ctx, x, y) {
  ctx.save();
  ctx.strokeStyle = "#2f9e5f";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  const blades = [-14, 0, 14];
  for (const off of blades) {
    ctx.beginPath();
    ctx.moveTo(x + off, y);
    ctx.quadraticCurveTo(x + off - 12, y - 26, x + off + 4, y - 52);
    ctx.quadraticCurveTo(x + off + 16, y - 74, x + off - 2, y - 96);
    ctx.stroke();
  }
  ctx.restore();
}

// 바위: 바닥에 앉은 둥근 회색 돌덩이(단순 다각형 + 하이라이트).
function drawRock(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = "#8a8f98";
  ctx.beginPath();
  ctx.moveTo(x - 34, y);
  ctx.lineTo(x - 22, y - 24);
  ctx.lineTo(x + 2, y - 32);
  ctx.lineTo(x + 26, y - 22);
  ctx.lineTo(x + 34, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.ellipse(x - 6, y - 20, 12, 6, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 성: 모래색 몸통 + 좌우 탑 + 성문. 아이 그림책 느낌의 아담한 모래성.
function drawCastle(ctx, x, y) {
  ctx.save();
  ctx.fillStyle = "#d9b98a";
  // 몸통
  ctx.fillRect(x - 30, y - 40, 60, 40);
  // 좌우 탑
  ctx.fillRect(x - 40, y - 56, 16, 56);
  ctx.fillRect(x + 24, y - 56, 16, 56);
  // 탑 지붕(삼각형)
  ctx.fillStyle = "#c79a63";
  for (const tx of [x - 32, x + 32]) {
    ctx.beginPath();
    ctx.moveTo(tx - 10, y - 56);
    ctx.lineTo(tx + 10, y - 56);
    ctx.lineTo(tx, y - 72);
    ctx.closePath();
    ctx.fill();
  }
  // 성문(아치형 입구)
  ctx.fillStyle = "#7a5a34";
  ctx.beginPath();
  ctx.moveTo(x - 9, y);
  ctx.lineTo(x - 9, y - 16);
  ctx.arc(x, y - 16, 9, Math.PI, 0);
  ctx.lineTo(x + 9, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// @MX:ANCHOR: [AUTO] 장식 종류 단일 소스. 팔레트/렌더/히트테스트/이동이 모두 이 배열을 참조한다.
// @MX:REASON: fan_in >= 3 (MyTank 팔레트 버튼, drawDecor 디스패치, hitRadius 히트테스트가 모두 소비).
export const DECOR_KINDS = [
  { kind: "seaweed", label: "수초", draw: drawSeaweed, hitRadius: 34 },
  { kind: "rock", label: "바위", draw: drawRock, hitRadius: 36 },
  { kind: "castle", label: "성", draw: drawCastle, hitRadius: 44 },
];

// kind → 정의 조회용 맵.
const BY_KIND = Object.fromEntries(DECOR_KINDS.map((d) => [d.kind, d]));

// 유효한 장식 종류인지 검사(서버 400 invalid_kind 를 클라이언트에서도 방어).
export function isDecorKind(kind) {
  return Object.prototype.hasOwnProperty.call(BY_KIND, kind);
}

// kind 의 한글 라벨을 돌려준다(목록/안내 표기용). 알 수 없으면 kind 그대로.
export function decorLabel(kind) {
  return BY_KIND[kind]?.label ?? kind;
}

// kind 의 히트 반경(px). 캔버스 드래그 선택 시 클릭 지점과의 거리 비교에 쓴다.
export function decorHitRadius(kind) {
  return BY_KIND[kind]?.hitRadius ?? 30;
}

/**
 * 장식 항목 하나를 캔버스에 그린다. item.scale 이 있으면 (x,y) 기준점을 중심으로 확대/축소해
 * 그린다(기준점은 고정되므로 놓은 자리를 유지). 알 수 없는 kind 나 컨텍스트 없음이면 조용히 무시한다.
 * @param {CanvasRenderingContext2D|null} ctx
 * @param {{kind:string, x:number, y:number, scale?:number}} item
 */
export function drawDecor(ctx, item) {
  if (!ctx || !item) return;
  const def = BY_KIND[item.kind];
  if (!def) return;
  const scale = typeof item.scale === "number" && Number.isFinite(item.scale) ? item.scale : 1;
  if (scale === 1) {
    def.draw(ctx, item.x, item.y);
    return;
  }
  // 기준점(x,y)을 원점으로 옮겨 스케일한 뒤 되돌린다 → 바닥 중심을 고정한 채 크기만 변한다.
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.scale(scale, scale);
  ctx.translate(-item.x, -item.y);
  def.draw(ctx, item.x, item.y);
  ctx.restore();
}
