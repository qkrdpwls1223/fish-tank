// @MX:NOTE: [AUTO] 내 어항(개인 어항) 데이터 접근 계층 계약(MyTankRepository).
//   라이브 DB 없이 단위 테스트하기 위해 인메모리 구현을 제공한다.
//   실제 PostgreSQL 구현(pgMyTankRepository.js)은 동일한 계약을 얇게 구현한다.
//
// 계약(interface): 모든 읽기/변경/삭제는 ownerId 로 스코프된다(개인 어항은 소유자 전용).
//   createFish({ ownerId, drawing, displayMode, displayName, x, y, scale? })
//     → Promise<StoredMyTankFish>   // scale 생략 시 기본값 1.0
//   listFishByOwner(ownerId) → Promise<StoredMyTankFish[]>
//   updateFishPosition({ id, ownerId, x, y, scale? })
//     → Promise<StoredMyTankFish | null>   // 본인 소유가 아니면 null(변경 없음)
//     // 좌표(x, y)는 항상 갱신하고, scale 은 주어졌을 때만 갱신한다(미지정 시 기존값 유지).
//   deleteFish({ id, ownerId }) → Promise<boolean>   // 본인 소유가 아니면 false(삭제 없음)
//   createDecor({ ownerId, kind, x, y, scale? }) → Promise<StoredMyTankDecor>
//   listDecorByOwner(ownerId) → Promise<StoredMyTankDecor[]>
//   updateDecorPosition({ id, ownerId, x, y, scale? }) → Promise<StoredMyTankDecor | null>
//   deleteDecor({ id, ownerId }) → Promise<boolean>
//
// scale 갱신 계약: x, y 는 필수(항상 갱신), scale 은 선택(제공된 필드만 변경). 범위 검증은 라우트 계층(scale.js)이 담당한다.
//
// StoredMyTankFish : { id, ownerId, drawing, displayMode, displayName, x, y, scale, createdAt }
// StoredMyTankDecor: { id, ownerId, kind, x, y, scale, createdAt }
import { randomUUID } from "node:crypto";
import { SCALE_DEFAULT } from "./scale.js";

// 인메모리 내 어항 저장소. 테스트 및 로컬 개발용.
// fish 와 decor 를 하나의 계약으로 묶어 라우트가 단일 저장소만 주입받게 한다.
export class InMemoryMyTankRepository {
  constructor() {
    // 내부 저장 배열. 외부로는 방어적 복사본만 노출한다.
    this._fish = [];
    this._decor = [];
  }

  // --- 물고기 ---

  async createFish(record) {
    const stored = {
      id: randomUUID(),
      ownerId: record.ownerId,
      drawing: record.drawing,
      displayMode: record.displayMode,
      displayName: record.displayName ?? null,
      x: record.x,
      y: record.y,
      scale: record.scale ?? SCALE_DEFAULT,
      createdAt: new Date().toISOString(),
    };
    this._fish.push(stored);
    return { ...stored };
  }

  async listFishByOwner(ownerId) {
    return this._fish.filter((f) => f.ownerId === ownerId).map((f) => ({ ...f }));
  }

  // 본인 소유일 때만 좌표(및 주어진 경우 scale)를 갱신하고 갱신본을 반환한다. 아니면 null(변경 없음).
  async updateFishPosition({ id, ownerId, x, y, scale }) {
    const found = this._fish.find((f) => f.id === id && f.ownerId === ownerId);
    if (!found) return null;
    found.x = x;
    found.y = y;
    if (scale !== undefined) found.scale = scale;
    return { ...found };
  }

  // 본인 소유일 때만 삭제한다. 삭제되면 true, 아니면 false(대상 없음/타인 소유).
  async deleteFish({ id, ownerId }) {
    const idx = this._fish.findIndex((f) => f.id === id && f.ownerId === ownerId);
    if (idx === -1) return false;
    this._fish.splice(idx, 1);
    return true;
  }

  // --- 장식 ---

  async createDecor(record) {
    const stored = {
      id: randomUUID(),
      ownerId: record.ownerId,
      kind: record.kind,
      x: record.x,
      y: record.y,
      scale: record.scale ?? SCALE_DEFAULT,
      createdAt: new Date().toISOString(),
    };
    this._decor.push(stored);
    return { ...stored };
  }

  async listDecorByOwner(ownerId) {
    return this._decor.filter((d) => d.ownerId === ownerId).map((d) => ({ ...d }));
  }

  async updateDecorPosition({ id, ownerId, x, y, scale }) {
    const found = this._decor.find((d) => d.id === id && d.ownerId === ownerId);
    if (!found) return null;
    found.x = x;
    found.y = y;
    if (scale !== undefined) found.scale = scale;
    return { ...found };
  }

  async deleteDecor({ id, ownerId }) {
    const idx = this._decor.findIndex((d) => d.id === id && d.ownerId === ownerId);
    if (idx === -1) return false;
    this._decor.splice(idx, 1);
    return true;
  }
}
