// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BaseEntity } from '../../../models/entity/base-entity';
import {
    TestAeroSpaceFighterEntity,
    TestBattleArmorEntity,
    TestProtoMekEntity,
    TestSmallCraftEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, WeaponEquipment } from '../../../models/equipment.model';
import { RecordSheetSvgGenerator } from '../record-sheet-svg-generator';
import { updateRecordSheetAmmoProfile } from '../record-sheet-ammo-rendering';
import { recordSheetAmmoEntries } from '../record-sheet-svg-rendering';

describe('generated non-Mek ammo rows', () => {
    // Aerospace sheets have no compact block; their footer profile is the one the non-Mek binder rewrites live.
    const families = [
        { name: 'vehicle', create: () => new TestTankEntity(), format: 'compact' },
        { name: 'ProtoMek', create: () => new TestProtoMekEntity(), format: 'compact' },
        { name: 'Battle Armor', create: () => new TestBattleArmorEntity(), format: 'compact' },
        { name: 'aerospace fighter', create: () => new TestAeroSpaceFighterEntity(), format: 'letter' },
        { name: 'small craft', create: () => new TestSmallCraftEntity(), format: 'letter' },
    ] as const;

    for (const family of families) {
        it(`keeps an empty ${family.name} ammo profile the binder can fill`, async () => {
            const svg = await RecordSheetSvgGenerator.generate(family.create(), { ruleset: 'total-warfare', format: family.format });
            const profile = svg.querySelector<SVGGElement>('#ammoProfile');

            expect(profile).not.toBeNull();
            expect(profile!.querySelectorAll('text').length).toBe(0);
            updateRecordSheetAmmoProfile(profile!, ['(AC/5) 13']);
            expect(profile!.textContent).toBe('Ammo: (AC/5) 13');
        });

        it(`uses one row for a short ${family.name} ammo profile`, async () => {
            const entity = family.create();
            addAmmo(entity, 'AC/5');

            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: family.format });
            const lines = svg.querySelectorAll<SVGTextElement>('#ammoProfile text');

            expect(lines.length).toBe(1);
            expect(lines[0].textContent).toBe('Ammo: (AC/5) 24');
        });

        it(`adds balanced rows and keeps all ${family.name} ammo entries`, async () => {
            const entity = family.create();
            const names = ['Arrow IV ADA', 'Arrow IV FA', 'Arrow IV T-FASCAM', 'Arrow IV Homing', 'Ultra AC/5', 'MG'];
            names.forEach(name => addAmmo(entity, name));

            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: family.format });
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
            const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: family.format });
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

    it('prints battle armor body-mounted ammo under its type name, as the live profile does', async () => {
        const entity = new TestBattleArmorEntity();
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test BA SRM 2 Ammo', name: 'SRM 2 Ammo', type: 'ammo', ammo: { type: 'SRM', rackSize: 2, shots: 4 },
        }), { location: 'Body', shotsCount: 4, baMountLocation: 'Body' });

        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format: 'compact' });

        expect(svg.querySelector('#ammoProfile')?.textContent).toBe('Ammo: (SRM 2) 4');
        // The live profile names bins by their equipment; both paths agree.
        expect(recordSheetAmmoEntries([['SRM 2 Ammo', 4]])).toEqual(['(SRM 2) 4']);
    });

    it('orders ammo by name in code-unit order, like the TreeMap MegaMekLab prints from', () => {
        expect(recordSheetAmmoEntries([['iNarc Ammo', 4], ['LRM 5 Ammo', 24], ['AC/5 Ammo', 20], ['LRM 5 Ammo', 24]]))
            .toEqual(['(AC/5) 20', '(LRM 5) 48', '(iNarc) 4']);
    });

    it('fits a multi-row fighter ammo profile between a full inventory and the fuel line without squeezing either', async () => {
        const entity = new TestAeroSpaceFighterEntity();
        for (let index = 0; index < 9; index++) {
            addTestEquipment(entity, new WeaponEquipment({
                id: `Test Fighter Laser ${index}`, name: `Medium Laser ${index}`, type: 'weapon',
                weapon: { damage: 5, heat: 3, ranges: [3, 6, 9], av: [5, 5, 0, 0] },
            }), { location: 'Nose' });
        }
        ['Arrow IV ADA', 'Arrow IV FA', 'Arrow IV T-FASCAM', 'Arrow IV Homing', 'Ultra AC/5', 'MG'].forEach(name => addAmmo(entity, name));
        const svg = await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare' });
        document.body.appendChild(svg);
        try {
            const profile = svg.querySelector<SVGGElement>('#ammoProfile')!;
            const ammoRows = [...profile.querySelectorAll<SVGTextElement>('text')];
            expect(ammoRows.length).toBeGreaterThan(1);
            const inventory = profile.parentElement!.querySelector<SVGGElement>('[data-ammo-inventory]')!;
            expect(inventory.transform.baseVal.consolidate()?.matrix.d ?? 1).toBe(1);
            const bottom = (text: SVGTextElement) => text.getBBox().y + text.getBBox().height;
            const inventoryBottom = Math.max(...[...inventory.querySelectorAll<SVGTextElement>('text')]
                .filter(text => text.textContent).map(bottom));
            expect(inventoryBottom).toBeLessThanOrEqual(ammoRows[0].getBBox().y);
            const fuel = [...profile.parentElement!.querySelectorAll<SVGTextElement>(':scope > text')]
                .find(text => text.textContent?.startsWith('Fuel Points'))!;
            expect(bottom(ammoRows.at(-1)!)).toBeLessThanOrEqual(fuel.getBBox().y);
        } finally {
            svg.remove();
        }
    });
});

function addAmmo(entity: BaseEntity, name: string): void {
    addTestEquipment(entity, new AmmoEquipment({
        id: `Test ${name} Ammo`,
        name: `${name} Ammo`,
        type: 'ammo',
        ammo: { type: 'AC', rackSize: 5, shots: 24 },
    }), { location: 'Body', shotsCount: 24 });
}
