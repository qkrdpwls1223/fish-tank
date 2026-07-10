// @MX:NOTE: [AUTO] 얇은 PostgreSQL 수집 저장소. CatchRepository 계약을 구현한다.
//   모든 값은 파라미터화 쿼리로 전달해 SQL 주입을 방지한다(NFR-SEC-003).
//   비즈니스 규칙(비파괴/dedupe/투영)은 상위 라우트가 담당하고, 여기서는 저장/조회만 얇게 처리한다.

// DB 행(snake_case) → 내부 레코드(camelCase) 매핑.
function mapRow(row) {
  return {
    id: row.id,
    catcherId: row.catcher_id,
    sourceFishId: row.source_fish_id,
    drawing: row.drawing,
    displayMode: row.display_mode,
    displayName: row.display_name ?? null,
    // TIMESTAMPTZ 는 Date 또는 문자열로 올 수 있어 ISO 문자열로 정규화한다.
    caughtAt: new Date(row.caught_at).toISOString(),
  };
}

export class PgCatchRepository {
  /**
   * @param {{ query: (text:string, params?:unknown[]) => Promise<{rows:object[]}> }} pool
   *   pg Pool(또는 동일 인터페이스). 주입해 테스트 가능하게 한다.
   */
  constructor(pool) {
    this._pool = pool;
  }

  // 멱등 삽입(REQ-CATCH-005, 레이스 안전): (catcher_id, source_fish_id) 유니크 제약 위반은
  // ON CONFLICT DO NOTHING 으로 흡수한다. 동시 요청(더블클릭 등)이 dedupe 사전 체크를 둘 다
  // 통과해도 두 번째 INSERT 가 500 을 내는 대신 0행을 반환하고, 폴백 SELECT 로 기존 행을 돌려준다.
  // create 계약: 항상 영속된 행(기존 또는 신규)을 반환한다.
  async create(record) {
    const text = `INSERT INTO caught_fish (catcher_id, source_fish_id, drawing, display_mode, display_name)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (catcher_id, source_fish_id) DO NOTHING
       RETURNING id, catcher_id, source_fish_id, drawing, display_mode, display_name, caught_at`;
    const params = [
      record.catcherId,
      record.sourceFishId,
      JSON.stringify(record.drawing),
      record.displayMode,
      record.displayName ?? null,
    ];
    const { rows } = await this._pool.query(text, params);
    if (rows[0]) {
      return mapRow(rows[0]);
    }
    // 충돌로 삽입이 생략됨 — 이미 있는 기존 행을 조회해 반환한다.
    return this.findByCatcherAndSource(record.catcherId, record.sourceFishId);
  }

  // 본인 스코프 목록. 최신순(caught_at DESC)으로 반환한다(REQ-COLL-001, REQ-PRIV-003).
  async listByCatcher(catcherId) {
    const text = `SELECT id, catcher_id, source_fish_id, drawing, display_mode, display_name, caught_at
       FROM caught_fish WHERE catcher_id = $1 ORDER BY caught_at DESC`;
    const { rows } = await this._pool.query(text, [catcherId]);
    return rows.map(mapRow);
  }

  // dedupe 조회. (catcher_id, source_fish_id) 유일 조합을 찾는다(REQ-CATCH-005). 없으면 null.
  async findByCatcherAndSource(catcherId, sourceFishId) {
    const text = `SELECT id, catcher_id, source_fish_id, drawing, display_mode, display_name, caught_at
       FROM caught_fish WHERE catcher_id = $1 AND source_fish_id = $2`;
    const { rows } = await this._pool.query(text, [catcherId, sourceFishId]);
    return rows[0] ? mapRow(rows[0]) : null;
  }
}
