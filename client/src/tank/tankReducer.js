// 어항 상태 리듀서(순수 함수). 진입 스냅샷 로드 + 실시간 델타(추가/삭제) 반영.
// (REQ-RT-001/002/003/004) 재연결 재동기화 안전을 위해 추가는 멱등, 스냅샷은 전체 치환.

export const initialTankState = { fish: [] };

/**
 * @param {{fish: object[]}} state
 * @param {{type:string, fish?:object, id?:string}} action
 */
export function tankReducer(state, action) {
  switch (action.type) {
    case "SNAPSHOT":
      // 진입/재연결 시 서버 스냅샷으로 전체 치환 (REQ-RT-004, REQ-RT-003).
      return { fish: [...action.fish] };
    case "FISH_ADDED": {
      // 멱등: 이미 있는 id 는 중복 추가하지 않는다(스냅샷+델타 경합 안전).
      if (state.fish.some((f) => f.id === action.fish.id)) return state;
      return { fish: [...state.fish, action.fish] };
    }
    case "FISH_DELETED":
      return { fish: state.fish.filter((f) => f.id !== action.id) };
    default:
      return state;
  }
}
