// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import {
    TestBattleArmorEntity,
    TestProtoMekEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { updateRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';

describe('generated non-Mek ammo rows', () => {
    const families = [
        { name: 'vehicle', create: () => new TestTankEntity() },
        { name: 'ProtoMek', create: () => new TestProtoMekEntity() },
        { name: 'Battle Armor', create: () => new TestBattleArmorEntity() },
    ];

    for (const family of families) {
        it(`uses no visible ammo row for an empty ${family.name} inventory`, async () => {
            const svg = await RecordSheetSvgGenerator.generate(family.create(), { format: 'compact' });

            expect(svg.querySelectorAll('#ammoProfile text').length).toBe(0);
        });

        it(`uses one row for a short ${family.name} ammo profile`, async () => {
            const entity = family.create();
            addAmmo(entity, 'AC/5');

            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            const lines = svg.querySelectorAll<SVGTextElement>('#ammoProfile text');

            expect(lines.length).toBe(1);
            expect(lines[0].textContent).toBe('Ammo: (AC/5) 24');
        });

        it(`adds balanced rows and keeps all ${family.name} ammo entries`, async () => {
            const entity = family.create();
            const names = ['Arrow IV ADA', 'Arrow IV FA', 'Arrow IV T-FASCAM', 'Arrow IV Homing', 'Ultra AC/5', 'MG'];
            names.forEach(name => addAmmo(entity, name));

            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            const lines = [...svg.querySelectorAll<SVGTextElement>('#ammoProfile text')];

            expect(lines.length).toBeGreaterThan(1);
            const text = lines.map(line => line.textContent).join(' ');
            for (const name of names) expect(text).toContain(`(${name}) 24`);
            expect(text).not.toContain('…');
            for (let index = 1; index < lines.length; index++) {
                expect(Number(lines[index].getAttribute('y')))
                    .toBeGreaterThan(Number(lines[index - 1].getAttribute('y')));
            }
        });

        it(`reclaims ${family.name} inventory space when runtime ammo rows disappear`, async () => {
            const entity = family.create();
            addTestEquipment(entity, new WeaponEquipment({
                id: 'Test Medium Laser', name: 'Medium Laser', type: 'weapon',
                weapon: { damage: 5, heat: 3, ranges: [3, 6, 9] },
            }), { location: 'Body' });
            const svg = await RecordSheetSvgGenerator.generate(entity, { format: 'compact' });
            const profile = svg.querySelector<SVGGElement>('#ammoProfile')!;
            const inventory = profile.parentElement!.querySelector<SVGGElement>('[data-ammo-inventory]')!;
            const originalTransform = inventory.getAttribute('transform');
            const entries = ['Arrow IV ADA', 'Arrow IV FA', 'Arrow IV T-FASCAM', 'Arrow IV Homing', 'Ultra AC/5', 'MG']
                .map(name => `(${name}) 24`);

            updateRecordSheetAmmoProfile(profile, entries);

            const rowCount = profile.querySelectorAll('text').length;
            const ammoHeight = rowCount * Number(profile.getAttribute('data-line-height'));
            expect(rowCount).toBeGreaterThan(1);
            const inventoryMatrix = inventory.transform.baseVal.consolidate()!.matrix;
            const contentBottom = Number(inventory.getAttribute('data-content-bottom'));
            expect(contentBottom * inventoryMatrix.d + inventoryMatrix.f)
                .toBeLessThanOrEqual(Number(inventory.getAttribute('data-bottom')) - ammoHeight + 0.001);
            profile.parentElement!.querySelectorAll<SVGGElement>('[data-ammo-before]').forEach(group => {
                expect(group.transform.baseVal.consolidate()!.matrix.f).toBeCloseTo(-ammoHeight, 5);
            });

            updateRecordSheetAmmoProfile(profile, []);

            expect(profile.querySelectorAll('text').length).toBe(0);
            expect(inventory.getAttribute('transform')).toBe(originalTransform);
            profile.parentElement!.querySelectorAll<SVGGElement>('[data-ammo-before]').forEach(group => {
                expect(group.transform.baseVal.consolidate()!.matrix.f).toBe(0);
            });
        });
    }
});

function addAmmo(entity: BaseEntity, name: string): void {
    addTestEquipment(entity, new AmmoEquipment({
        id: `Test ${name} Ammo`,
        name: `${name} Ammo`,
        type: 'ammo',
        ammo: { type: 'AC', rackSize: 5, shots: 24 },
    }), { location: 'Body', shotsCount: 24 });
}
