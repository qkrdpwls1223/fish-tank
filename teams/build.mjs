// Teams 앱 패키지 빌더.
// manifest.template.json 의 __TEAMS_APP_CLIENT_ID__ 를 환경 변수(또는 server/.env)로
// 치환하고, 아이콘 PNG(color 192px / outline 32px)를 생성한 뒤 zip 으로 묶는다.
//
// 사용법:  node teams/build.mjs
//   - TEAMS_APP_CLIENT_ID 환경 변수 또는 server/.env 의 같은 키를 읽는다.
//   - 산출물: teams/dist/{manifest.json,color.png,outline.png}, teams/fishtank-teams.zip
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(here, "dist");
const zipPath = path.join(here, "fishtank-teams.zip");

// --- 1. 클라이언트 ID 확보 (env → server/.env 순서) -----------------------
function readClientId() {
  if (process.env.TEAMS_APP_CLIENT_ID) return process.env.TEAMS_APP_CLIENT_ID;
  const envPath = path.join(here, "../server/.env");
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(
      /^\s*TEAMS_APP_CLIENT_ID\s*=\s*(\S+)\s*$/m,
    );
    if (m) return m[1];
  }
  return null;
}

const clientId = readClientId();
if (!clientId) {
  console.error(
    "TEAMS_APP_CLIENT_ID 를 찾지 못했습니다. 환경 변수로 지정하거나 server/.env 에 넣어 주세요.\n" +
      "(Azure Portal → 앱 등록에서 발급받는 애플리케이션(클라이언트) ID)",
  );
  process.exit(1);
}

// --- 2. 매니페스트 생성 ----------------------------------------------------
mkdirSync(distDir, { recursive: true });
const manifest = readFileSync(path.join(here, "manifest.template.json"), "utf8")
  .replaceAll("__TEAMS_APP_CLIENT_ID__", clientId);
JSON.parse(manifest); // 형식 검증(치환 후에도 유효한 JSON 인지)
writeFileSync(path.join(distDir, "manifest.json"), manifest);

// --- 3. 아이콘 PNG 생성 (외부 도구 없이 순수 Node) --------------------------
// 최소 PNG 인코더: 필터 0 스캔라인 + deflate + CRC32.
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, pixelAt) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0; // 필터 없음
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      raw.writeUInt32BE(((r << 24) | (g << 16) | (b << 8) | a) >>> 0, row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 오른쪽을 바라보는 물고기 실루엣(타원 몸통 + 삼각 꼬리) 판정.
function inFish(x, y, size) {
  const nx = x / size;
  const ny = y / size;
  // 몸통: 타원 중심(0.58, 0.5), 반지름(0.26, 0.17)
  const bx = (nx - 0.58) / 0.26;
  const by = (ny - 0.5) / 0.17;
  if (bx * bx + by * by <= 1) return true;
  // 꼬리: (0.36,0.5) 꼭짓점, (0.14,0.3)/(0.14,0.7) 밑변 삼각형
  if (nx >= 0.14 && nx <= 0.36) {
    const spread = 0.2 * ((0.36 - nx) / 0.22); // 꼭짓점에서 밑변으로 벌어짐
    if (Math.abs(ny - 0.5) <= spread) return true;
  }
  return false;
}
function inEye(x, y, size) {
  const dx = x / size - 0.68;
  const dy = y / size - 0.45;
  return dx * dx + dy * dy <= 0.032 * 0.032;
}

// color.png(192): 청록 배경 + 흰 물고기 + 배경색 눈.
const TEAL = [14, 124, 140, 255];
const colorPng = encodePng(192, 192, (x, y) => {
  if (inFish(x, y, 192)) return inEye(x, y, 192) ? TEAL : [255, 255, 255, 255];
  return TEAL;
});
writeFileSync(path.join(distDir, "color.png"), colorPng);

// outline.png(32): 투명 배경 + 흰 실루엣(Teams 규격: 흰색+투명만 허용).
const outlinePng = encodePng(32, 32, (x, y) =>
  inFish(x, y, 32) ? [255, 255, 255, 255] : [0, 0, 0, 0],
);
writeFileSync(path.join(distDir, "outline.png"), outlinePng);

// --- 4. zip 패키징 (외부 도구 없이 순수 Node, STORE 방식) --------------------
// Teams 패키지는 세 파일뿐이라 무압축 저장으로 충분하다.
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 로컬 파일 헤더 시그니처
    local.writeUInt16LE(20, 4); // 필요 버전
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 압축 크기(STORE=원본과 동일)
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 중앙 디렉터리 시그니처
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // 로컬 헤더 오프셋
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD 시그니처
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

writeFileSync(
  zipPath,
  buildZip([
    { name: "manifest.json", data: Buffer.from(manifest, "utf8") },
    { name: "color.png", data: colorPng },
    { name: "outline.png", data: outlinePng },
  ]),
);
console.log(`완료: ${zipPath}`);
