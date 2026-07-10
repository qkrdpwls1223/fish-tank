-- SPEC-CATCH-001 M1: 개인 수집함 스냅샷 테이블 (REQ-SNAP-001/002/003, REQ-CATCH-005)
-- 낚은 시점의 그림/표시 속성을 원본 물고기와 분리된 독립 스냅샷으로 영구 보존한다.
-- 원본 fish 행에 대한 외래키·cascade 를 두지 않아, 원본이 삭제돼도 사본은 생존한다(REQ-SNAP-002/003).

CREATE TABLE IF NOT EXISTS caught_fish (
    -- 수집 항목 고유 식별자.
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 낚은 사람(인증된 Teams 사용자의 토큰 oid). 수집함은 이 값으로 스코프된다(REQ-PRIV-003).
    catcher_id     TEXT NOT NULL,

    -- 원본 물고기 참조(dedupe 전용 순수 참조값). FK/cascade 없음 —
    -- 원본 삭제와 무관하게 스냅샷이 생존해야 하기 때문이다(REQ-SNAP-002/003).
    source_fish_id UUID NOT NULL,

    -- 낚은 시점에 원본에서 복사한 스냅샷 컬럼들(원본 이후 변경/삭제와 독립).
    drawing        JSONB NOT NULL,
    display_mode   TEXT NOT NULL CHECK (display_mode IN ('named', 'anonymous')),
    display_name   TEXT,

    -- 낚은 시각(수집 메타데이터, REQ-COLL-004).
    caught_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- 중복 낚기 멱등 처리(REQ-CATCH-005): 한 사람은 같은 원본을 한 번만 수집한다.
    UNIQUE (catcher_id, source_fish_id)
);

-- 수집함 목록 조회(본인 스코프, REQ-COLL-001)를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_caught_fish_catcher_id ON caught_fish (catcher_id);
