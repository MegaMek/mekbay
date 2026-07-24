import { standardRound } from './large-craft-control-tonnage';

describe('large-craft control-system tonnage', () => {
  it('stabilizes exact upward half-ton boundaries at kilogram precision', () => {
    expect(standardRound(100 * 0.07)).toBe(7);
    expect(standardRound(7.001)).toBe(7.5);
    expect(standardRound(7.5)).toBe(7.5);
  });
});