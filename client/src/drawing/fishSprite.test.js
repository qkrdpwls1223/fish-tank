import { describe, it, expect, vi } from "vitest";
import {
  spriteSignature,
  createSpriteCache,
  drawFishBitmap,
  phaseFromId,
  SPRITE_SCALE,
} from "./fishSprite.js";

// 물고기 스프라이트 공용 캐싱/blit 모듈 검증 (SPEC-RASTER-001 M3, REQ-RENDER-001/002/003, REQ-ANIM).
// 실제 캔버스 픽셀은 jsdom 에서 검증 불가하므로(getContext=null) 서명/캐시 무효화/blit 영역 분할을
// 순수 로직으로 검증한다. drawFishBitmap 은 기록형 mock ctx 로 drawImage 호출을 관찰한다.

// drawImage 호출을 기록하는 mock 2D 컨텍스트.
function mockCtx() {
  const calls = [];
  return {
    calls,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn((...args) => calls.push(args)),
  };
}

// ready 상태의 가짜 캐시 엔트리(오프스크린 캔버스는 임의 객체로 충분 — drawImage 의 소스로만 쓰임).
function readyEntry(over = {}) {
  return {
    canvas: { tag: "offscreen" },
    width: 100,
    height: 60,
    foldX: 40, // tailFraction 0.4
    mouthX: 72, // mouthFraction 0.72
    ready: true,
    ...over,
  };
}

describe("spriteSignature", () => {
  it("벡터 그림은 버전·크기·가이드·획/점 수로 서명한다", () => {
    const v1 = {
      version: 1,
      width: 100,
      height: 60,
      tailFraction: 0.4,
      mouthFraction: 0.72,
      strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
    };
    expect(spriteSignature(v1)).toBe("1:100x60:0.4:0.72:v1.2");
  });

  it("래스터 그림은 이미지 길이로 서명한다(내용 변경 시 서명이 바뀜)", () => {
    const base = {
      version: 2,
      kind: "raster",
      width: 100,
      height: 60,
      tailFraction: 0.4,
      mouthFraction: 0.72,
      image: "data:image/png;base64,AAAA",
    };
    expect(spriteSignature(base)).toBe("2:100x60:0.4:0.72:r26");
    expect(spriteSignature({ ...base, image: base.image + "BBBB" })).not.toBe(
      spriteSignature(base),
    );
  });

  it("그림이 없으면 none", () => {
    expect(spriteSignature(null)).toBe("none");
  });
});

describe("createSpriteCache", () => {
  it("같은 그림은 한 번만 빌드하고 이후엔 캐시를 재사용한다(REQ-RENDER-001)", () => {
    const build = vi.fn((d) => ({ ...readyEntry(), _d: d }));
    const cache = createSpriteCache(build);
    const sprite = { id: "a", drawing: { version: 1, width: 100, height: 60, strokes: [] } };
    const first = cache.getEntry(sprite);
    const second = cache.getEntry(sprite);
    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("그림 내용이 바뀌면 캐시를 무효화하고 다시 빌드한다(REQ-RENDER-002)", () => {
    const build = vi.fn(() => readyEntry());
    const cache = createSpriteCache(build);
    cache.getEntry({ id: "a", drawing: { version: 1, width: 100, height: 60, strokes: [] } });
    cache.getEntry({
      id: "a",
      drawing: {
        version: 1,
        width: 100,
        height: 60,
        strokes: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      },
    });
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("prune 는 현재 없는 물고기의 캐시만 축출한다(무한 증가 방지)", () => {
    const cache = createSpriteCache(() => readyEntry());
    cache.getEntry({ id: "a", drawing: { version: 1, width: 1, height: 1, strokes: [] } });
    cache.getEntry({ id: "b", drawing: { version: 1, width: 1, height: 1, strokes: [] } });
    expect(cache.size).toBe(2);
    cache.prune(new Set(["a"]));
    expect(cache.size).toBe(1);
  });

  it("그림/ id 가 없으면 null 을 돌려주고 빌드하지 않는다", () => {
    const build = vi.fn(() => readyEntry());
    const cache = createSpriteCache(build);
    expect(cache.getEntry({ id: "a" })).toBeNull();
    expect(cache.getEntry({ drawing: {} })).toBeNull();
    expect(build).not.toHaveBeenCalled();
  });
});

describe("drawFishBitmap", () => {
  it("래스터 디코드 전(ready=false)이면 그리지 않는다(false 반환)", () => {
    const ctx = mockCtx();
    const drew = drawFishBitmap(ctx, readyEntry({ ready: false }), { id: "a", x: 0, y: 0 }, 0);
    expect(drew).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it("먹이를 안 먹을 때(eat=0): 몸통 1 + 꼬리 스트립 24 + 입 통짜 1 = 26회 blit", () => {
    const ctx = mockCtx();
    const drew = drawFishBitmap(ctx, readyEntry(), { id: "a", x: 100, y: 50, facing: 1 }, 100);
    expect(drew).toBe(true);
    // 몸통(foldX~mouthX) 1회 + 꼬리 24 스트립 + 입 통짜 1회.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1 + 24 + 1);
    // 몸통 blit: 소스가 foldX(40)에서 폭 mouthX-foldX(32), 전체 높이 60.
    expect(ctx.calls[0].slice(1)).toEqual([40, 0, 32, 60, 40, 0, 32, 60]);
    // 스프라이트 위치/방향·축소 변환이 적용된다.
    expect(ctx.translate).toHaveBeenCalledWith(100, 50);
    expect(ctx.scale).toHaveBeenCalledWith(SPRITE_SCALE, SPRITE_SCALE);
  });

  it("먹이 반응(eat>0)일 때: 입 영역이 위/아래 절반 스트립으로 나뉘어 더 많이 blit 된다(입 벌림)", () => {
    // now 를 골라 chomp>0 이 되게 한다(t=0 이면 chomp=0 → gape=0). t=0.2s 근처면 벌어진다.
    const now = 200;
    const ctx = mockCtx();
    drawFishBitmap(ctx, readyEntry(), { id: "a", x: 0, y: 0, facing: 1, eat: 1 }, now);
    // 몸통 1 + 꼬리 24 + 입(16 스트립 × 위/아래 2) 32 = 57회.
    expect(ctx.drawImage).toHaveBeenCalledTimes(1 + 24 + 32);
  });

  it("facing=-1 이면 좌우 반전 스케일이 적용된다(진행 방향 반영)", () => {
    const ctx = mockCtx();
    drawFishBitmap(ctx, readyEntry(), { id: "a", x: 0, y: 0, facing: -1 }, 0);
    expect(ctx.scale).toHaveBeenCalledWith(-SPRITE_SCALE, SPRITE_SCALE);
  });

  it("itemScale 배수가 축소 비율에 곱해진다(내 어항 개별 크기)", () => {
    const ctx = mockCtx();
    drawFishBitmap(ctx, readyEntry(), { id: "a", x: 0, y: 0, facing: 1 }, 0, 2);
    expect(ctx.scale).toHaveBeenCalledWith(SPRITE_SCALE * 2, SPRITE_SCALE * 2);
  });
});

describe("phaseFromId", () => {
  it("같은 id 는 같은 위상, 다른 id 는 (대개) 다른 위상을 준다", () => {
    expect(phaseFromId("abc")).toBe(phaseFromId("abc"));
    expect(phaseFromId("abc")).not.toBe(phaseFromId("xyz"));
  });

  it("문자열이 아닌 id 도 안전하게 처리한다", () => {
    expect(() => phaseFromId(123)).not.toThrow();
    expect(() => phaseFromId(null)).not.toThrow();
  });
});
