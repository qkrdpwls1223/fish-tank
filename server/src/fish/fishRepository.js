// @MX:NOTE: [AUTO] 물고기 데이터 접근 계층 계약(FishRepository).
//   라이브 DB 없이 단위 테스트하기 위해 인메모리 구현을 제공한다.
//   실제 PostgreSQL 구현(pgFishRepository.js)은 동일한 계약을 얇게 구현한다.
//
// 계약(interface):
//   create(record: { drawing, ownerId, displayMode, displayName })
//     → Promise<{ id, drawing, ownerId, displayMode, displayName, createdAt }>
//   list() → Promise<StoredFish[]>
//   findById(id) → Promise<StoredFish | null>   // 소유권 검증용(내부 ownerId 포함, REQ-OWN-002/003)
//   delete(id) → Promise<boolean>               // 삭제 성공 여부(REQ-OWN-002)
import { randomUUID } from "node:crypto";

// 인메모리 물고기 저장소. 테스트 및 로컬 개발용.
export class InMemoryFishRepository {
  constructor() {
    // 내부 저장 배열. 외부로는 방어적 복사본만 노출한다.
    this._fish = [];
  }

  // 물고기를 저장하고 id/createdAt 을 부여한 레코드를 반환한다.
  async create(record) {
    const stored = {
      id: randomUUID(),
      drawing: record.drawing,
      ownerId: record.ownerId, // 익명 물고기도 내부 소유자 저장 (REQ-OWN-001)
      displayMode: record.displayMode,
      displayName: record.displayName ?? null,
      createdAt: new Date().toISOString(),
    };
    this._fish.push(stored);
    return { ...stored };
  }

  // 저장된 모든 물고기를 반환한다(방어적 복사).
  async list() {
    return this._fish.map((f) => ({ ...f }));
  }

  // 단건 조회. 삭제 권한 검증을 위해 내부 ownerId 를 포함해 반환한다(REQ-OWN-002/003).
  // 없으면 null.
  async findById(id) {
    const found = this._fish.find((f) => f.id === id);
    return found ? { ...found } : null;
  }

  // 물고기를 삭제한다. 삭제되면 true, 대상이 없으면 false(REQ-OWN-002).
  async delete(id) {
    const idx = this._fish.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    this._fish.splice(idx, 1);
    return true;
  }
}
