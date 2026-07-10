-- 내 어항(개인 어항) 테이블. 공유 어항(001)·수집함(002)과 독립된 추가 기능이다.
-- 소유자 전용: 오직 소유자만 조회/추가/이동/삭제할 수 있으며, 공유 어항으로 공유되지 않는다.
-- owner_id 는 화면에 절대 노출하지 않고(공개 투영에서 제거) 소유권 검증 전용으로만 쓴다.

-- 사용자가 자기 어항에 직접 그려 넣은 물고기(공유 어항으로 브로드캐스트되지 않는 비공개 물고기).
CREATE TABLE IF NOT EXISTS my_tank_fish (
    -- 물고기 고유 식별자.
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 내부 소유자(인증된 Teams 사용자의 토큰 oid). 어항은 이 값으로 스코프된다. 화면 비노출.
    owner_id     TEXT NOT NULL,

    -- 스트로크 기반 벡터 그림(직렬화). JSONB 로 저장해 검증된 구조만 들어온다.
    drawing      JSONB NOT NULL,

    -- 표시 모드: 이름 표시 또는 익명.
    display_mode TEXT NOT NULL CHECK (display_mode IN ('named', 'anonymous')),

    -- 표시 이름. 익명일 때는 NULL. 값은 검증된 토큰 신원에서만 유도한다(클라이언트 불신).
    display_name TEXT,

    -- 어항 내 배치 위치.
    x            DOUBLE PRECISION NOT NULL,
    y            DOUBLE PRECISION NOT NULL,

    -- 생성 시각.
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 소유자별 조회(스코프)를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_my_tank_fish_owner_id ON my_tank_fish (owner_id);

-- 어항 장식 아이템(수초/바위/성 등). 종류는 애플리케이션 화이트리스트로 강제한다.
CREATE TABLE IF NOT EXISTS my_tank_decor (
    -- 장식 고유 식별자.
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 내부 소유자. 어항은 이 값으로 스코프된다. 화면 비노출.
    owner_id   TEXT NOT NULL,

    -- 장식 종류(seaweed/rock/castle 등). 허용 목록은 애플리케이션 계층에서 검증한다.
    kind       TEXT NOT NULL,

    -- 어항 내 배치 위치.
    x          DOUBLE PRECISION NOT NULL,
    y          DOUBLE PRECISION NOT NULL,

    -- 생성 시각.
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 소유자별 조회(스코프)를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_my_tank_decor_owner_id ON my_tank_decor (owner_id);
