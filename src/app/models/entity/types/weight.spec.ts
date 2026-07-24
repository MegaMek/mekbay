import {
  ASF_WEIGHT_LIMITS,
  CAPITAL_SHIP_WEIGHT_LIMITS,
  DROPSHIP_WEIGHT_LIMITS,
  GUN_EMPLACEMENT_WEIGHT_LIMITS,
  MEK_WEIGHT_LIMITS,
  PROTOMEK_WEIGHT_LIMITS,
  resolveSupportVehicleWeightClass,
  resolveWeightClass,
  VEHICLE_WEIGHT_LIMITS,
  WEIGHT_CLASSES,
  type WeightClass,
  type WeightClassTable,
  weightClassCode,
} from './weight';
import type { MotiveType } from './motive';

describe('weight classes', () => {
  const tables: readonly [string, WeightClassTable, readonly WeightClass[]][] = [
    ['Mek', MEK_WEIGHT_LIMITS, ['Ultra Light', 'Light', 'Medium', 'Heavy', 'Assault', 'Super Heavy']],
    ['vehicle', VEHICLE_WEIGHT_LIMITS, ['Light', 'Medium', 'Heavy', 'Assault', 'Super Heavy']],
    ['gun emplacement', GUN_EMPLACEMENT_WEIGHT_LIMITS, ['Light', 'Medium', 'Heavy', 'Assault']],
    ['aerospace fighter', ASF_WEIGHT_LIMITS, ['Light', 'Medium', 'Heavy']],
    ['DropShip', DROPSHIP_WEIGHT_LIMITS, ['Small DropShip', 'Medium DropShip', 'Large DropShip']],
    ['capital ship', CAPITAL_SHIP_WEIGHT_LIMITS, ['Small Capital', 'Large Capital']],
    ['ProtoMek', PROTOMEK_WEIGHT_LIMITS, ['Light', 'Medium', 'Heavy', 'Assault', 'Super Heavy']],
  ];

  for (const [name, table, classes] of tables) {
    it(`resolves every ${name} boundary and fallback`, () => {
      table.bands.forEach((band, index) => {
        expect(resolveWeightClass(band.maxInclusive, table)).toBe(classes[index]);
        expect(resolveWeightClass(band.maxInclusive + 0.01, table)).toBe(classes[index + 1]);
      });
      expect(resolveWeightClass(Number.MAX_SAFE_INTEGER, table)).toBe(classes[classes.length - 1]);
    });
  }

  it('uses the explicit fallback for non-finite tonnage', () => {
    expect(resolveWeightClass(Infinity, MEK_WEIGHT_LIMITS)).toBe('Super Heavy');
    expect(resolveWeightClass(Number.NaN, MEK_WEIGHT_LIMITS)).toBe('Super Heavy');
  });

  const supportLimits: readonly [MotiveType, number][] = [
    ['Wheeled', 80],
    ['Tracked', 100],
    ['Hover', 50],
    ['VTOL', 30],
    ['WiGE', 80],
    ['Naval', 300],
    ['Hydrofoil', 300],
    ['Submarine', 300],
    ['Rail', 300],
    ['MagLev', 300],
    ['Aerodyne', 100],
    ['Airship', 300],
    ['Station Keeping', 100],
  ];

  for (const [motiveType, mediumLimit] of supportLimits) {
    it(`resolves ${motiveType} support-vehicle boundaries`, () => {
      expect(resolveSupportVehicleWeightClass(4.999, motiveType)).toBe('Small Support');
      expect(resolveSupportVehicleWeightClass(5, motiveType)).toBe('Medium Support');
      expect(resolveSupportVehicleWeightClass(mediumLimit, motiveType)).toBe('Medium Support');
      expect(resolveSupportVehicleWeightClass(mediumLimit + 0.01, motiveType)).toBe('Large Support');
    });
  }

  it('does not reinterpret unknown support motives as tracked', () => {
    expect(resolveSupportVehicleWeightClass(4, 'None')).toBe('Medium Support');
    expect(resolveSupportVehicleWeightClass(120, 'None')).toBe('Medium Support');
  });

  it('keeps numeric codes aligned with the canonical class list', () => {
    WEIGHT_CLASSES.forEach((weightClass, code) => {
      expect(weightClassCode(weightClass)).toBe(code);
    });
  });
});