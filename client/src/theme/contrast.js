// WCAG 2.1 색 대비 계산(순수 함수). 크롬/컨트롤/텍스트 색이 접근성 기준(AA)을
// 만족하는지 코드로 검증하기 위한 유틸이다 (NFR-A11Y-001: 충분한 색 대비).

// AA 대비 기준: 일반 텍스트 4.5:1, 큰 텍스트(굵거나 큰 글자) 3:1.
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;

// "#rrggbb" 또는 "#rgb" 를 0~255 채널 배열로 파싱한다.
function parseHex(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

// sRGB 채널(0~255)을 선형 색 공간 값으로 변환한다(WCAG 정의).
function channelToLinear(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 색의 상대 휘도(0~1)를 계산한다.
 * @param {string} hex - "#rrggbb"
 * @returns {number}
 */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/**
 * 두 색의 대비 비율(1~21)을 계산한다. 순서에 무관(대칭).
 * @param {string} fg
 * @param {string} bg
 * @returns {number}
 */
export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 대비가 WCAG AA 기준을 만족하는지 판정한다.
 * @param {string} fg
 * @param {string} bg
 * @param {{large?:boolean}} [opts] - 큰 텍스트면 3:1 기준 적용
 * @returns {boolean}
 */
export function meetsAA(fg, bg, { large = false } = {}) {
  const threshold = large ? AA_LARGE : AA_NORMAL;
  return contrastRatio(fg, bg) >= threshold;
}
