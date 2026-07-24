/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version.
 */

import { StructureEquipment } from '../../equipment.model';
import { MountedStructure, STANDARD_STRUCTURE_EQUIPMENT } from './structure';

describe('MountedStructure', () => {
  it('compares complete effective structures including tonnage', () => {
    const equivalentStandard = new StructureEquipment({
      id: 'Standard', name: 'Standard', type: 'structure',
      tech: { base: 'All' }, structure: { typeId: 0 },
    });
    const sixtyTonStandard = new MountedStructure({
      tonnage: 60, structure: STANDARD_STRUCTURE_EQUIPMENT,
    });
    const equivalent = new MountedStructure({ tonnage: 60, structure: equivalentStandard });
    const seventyTonStandard = new MountedStructure({
      tonnage: 70, structure: STANDARD_STRUCTURE_EQUIPMENT,
    });

    expect(sixtyTonStandard.equals(equivalent)).toBeTrue();
    expect(sixtyTonStandard.equals(seventyTonStandard)).toBeFalse();
    expect(sixtyTonStandard.hasSameMaterialAs(seventyTonStandard)).toBeTrue();
  });

  it('compares resolved material identity and technology independently of tonnage', () => {
    const innerSphereEndo = new StructureEquipment({
      id: 'IS Endo Steel', name: 'Endo Steel', type: 'structure',
      tech: { base: 'IS' }, structure: { typeId: 1 },
    });
    const clanEndo = new StructureEquipment({
      id: 'Clan Endo Steel', name: 'Endo Steel', type: 'structure',
      tech: { base: 'Clan' }, structure: { typeId: 1 },
    });
    const innerSphere = new MountedStructure({ tonnage: 60, structure: innerSphereEndo });
    const clan = new MountedStructure({ tonnage: 60, structure: clanEndo });

    expect(innerSphere.hasSameMaterialAs(clan)).toBeFalse();
    expect(innerSphere.equals(clan)).toBeFalse();
  });

  it('creates immutable tonnage variants and reuses an unchanged value', () => {
    const structure = new MountedStructure({
      tonnage: 60, structure: STANDARD_STRUCTURE_EQUIPMENT,
    });

    expect(Object.isFrozen(structure)).toBeTrue();
    expect(structure.withTonnage(60)).toBe(structure);
    expect(structure.withTonnage(70)).toEqual(jasmine.objectContaining({
      tonnage: 70,
      structure: STANDARD_STRUCTURE_EQUIPMENT,
    }));
    expect(structure.tonnage).toBe(60);
  });

  it('rejects invalid effective tonnage', () => {
    expect(() => new MountedStructure({
      tonnage: -1, structure: STANDARD_STRUCTURE_EQUIPMENT,
    })).toThrowError(
      'Structure tonnage must be a non-negative finite number, got -1',
    );
    expect(() => new MountedStructure({
      tonnage: Number.NaN, structure: STANDARD_STRUCTURE_EQUIPMENT,
    })).toThrowError(
      'Structure tonnage must be a non-negative finite number, got NaN',
    );
  });
});
