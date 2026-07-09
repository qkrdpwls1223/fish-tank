// @MX:NOTE: [AUTO] PostgreSQL 연결 풀 팩토리. 자격 증명은 DATABASE_URL 환경변수에서만
//   읽으며 코드에 하드코딩하지 않는다(NFR-SEC). 프로덕션 진입점에서만 사용한다.
import pg from "pg";

/**
 * 환경 변수에서 pg 연결 풀을 만든다.
 * @param {Record<string,string|undefined>} env
 * @returns {import('pg').Pool}
 */
export function createPoolFromEnv(env) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("환경 변수 DATABASE_URL 이 필요합니다.");
  }
  return new pg.Pool({ connectionString });
}
