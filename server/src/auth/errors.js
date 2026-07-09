// 인증 관련 타입드 에러. code 로 실패 원인을 구분하여
// 미들웨어가 일관된 401 응답을 만들 수 있게 한다.
export class AuthError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}
