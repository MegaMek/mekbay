// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import * as entities from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('Record sheet inventory rows', () => {
    for (const Family of [entities.TestBipedMekEntity, entities.TestTankEntity, entities.TestAeroSpaceFighterEntity]) {
        it(Family.name + ': prints one inventory row per long-named weapon in sparse and dense tables', async () => {
            for (const count of [2, 10]) {
                const entity = new Family();
                const name = 'Medium Re-engineered Laser With Extended Targeting';
                for (let index = 0; index < count; index++) addTestEquipment(entity, new WeaponEquipment({
                    id: 'Wrapping laser ' + index, name: name + ' ' + index, type: 'weapon',
                    weapon: { damage: 6, heat: 7, ranges: [3, 6, 9] },
                }), { location: entity.locationOrder[0] });
                const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
                const rows = Array.from(svg.querySelectorAll<SVGGElement>('.inventoryEntry'))
                    .filter(row => row.querySelector('.name')?.textContent?.startsWith(name));
                expect(rows.length).toBe(count);
            }
        });
    }
});

describe('Record sheet inventory badges', () => {
    const families = [
        entities.TestBipedMekEntity, entities.TestTankEntity, entities.TestProtoMekEntity, entities.TestBattleArmorEntity,
        entities.TestAeroSpaceFighterEntity, entities.TestSmallCraftEntity, entities.TestWarShipEntity,
        entities.TestHandheldWeaponEntity,
    ];
    for (const Family of families) {
        it(`${Family.name}: gives every weapon row the hit-modifier and target-number badges the binders fill`, async () => {
            const entity = new Family();
            const mount = addTestEquipment(entity, new WeaponEquipment({
                id: 'Badge Laser', name: 'Medium Laser', type: 'weapon',
                weapon: { damage: 5, heat: 3, ranges: [3, 6, 9], av: [5, 5, 0, 0] },
            }), { location: entity.locationOrder[0] });
            if (entity instanceof entities.TestWarShipEntity) entity.addEquipmentBay('weapon-bay', { mounts: [mount] });
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
            const rows = Array.from(svg.querySelectorAll<SVGGElement>('.inventoryEntry[id]'))
                .filter(row => row.getAttribute('data-mekbay-component-ids')?.split(' ').includes(mount.mountId));
            expect(rows.length).toBeGreaterThan(0);
            for (const row of rows) {
                const badge = (selector: string) => row.querySelector<SVGElement>(`:scope > ${selector}`)!;
                for (const selector of ['.hitMod-rect', '.hitMod-text', '.targetTn-rect', '.targetTn-text']) {
                    expect(badge(selector)).withContext(selector).not.toBeNull();
                    expect(badge(selector).getAttribute('display')).withContext(selector).toBe('none');
                }
            }
        });
    }
});
