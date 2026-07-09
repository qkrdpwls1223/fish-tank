# fish-tank 프로덕션 이미지 (멀티스테이지).
# 1단계: 클라이언트 빌드, 2단계: 서버 런타임 + 정적 파일 서빙.
# TLS 는 서버 앞단의 nginx 컨테이너가 종단하므로 이 컨테이너는 HTTP(3000)로 동작한다.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci
COPY client client
COPY server server
RUN npm run build --workspace client

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
# 워크스페이스 전체의 프로덕션 의존성만 설치한다(dev 도구 제외).
# (--workspace 부분 설치는 호이스팅이 불완전해 런타임 모듈 누락이 발생했다.)
RUN npm ci --omit=dev
COPY server server
COPY --from=build /app/client/dist client/dist

ENV PORT=3000
ENV STATIC_DIR=/app/client/dist
EXPOSE 3000
# wget 은 alpine 기본 busybox 에 포함 — 헬스체크로 기동 상태를 노출한다.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/src/server.js"]
