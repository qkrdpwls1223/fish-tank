// @MX:NOTE: [AUTO] 내 어항 아이템 크기(scale) 경계·검증. 물고기/장식 배치 시 확대·축소 배율.
//   클라이언트 값을 신뢰하지 않고 [SCALE_MIN, SCALE_MAX] 범위의 유한한 숫자만 허용한다(NFR-SEC-003).

// 배율 하한. 이보다 작으면 아이템이 사실상 보이지 않는다.
export const SCALE_MIN = 0.3;
// 배율 상한. 이보다 크면 어항을 가득 덮는다.
export const SCALE_MAX = 3.0;
// 배율 기본값(원본 크기). scale 미지정 시 사용한다.
export const SCALE_DEFAULT = 1.0;

/**
 * scale 이 유한한 숫자이며 [SCALE_MIN, SCALE_MAX] 범위 안인지 검증한다.
 * NaN/Infinity/문자열/null/undefined 는 모두 무효.
 * @param {unknown} scale
 * @returns {boolean}
 */
export function isValidScale(scale) {
  return Number.isFinite(scale) && scale >= SCALE_MIN && scale <= SCALE_MAX;
}
