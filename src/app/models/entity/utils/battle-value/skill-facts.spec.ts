// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InfantryEntity } from '../../entities/infantry/infantry-entity';
import { BipedMekEntity } from '../../entities/mek/biped-mek-entity';
import { ProtoMekEntity } from '../../entities/protomek/protomek-entity';
import { createTestEquipmentRegistry } from '../../testing/test-equipment-registry';
import { effectiveEntityPilotingSkill, fixedEntityPilotingSkill } from './skill-facts';

describe('Entity crew-skill facts', () => {
  it('uses the loaded Entity family instead of catalog-summary fields', () => {
    const registry = createTestEquipmentRegistry();
    expect(effectiveEntityPilotingSkill(new BipedMekEntity(registry), 2)).toBe(2);
    expect(effectiveEntityPilotingSkill(new ProtoMekEntity(registry), 2)).toBe(5);

    const conventional = new InfantryEntity(registry);
    expect(fixedEntityPilotingSkill(conventional)).toBe(8);
    expect(effectiveEntityPilotingSkill(conventional, 2)).toBe(8);

    conventional.motiveType.set('Tracked');
    expect(fixedEntityPilotingSkill(conventional)).toBe(5);
    expect(effectiveEntityPilotingSkill(conventional, 2)).toBe(5);
  });
});
