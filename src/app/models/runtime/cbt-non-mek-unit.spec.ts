// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { InfantryEntity } from '../entity/entities/infantry/infantry-entity';
import { createTestEquipmentRegistry } from '../entity/testing/test-equipment-registry';
import { asUnitUuid } from '../../services/unit-catalog/unit-catalog.types';
import { CBTNonMekUnit } from './cbt-non-mek-unit';

describe('CBTNonMekUnit', () => {
    it('canonicalizes default clone skills for a fixed-Piloting entity', () => {
        const entity = new InfantryEntity(createTestEquipmentRegistry());
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e8');
        entity.uuid.set(uuid);

        const unit = CBTNonMekUnit.create(entity, {
            instanceId: 'unit:fixed-piloting-clone',
            uuid,
            deployment: { id: 'default' },
            scenario: { id: 'megamek', ruleset: 'core-2026' },
            initialStateProfileId: 'pristine-non-mek-v1',
            crewSkills: { gunnery: 4, piloting: 5 },
        });

        const positions = unit.getCrewAssignment().positions;
        expect(positions.length).toBeGreaterThan(0);
        expect(positions.every(position => position.piloting === 8)).toBeTrue();
    });
});
