// @MX:ANCHOR: [AUTO] 인증 미들웨어 — 모든 보호 라우트의 진입 관문
// @MX:REASON: NFR-SEC-001. 향후 모든 쓰기 라우트(추가/삭제/먹이주기)가 이 미들웨어를
//   거친다(fan_in >= 3 예상). 클라이언트 body 신원은 절대 신뢰하지 않는다.
import { AuthError } from "./errors.js";

// Authorization 헤더에서 Bearer 토큰을 추출한다. 없으면 null.
function extractBearer(header) {
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

/**
 * 인증 필수 미들웨어를 생성한다.
 * @param {(token:string)=>Promise<{userId,displayName,tenantId}>} verify
 *   토큰 검증 함수(verifyTeamsToken 를 바인딩해 주입).
 */
export function authRequired(verify) {
  return async (req, res, next) => {
    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      return res
        .status(401)
        .json({ error: { code: "unauthorized", reason: "missing_token" } });
    }

    try {
      // 검증된 신원만 req.user 로 설정한다. 클라이언트 body 는 신뢰하지 않는다.
      req.user = await verify(token);
      return next();
    } catch (err) {
      const code = err instanceof AuthError ? err.code : "unauthorized";
      return res.status(401).json({ error: { code } });
    }
  };
}
