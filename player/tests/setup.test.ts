import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PLAYER_VERSION } from '../src/index';

describe('Player project setup', () => {
  it('should have a valid version string', () => {
    expect(PLAYER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should support fast-check property testing', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (n) => {
        return n >= 0 && n <= 100;
      })
    );
  });
});
