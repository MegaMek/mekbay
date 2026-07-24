import { calculateTurretWeight } from './battle-armor-weight';

describe('Battle Armor construction weight', () => {
  describe('turret weight', () => {
    it('calculates standard turret mass', () => {
      expect(calculateTurretWeight('Standard:2')).toBe(0.05);
    });

    it('adds the modular turret mass', () => {
      expect(calculateTurretWeight('Modular:3')).toBe(0.08);
      expect(calculateTurretWeight('Configurable:1')).toBe(0.06);
    });

    it('returns zero for absent, malformed, and zero-capacity turrets', () => {
      expect(calculateTurretWeight('')).toBe(0);
      expect(calculateTurretWeight('unknown')).toBe(0);
      expect(calculateTurretWeight('Standard:0')).toBe(0);
    });
  });
});