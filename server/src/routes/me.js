import { Router } from "express";

// 인증된 사용자 신원을 돌려주는 보호 라우트.
// REQ-AUTH-002: 검증된 신원이 모든 쓰기 작업의 근거임을 종단으로 증명한다.
export function meRouter() {
  const router = Router();
  router.get("/me", (req, res) => {
    res.json(req.user);
  });
  return router;
}
