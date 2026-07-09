// @MX:NOTE: [AUTO] 얇은 PostgreSQL 물고기 저장소. FishRepository 계약을 구현한다.
//   모든 값은 파라미터화 쿼리로 전달해 SQL 주입을 방지한다(NFR-SEC-003).
//   비즈니스 규칙(검증/투영)은 상위 계층이 담당하고, 여기서는 저장/조회만 얇게 처리한다.

// DB 행(snake_case) → 내부 레코드(camelCase) 매핑.
function mapRow(row) {
  return {
    id: row.id,
    drawing: row.drawing,
    ownerId: row.owner_id,
    displayMode: row.display_mode,
    displayName: row.display_name ?? null,
    // TIMESTAMPTZ 는 Date 또는 문자열로 올 수 있어 ISO 문자열로 정규화한다.
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class PgFishRepository {
  /**
   * @param {{ query: (text:string, params?:unknown[]) => Promise<{rows:object[]}> }} pool
   *   pg Pool(또는 동일 인터페이스). 주입해 테스트 가능하게 한다.
   */
  constructor(pool) {
    this._pool = pool;
  }

  async create(record) {
    const text = `INSERT INTO fish (drawing, owner_id, display_mode, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, drawing, owner_id, display_mode, display_name, created_at`;
    const params = [
      JSON.stringify(record.drawing),
      record.ownerId,
      record.displayMode,
      record.displayName ?? null,
    ];
    const { rows } = await this._pool.query(text, params);
    return mapRow(rows[0]);
  }

  async list() {
    const text = `SELECT id, drawing, owner_id, display_mode, display_name, created_at
       FROM fish ORDER BY created_at ASC`;
    const { rows } = await this._pool.query(text);
    return rows.map(mapRow);
  }

  // 소유권 검증용 단건 조회. 내부 owner_id 를 포함해 매핑한다(REQ-OWN-002/003).
  async findById(id) {
    const text = `SELECT id, drawing, owner_id, display_mode, display_name, created_at
       FROM fish WHERE id = $1`;
    const { rows } = await this._pool.query(text, [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  // 물고기를 삭제한다. rowCount 로 실제 삭제 여부를 판단한다(REQ-OWN-002).
  async delete(id) {
    const { rowCount } = await this._pool.query(
      `DELETE FROM fish WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }
}
