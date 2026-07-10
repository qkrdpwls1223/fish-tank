// @MX:NOTE: [AUTO] 수집(catch) 데이터 접근 계층 계약(CatchRepository).
//   라이브 DB 없이 단위 테스트하기 위해 인메모리 구현을 제공한다.
//   실제 PostgreSQL 구현(pgCatchRepository.js)은 동일한 계약을 얇게 구현한다.
//
// 계약(interface):
//   create(record: { catcherId, sourceFishId, drawing, displayMode, displayName })
//     → Promise<{ id, catcherId, sourceFishId, drawing, displayMode, displayName, caughtAt }>
//   listByCatcher(catcherId) → Promise<StoredCatch[]>   // 본인 스코프, 최신순(REQ-COLL-001)
//   findByCatcherAndSource(catcherId, sourceFishId) → Promise<StoredCatch | null>  // dedupe(REQ-CATCH-005)
import { randomUUID } from "node:crypto";

// 인메모리 수집 저장소. 테스트 및 로컬 개발용.
export class InMemoryCatchRepository {
  constructor() {
    // 내부 저장 배열(삽입 순서 유지). 외부로는 방어적 복사본만 노출한다.
    this._catches = [];
  }

  // 낚은 시점 스냅샷을 저장하고 id/caughtAt 을 부여한 레코드를 반환한다(REQ-SNAP-001).
  async create(record) {
    const stored = {
      id: randomUUID(),
      catcherId: record.catcherId,
      sourceFishId: record.sourceFishId,
      drawing: record.drawing,
      displayMode: record.displayMode,
      displayName: record.displayName ?? null,
      caughtAt: new Date().toISOString(),
    };
    this._catches.push(stored);
    return { ...stored };
  }

  // 낚은 사람 본인의 수집만 최신순(newest-first)으로 반환한다(REQ-COLL-001, REQ-PRIV-003).
  // 최신순은 삽입 순서의 역순으로 결정해 동일 밀리초 타임스탬프에도 결정적이다.
  async listByCatcher(catcherId) {
    return this._catches
      .filter((c) => c.catcherId === catcherId)
      .map((c) => ({ ...c }))
      .reverse();
  }

  // dedupe 조회: (catcherId, sourceFishId) 조합의 수집을 찾는다(REQ-CATCH-005). 없으면 null.
  async findByCatcherAndSource(catcherId, sourceFishId) {
    const found = this._catches.find(
      (c) => c.catcherId === catcherId && c.sourceFishId === sourceFishId,
    );
    return found ? { ...found } : null;
  }
}
