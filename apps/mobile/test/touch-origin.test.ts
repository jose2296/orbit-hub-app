import { beforeEach, describe, expect, it } from 'vitest';

import { originFromLastTouch, recordTouch, resetTouchOrigin } from '@/lib/touch-origin';

describe('touch-origin', () => {
  beforeEach(() => resetTouchOrigin());

  it('has no origin before any touch', () => {
    expect(originFromLastTouch(1000)).toBeNull();
  });

  it('turns a recent touch into a small rectangle centred on the finger', () => {
    recordTouch(200, 400, 1000);
    expect(originFromLastTouch(1100)).toEqual({ x: 188, y: 388, width: 24, height: 24 });
  });

  it('forgets a touch that is too old to be what opened the sheet', () => {
    recordTouch(200, 400, 1000);
    expect(originFromLastTouch(1000 + 2001)).toBeNull();
  });

  it('keeps only the latest touch', () => {
    recordTouch(10, 10, 1000);
    recordTouch(300, 500, 1050);
    expect(originFromLastTouch(1100)).toEqual({ x: 288, y: 488, width: 24, height: 24 });
  });

  it('ignores a touch without usable coordinates', () => {
    recordTouch(Number.NaN, 10, 1000);
    expect(originFromLastTouch(1100)).toBeNull();
  });
});
