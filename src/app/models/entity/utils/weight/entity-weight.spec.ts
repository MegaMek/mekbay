// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBipedMekEntity, TestInfantryEntity, TestTankEntity } from '../../testing/test-entities';

describe('entity effective tonnage', () => {
  it('calculates Mek construction mass through the entity authority', () => {
    const loadoutTonnage = new TestBipedMekEntity().loadoutTonnage();
    expect(Number.isFinite(loadoutTonnage)).toBeTrue();
    expect(loadoutTonnage).toBeGreaterThanOrEqual(0);
  });

  it('calculates infantry construction mass independently through loadoutTonnage', () => {
    const entity = new TestInfantryEntity();
    entity.squadSize.set(10);
    entity.squadCount.set(2);

    expect(entity.loadoutTonnage()).toBe(2);

    entity.squadSize.set(20);
    expect(entity.loadoutTonnage()).toBe(3.5);
  });

  it('calculates vehicle construction mass without substituting declared tonnage', () => {
    const entity = new TestTankEntity();
    entity.setTonnage(50);

    expect(entity.tonnage()).toBe(50);
    expect(entity.loadoutTonnage()).not.toBe(entity.tonnage());
  });
});
