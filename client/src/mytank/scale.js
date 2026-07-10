// 내 어항 아이템(물고기/장식) 크기 조절 규약. 서버 계약과 동일한 범위 [0.3, 3.0] 안에서
// 한 클릭당 SCALE_STEP 만큼 키우거나 줄인다. 순수 함수라 컴포넌트와 테스트가 같은 값을 공유한다.

export const SCALE_MIN = 0.3;
export const SCALE_MAX = 3.0;
export const SCALE_STEP = 0.2;

// 부동소수 누적 오차를 막기 위해 소수 둘째 자리로 반올림한다(0.1+0.2 류 방지).
function round2(v) {
  return Math.round(v * 100) / 100;
}

// 값이 숫자가 아니면 기본 크기 1.0 으로 간주한다(scale 없는 레거시 항목 방어).
function normalize(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 1;
}

// 크기를 허용 범위 [SCALE_MIN, SCALE_MAX] 안으로 가둔다.
export function clampScale(v) {
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, normalize(v)));
}

/**
 * 현재 크기에서 한 스텝 키우거나(direction>0) 줄인(direction<0) 새 크기를 돌려준다.
 * 범위를 벗어나면 경계로 클램프되고, 결과는 소수 둘째 자리로 반올림된다.
 * @param {number} current 현재 크기
 * @param {number} direction +1(크게) 또는 -1(작게)
 * @returns {number} 클램프된 새 크기
 */
export function nextScale(current, direction) {
  const base = clampScale(current);
  const delta = direction >= 0 ? SCALE_STEP : -SCALE_STEP;
  return clampScale(round2(base + delta));
}

// 더 키울 수 있는지(최대 미만인지). "크게(+)" 버튼 비활성화 판단용.
export function canScaleUp(current) {
  return clampScale(current) < SCALE_MAX - 1e-9;
}

// 더 줄일 수 있는지(최소 초과인지). "작게(−)" 버튼 비활성화 판단용.
export function canScaleDown(current) {
  return clampScale(current) > SCALE_MIN + 1e-9;
}
