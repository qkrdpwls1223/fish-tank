-- 내 어항 아이템(물고기/장식)에 개별 크기(scale) 컬럼을 추가한다.
-- 사용자가 배치한 각 아이템을 개별적으로 확대·축소할 수 있게 한다.
-- 기존 행/기능과 하위 호환: NOT NULL DEFAULT 1.0 이라 기존 행은 원본 크기(1.0)를 유지한다.
-- 애플리케이션 계층에서 [0.3, 3.0] 범위를 검증한다(scale.js).

-- 물고기 개별 크기(배율). 1.0 = 원본 크기.
ALTER TABLE my_tank_fish ADD COLUMN scale DOUBLE PRECISION NOT NULL DEFAULT 1.0;

-- 장식 개별 크기(배율). 1.0 = 원본 크기.
ALTER TABLE my_tank_decor ADD COLUMN scale DOUBLE PRECISION NOT NULL DEFAULT 1.0;
