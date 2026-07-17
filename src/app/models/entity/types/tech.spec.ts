import {
  DATE_ES,
  DATE_PS,
  approx,
  calculateTechLevel,
  calculateCompoundTechLevel,
  compareTechLevels,
  findMinimumTechLevel,
  getTechIntroductionYear,
  getTechMilestoneYear,
  isTechAvailableForBase,
  isTechExtinct,
  isCompoundTechLevelLegal,
  isTechnologyAvailable,
  parseTechDate,
  type TechLevelCalculation,
} from './tech';
import { createEquipment } from '../../equipment.model';

describe('technology level calculation', () => {
  const standardTechnology: TechLevelCalculation = {
    level: 'Standard',
    dates: {
      prototype: 3000,
      production: 3010,
      common: 3020,
      extinct: 3030,
      reintroduced: 3040,
    },
  };

  it('parses pre-spaceflight and early-spaceflight date sentinels', () => {
    expect(parseTechDate('PS')).toBe(DATE_PS);
    expect(parseTechDate('ES')).toBe(DATE_ES);
    expect(parseTechDate('~PS')).toEqual(approx(DATE_PS));
    expect(parseTechDate('~ES')).toEqual(approx(DATE_ES));
  });

  it('calculates each effective simple level by year', () => {
    expect(calculateTechLevel(standardTechnology, { year: 2999, techBase: 'IS' })).toBe('Unofficial');
    expect(calculateTechLevel(standardTechnology, { year: 3000, techBase: 'IS' })).toBe('Experimental');
    expect(calculateTechLevel(standardTechnology, { year: 3010, techBase: 'IS' })).toBe('Advanced');
    expect(calculateTechLevel(standardTechnology, { year: 3020, techBase: 'IS' })).toBe('Standard');
  });

  it('preserves static introductory and unofficial classifications', () => {
    expect(calculateTechLevel(
      { ...standardTechnology, level: 'Introductory' },
      { year: 3020, techBase: 'IS' },
    )).toBe('Introductory');
    expect(calculateTechLevel(
      { ...standardTechnology, level: 'Unofficial' },
      { year: 9999, techBase: 'IS' },
    )).toBe('Unofficial');
  });

  it('resolves split IS and Clan progression dates', () => {
    const technology: TechLevelCalculation = {
      level: 'Standard',
      dates: {
        is: { common: 3050 },
        clan: { common: 3000 },
      },
    };
    expect(calculateTechLevel(technology, { year: 3025, techBase: 'IS' })).toBe('Unofficial');
    expect(calculateTechLevel(technology, { year: 3025, techBase: 'Clan' })).toBe('Standard');
  });

  it('applies approximate margins in the MegaMek direction', () => {
    const technology: TechLevelCalculation = {
      level: 'Standard',
      dates: { prototype: approx(3000), extinct: approx(3050) },
    };
    expect(getTechMilestoneYear(technology, 'prototype', { techBase: 'IS' })).toBe(2995);
    expect(getTechMilestoneYear(technology, 'extinct', { techBase: 'IS' })).toBe(3055);
  });

  it('delays prototype and production access for other factions', () => {
    const technology: TechLevelCalculation = {
      level: 'Standard',
      dates: { prototype: 3000, production: 3020, common: 3050 },
      factions: { prototype: ['FS'], production: ['LC'] },
    };
    expect(getTechMilestoneYear(technology, 'prototype', { techBase: 'IS', faction: 'FS' })).toBe(3000);
    expect(getTechMilestoneYear(technology, 'prototype', { techBase: 'IS', faction: 'DC' })).toBe(3008);
    expect(getTechMilestoneYear(technology, 'production', { techBase: 'IS', faction: 'LC' })).toBe(3020);
    expect(getTechMilestoneYear(technology, 'production', { techBase: 'IS', faction: 'DC' })).toBe(3030);
  });

  it('finds the minimum rules level independently or by tech base', () => {
    expect(findMinimumTechLevel(standardTechnology)).toBe('Standard');
    expect(findMinimumTechLevel({ level: 'Standard', dates: { production: 3010 } })).toBe('Advanced');
    expect(findMinimumTechLevel({ level: 'Standard', dates: { prototype: 3000 } })).toBe('Experimental');
    expect(findMinimumTechLevel({ level: 'Standard', dates: {} })).toBe('Unofficial');
  });

  it('treats extinction as beginning after its stated year and ending at reintroduction', () => {
    expect(isTechExtinct(standardTechnology, { year: 3030, techBase: 'IS' })).toBeFalse();
    expect(isTechExtinct(standardTechnology, { year: 3031, techBase: 'IS' })).toBeTrue();
    expect(isTechExtinct(standardTechnology, { year: 3040, techBase: 'IS' })).toBeFalse();
    expect(isTechAvailableForBase(standardTechnology.dates, 'IS', 3030)).toBeTrue();
    expect(isTechAvailableForBase(standardTechnology.dates, 'IS', 3031)).toBeFalse();
  });

  it('keeps recovered Inner Sphere technology available to ComStar', () => {
    expect(isTechExtinct(standardTechnology, { year: 3035, techBase: 'IS', faction: 'CS' })).toBeFalse();
  });

  it('exposes introduction, availability, ordering, and compound legality', () => {
    expect(getTechIntroductionYear(standardTechnology, { techBase: 'IS' })).toBe(3000);
    expect(isTechnologyAvailable(standardTechnology, { year: 3000, techBase: 'IS' })).toBeTrue();
    expect(calculateCompoundTechLevel(standardTechnology, { year: 3010, techBase: 'Clan' }))
      .toEqual({ level: 'Advanced', scope: 'Clan' });
    expect(compareTechLevels('Advanced', 'Standard')).toBeGreaterThan(0);
    expect(isCompoundTechLevelLegal(
      { level: 'Standard', scope: 'TW' },
      { level: 'Advanced', scope: 'Clan' },
    )).toBeTrue();
    expect(isCompoundTechLevelLegal(
      { level: 'Experimental', scope: 'IS' },
      { level: 'Advanced', scope: 'IS' },
    )).toBeFalse();
    expect(isCompoundTechLevelLegal(
      { level: 'Standard', scope: 'Clan' },
      { level: 'Advanced', scope: 'All' },
    )).toBeTrue();
    expect(isCompoundTechLevelLegal(
      { level: 'Standard', scope: 'All Clan' },
      { level: 'Introductory', scope: 'Clan' },
    )).toBeTrue();
  });

  it('makes calculated technology available directly from equipment', () => {
    const equipment = createEquipment({
      id: 'Test Armor',
      name: 'Test Armor',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: {
        base: 'All',
        level: 'Standard',
        advancement: { is: { prototype: '3000', production: '3010', common: '3020' } },
      },
    });

    expect(equipment.getTechLevel(3010, 'IS')).toBe('Advanced');
    expect(equipment.getCompoundTechLevel(3020, 'IS')).toEqual({ level: 'Standard', scope: 'IS' });
    expect(equipment.isAvailableIn(2999, 'IS')).toBeFalse();
  });
});