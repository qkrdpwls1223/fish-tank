// 테스트용 토큰 발급 유틸리티.
// 라이브 Teams 테넌트 없이 Teams SSO 토큰을 흉내내기 위해 로컬 RSA 키쌍으로
// JWT를 서명하고, 대응하는 로컬 JWKS(키셋 리졸버)를 제공한다.
// 이 파일은 테스트 인프라이며 프로덕션 코드가 아니다.
import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  createLocalJWKSet,
} from "jose";

export const TEST_KID = "test-key-1";
export const TEST_ISSUER =
  "https://login.microsoftonline.com/test-tenant-id/v2.0";
export const TEST_AUDIENCE = "api://fish-tank-client-id";

// 유효한 키쌍 + 로컬 JWKS 리졸버를 생성한다.
export async function createKeyMaterial() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = TEST_KID;
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const jwks = createLocalJWKSet({ keys: [publicJwk] });
  return { privateKey, jwks };
}

// 지정한 개인키로 클레임을 서명한 토큰을 만든다.
// overrides 로 iss/aud/exp/클레임을 바꿔 실패 케이스를 구성한다.
export async function makeToken(privateKey, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const {
    issuer = TEST_ISSUER,
    audience = TEST_AUDIENCE,
    exp = now + 3600,
    iat = now,
    claims = {},
    kid = TEST_KID,
  } = overrides;

  const payload = {
    oid: "user-oid-123",
    name: "홍길동",
    tid: "test-tenant-id",
    ...claims,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setIssuer(issuer)
    .setAudience(audience)
    .sign(privateKey);
}
