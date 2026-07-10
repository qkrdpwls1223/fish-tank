// 수집 메타데이터 표시 헬퍼 (REQ-COLL-004). 낚은 시각(ISO 문자열)을 한국어 로케일로
// 읽기 좋게 포맷한다. 잘못된/빈 값은 빈 문자열로 안전 처리한다.

/**
 * 낚은 시각(ISO-8601)을 한국어로 읽기 좋게 표시한다.
 * @param {string} iso
 * @returns {string} 예: "2026년 7월 10일 오후 09:00" (로케일/시간대에 따라 표기)
 */
export function formatCaughtAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    // Intl 데이터 미탑재 등 예외 시 ISO 원본으로 폴백.
    return d.toISOString();
  }
}
