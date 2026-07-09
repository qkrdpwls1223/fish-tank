// 어항 앱 색 토큰 (NFR-A11Y-001: 충분한 색 대비).
// 여기 정의한 컨트롤/텍스트 색은 모두 표면(surface) 위에서 WCAG 2.1 AA 대비를
// 만족한다(colors.test.js 로 검증). 사용자가 그린 캔버스 그림은 접근성 대비 예외다.
//
// 대비 근거(흰색 #ffffff 표면 기준, contrast.js 계산):
//   text     #1f2933  ≈ 15.0:1  (본문 — AA 통과)
//   danger   #b91c1c  ≈  6.5:1  (삭제 버튼 라벨 — AA 통과)
//   muted    #5b6672  ≈  5.8:1  (보조 안내 텍스트 — AA 통과)
//   primary  #1d4ed8  위의 흰색(onPrimary) ≈ 6.7:1 (주요 버튼 — AA 통과)
export const colors = {
  surface: "#ffffff", // 앱/카드 표면 배경
  text: "#1f2933", // 기본 본문 텍스트
  muted: "#5b6672", // 보조 안내 텍스트
  primary: "#1d4ed8", // 주요 액션 버튼 배경
  onPrimary: "#ffffff", // 주요 버튼 위 라벨 색
  danger: "#b91c1c", // 삭제 등 위험 액션 텍스트
  border: "#ccccdd", // 장식용 테두리(대비 기준 비적용)
};
