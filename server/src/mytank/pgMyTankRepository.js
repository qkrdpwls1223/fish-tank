// @MX:NOTE: [AUTO] 얇은 PostgreSQL 내 어항 저장소. MyTankRepository 계약을 구현한다.
//   모든 값은 파라미터화 쿼리로 전달해 SQL 주입을 방지한다(NFR-SEC-003).
//   소유권 스코프는 변경/삭제 쿼리의 WHERE id = $1 AND owner_id = $2 로 강제해,
//   타인 행을 절대 건드리지 않는다(누출 없는 404 근거). 비즈니스 규칙(검증/투영)은 상위 계층이 담당한다.
import { SCALE_DEFAULT } from "./scale.js";

// DB 물고기 행(snake_case) → 내부 레코드(camelCase) 매핑.
function mapFishRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    drawing: row.drawing,
    displayMode: row.display_mode,
    displayName: row.display_name ?? null,
    x: row.x,
    y: row.y,
    scale: row.scale,
    // TIMESTAMPTZ 는 Date 또는 문자열로 올 수 있어 ISO 문자열로 정규화한다.
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// DB 장식 행(snake_case) → 내부 레코드(camelCase) 매핑.
function mapDecorRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    x: row.x,
    y: row.y,
    scale: row.scale,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PgMyTankRepository {
  /**
   * @param {{ query: (text:string, params?:unknown[]) => Promise<{rows:object[], rowCount:number}> }} pool
   *   pg Pool(또는 동일 인터페이스). 주입해 테스트 가능하게 한다.
   */
  constructor(pool) {
    this._pool = pool;
  }

  // --- 물고기 ---

  async createFish(record) {
    const text = `INSERT INTO my_tank_fish (owner_id, drawing, display_mode, display_name, x, y, scale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, owner_id, drawing, display_mode, display_name, x, y, scale, created_at`;
    const params = [
      record.ownerId,
      JSON.stringify(record.drawing),
      record.displayMode,
      record.displayName ?? null,
      record.x,
      record.y,
      record.scale ?? SCALE_DEFAULT,
    ];
    const { rows } = await this._pool.query(text, params);
    return mapFishRow(rows[0]);
  }

  async listFishByOwner(ownerId) {
    const text = `SELECT id, owner_id, drawing, display_mode, display_name, x, y, scale, created_at
       FROM my_tank_fish WHERE owner_id = $1 ORDER BY created_at ASC`;
    const { rows } = await this._pool.query(text, [ownerId]);
    return rows.map(mapFishRow);
  }

  // 본인 소유일 때만 갱신한다. x, y 는 항상 갱신, scale 은 주어졌을 때만 SET 에 포함한다.
  // RETURNING 으로 갱신본을 돌려주고, 매칭이 없으면 null.
  async updateFishPosition({ id, ownerId, x, y, scale }) {
    const setScale = scale !== undefined;
    const text = `UPDATE my_tank_fish SET x = $3, y = $4${setScale ? ", scale = $5" : ""}
       WHERE id = $1 AND owner_id = $2
       RETURNING id, owner_id, drawing, display_mode, display_name, x, y, scale, created_at`;
    const params = setScale ? [id, ownerId, x, y, scale] : [id, ownerId, x, y];
    const { rows } = await this._pool.query(text, params);
    return rows[0] ? mapFishRow(rows[0]) : null;
  }

  // 본인 소유일 때만 삭제한다. rowCount 로 실제 삭제 여부를 판단한다.
  async deleteFish({ id, ownerId }) {
    const { rowCount } = await this._pool.query(
      `DELETE FROM my_tank_fish WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rowCount > 0;
  }

  // --- 장식 ---

  async createDecor(record) {
    const text = `INSERT INTO my_tank_decor (owner_id, kind, x, y, scale)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, owner_id, kind, x, y, scale, created_at`;
    const params = [record.ownerId, record.kind, record.x, record.y, record.scale ?? SCALE_DEFAULT];
    const { rows } = await this._pool.query(text, params);
    return mapDecorRow(rows[0]);
  }

  async listDecorByOwner(ownerId) {
    const text = `SELECT id, owner_id, kind, x, y, scale, created_at
       FROM my_tank_decor WHERE owner_id = $1 ORDER BY created_at ASC`;
    const { rows } = await this._pool.query(text, [ownerId]);
    return rows.map(mapDecorRow);
  }

  // x, y 는 항상 갱신, scale 은 주어졌을 때만 SET 에 포함한다.
  async updateDecorPosition({ id, ownerId, x, y, scale }) {
    const setScale = scale !== undefined;
    const text = `UPDATE my_tank_decor SET x = $3, y = $4${setScale ? ", scale = $5" : ""}
       WHERE id = $1 AND owner_id = $2
       RETURNING id, owner_id, kind, x, y, scale, created_at`;
    const params = setScale ? [id, ownerId, x, y, scale] : [id, ownerId, x, y];
    const { rows } = await this._pool.query(text, params);
    return rows[0] ? mapDecorRow(rows[0]) : null;
  }

  async deleteDecor({ id, ownerId }) {
    const { rowCount } = await this._pool.query(
      `DELETE FROM my_tank_decor WHERE id = $1 AND owner_id = $2`,
      [id, ownerId],
    );
    return rowCount > 0;
  }
}
