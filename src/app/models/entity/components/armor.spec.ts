/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the GNU General Public License (GPL),
 * version 3 or (at your option) any later version.
 */

import { ArmorEquipment } from '../../equipment.model';
import { MountedArmor } from './armor';

describe('MountedArmor', () => {
  it('derives armor identity from resolved equipment', () => {
    const hardened = new ArmorEquipment({
      id: 'Hardened Armor',
      name: 'Hardened',
      type: 'armor',
      armor: { type: 'HARDENED' },
      tech: { base: 'IS' },
    });
    const mounted = new MountedArmor({ armor: hardened });

    expect(mounted.armor).toBe(hardened);
    expect(mounted.type).toBe('HARDENED');
    expect(mounted.techBase).toBe('IS');
    expect(Object.isFrozen(mounted)).toBeTrue();
  });

  it('compares complete installation semantics', () => {
    const standard = new ArmorEquipment({
      id: 'Standard Armor',
      name: 'Standard',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All' },
    });
    const equivalentStandard = new ArmorEquipment({
      id: standard.id,
      name: 'Equivalent Standard',
      type: 'armor',
      armor: { type: 'STANDARD' },
      tech: { base: 'All' },
    });
    const innerSphere = new MountedArmor({
      armor: standard,
      techBase: 'IS',
      technology: { level: 'Introductory', scope: 'IS' },
      techRating: 'D',
    });
    const equivalent = new MountedArmor({
      armor: equivalentStandard,
      techBase: 'IS',
      technology: { level: 'Introductory', scope: 'IS' },
      techRating: 'D',
    });
    const clan = new MountedArmor({
      armor: standard,
      techBase: 'Clan',
      technology: { level: 'Introductory', scope: 'Clan' },
      techRating: 'D',
    });

    expect(innerSphere.equals(equivalent)).toBeTrue();
    expect(innerSphere.equals(clan)).toBeFalse();
  });

  it('rejects Patchwork as location armor', () => {
    const patchwork = new ArmorEquipment({
      id: 'Patchwork Armor',
      name: 'Patchwork',
      type: 'armor',
      armor: { type: 'PATCHWORK' },
    });

    expect(() => new MountedArmor({ armor: patchwork })).toThrowError(
      'Patchwork is an entity layout, not an installable location armor',
    );
  });
});
