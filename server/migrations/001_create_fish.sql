-- SPEC-TANK-001 M2: 물고기 영구 저장 테이블 (REQ-PERSIST-001/002, REQ-OWN-001)
-- 그림 데이터, 내부 소유자 ID, 표시 모드/이름, 생성 시각을 저장한다.
-- 익명 물고기도 owner_id 는 반드시 저장한다(삭제 권한 검증 전용, REQ-OWN-004).

CREATE TABLE IF NOT EXISTS fish (
    -- 물고기 고유 식별자.
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 스트로크 기반 벡터 그림(직렬화). JSONB 로 저장해 검증된 구조만 들어온다.
    drawing      JSONB NOT NULL,

    -- 내부 소유자(인증된 Teams 사용자 ID). 화면에 절대 노출하지 않는다(REQ-OWN-004).
    owner_id     TEXT NOT NULL,

    -- 표시 모드: 이름 표시 또는 익명.
    display_mode TEXT NOT NULL CHECK (display_mode IN ('named', 'anonymous')),

    -- 표시 이름. 익명일 때는 NULL.
    display_name TEXT,

    -- 생성 시각(영구 보존, 무기한 표시).
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 소유권 기반 삭제(M4) 및 소유자별 조회를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_fish_owner_id ON fish (owner_id);

-- 진입 시 전체 물고기 로드(M3)를 위한 생성순 인덱스.
CREATE INDEX IF NOT EXISTS idx_fish_created_at ON fish (created_at);
