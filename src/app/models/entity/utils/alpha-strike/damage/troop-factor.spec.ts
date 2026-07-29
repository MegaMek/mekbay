import { alphaStrikeTroopFactor } from './troop-factor';

describe('Alpha Strike troop factor', () => {
  it('returns canonical factors across the table', () => {
    expect([0, 1, 2, 5, 10, 20, 30].map(alphaStrikeTroopFactor))
      .toEqual([0, 0, 1, 3, 6, 12, 18]);
  });

  it('caps strengths above thirty', () => {
    expect(alphaStrikeTroopFactor(31)).toBe(18);
    expect(alphaStrikeTroopFactor(Number.MAX_SAFE_INTEGER)).toBe(18);
  });

  it('rejects invalid strengths', () => {
    expect(() => alphaStrikeTroopFactor(-1)).toThrowError(RangeError);
    expect(() => alphaStrikeTroopFactor(1.5)).toThrowError(RangeError);
    expect(() => alphaStrikeTroopFactor(Number.NaN)).toThrowError(RangeError);
  });
});
