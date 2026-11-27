// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { StaticEmplacementEntity } from '../../models/entity/entities/misc/static-emplacement-entity';
import { TEST_EQUIPMENT_REGISTRY } from '../../models/entity/testing/test-equipment-registry';
import * as entities from '../../models/entity/testing/test-entities';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('record sheet battle value', () => {
    const families = [
        entities.TestBipedMekEntity, entities.TestTankEntity, entities.TestProtoMekEntity,
        entities.TestBattleArmorEntity, entities.TestInfantryEntity, entities.TestAeroSpaceFighterEntity,
        entities.TestSmallCraftEntity, entities.TestDropShipEntity, entities.TestWarShipEntity,
        entities.TestHandheldWeaponEntity, StaticEmplacementEntity,
    ];
    for (const Family of families) {
        it(`${Family.name}: groups BV digits like MegaMekLab`, async () => {
            const entity = new Family(TEST_EQUIPMENT_REGISTRY);
            spyOn(entity, 'battleValue').and.returnValue(12_345);
            const sheet = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            const bv = sheet.querySelector('#bv')?.textContent ?? '';
            // Infantry and battle armor print the skill-adjusted squad value before any per-trooper suffix.
            expect(bv).toMatch(/^\d{1,3}(?:,\d{3})+(?:\/[\d,]+)?$/u);
        });
    }
});
