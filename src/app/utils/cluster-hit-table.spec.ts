import { clusterHits } from './cluster-hit-table';

describe('clusterHits', () => {
  it('returns Java-compatible values at the roll boundaries', () => {
    expect(clusterHits(2, 6)).toBe(2);
    expect(clusterHits(12, 6)).toBe(6);
    expect(clusterHits(7, 40)).toBe(24);
  });

  it('returns zero for unsupported or invalid rack sizes', () => {
    expect(clusterHits(7, 0)).toBe(0);
    expect(clusterHits(7, 31)).toBe(0);
    expect(clusterHits(7, 2.5)).toBe(0);
  });

  it('rejects rolls outside the 2d6 result range', () => {
    expect(() => clusterHits(1, 6)).toThrowError(RangeError);
    expect(() => clusterHits(13, 6)).toThrowError(RangeError);
    expect(() => clusterHits(7.5, 6)).toThrowError(RangeError);
  });
});
