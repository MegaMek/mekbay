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
import { AmmoEquipment, MiscEquipment } from '../../../models/equipment.model';
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
            updateRecordSheetAmmoProfile(profile!, [{ prefix: 'Ammo:', entries: ['(AC/5) 13'] }]);
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

    const caseEquipment = (flag: 'F_CASE' | 'F_CASE_II' | 'F_CASE_P') => new MiscEquipment({ id: flag, name: flag, type: 'misc', flags: [flag] });
    const ammoProfileLines = async (entity: BaseEntity, format: 'compact' | 'letter') =>
        [...(await RecordSheetSvgGenerator.generate(entity, { ruleset: 'total-warfare', format }))
            .querySelectorAll('#ammoProfile text')].map(line => line.textContent);

    it('puts all of a vehicle\'s ammo under its CASE, wherever the CASE is (TW p. 194)', async () => {
        const entity = new TestTankEntity();
        addTestEquipment(entity, caseEquipment('F_CASE'), { location: 'Rear' });
        addAmmo(entity, 'AC/5');
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test MG Ammo', name: 'MG Ammo', type: 'ammo', ammo: { type: 'MG', rackSize: 2, shots: 100 },
        }), { location: 'Front', shotsCount: 100 });

        expect((await ammoProfileLines(entity, 'compact')).join(' ')).toBe('Ammo (CASE): (AC/5) 24, (MG) 100');
    });

    it('names prototype CASE CASE-P, as its venting can fail (IO:AE p. 65)', async () => {
        const entity = new TestTankEntity();
        addTestEquipment(entity, caseEquipment('F_CASE_P'), { location: 'Body' });
        addAmmo(entity, 'AC/5');

        expect(await ammoProfileLines(entity, 'compact')).toEqual(['Ammo (CASE-P): (AC/5) 24']);
    });

    it('counts the CASE a Clan internal structure carries built in (TM errata p. 210)', async () => {
        const entity = new TestTankEntity();
        entity.techBase.set('Clan');
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test AC/5 Ammo', name: 'AC/5 Ammo', type: 'ammo', stats: { explosive: true },
            ammo: { type: 'AC', rackSize: 5, shots: 24 },
        }), { location: 'Body', shotsCount: 24 });

        expect(await ammoProfileLines(entity, 'compact')).toEqual(['Ammo (CASE): (AC/5) 24']);
    });

    it('puts a fighter\'s fuselage ammo under CASE II only in the fuselage (TO:AUE p. 110)', async () => {
        const entity = new TestAeroSpaceFighterEntity();
        const [nose, fuselage] = [entity.locationOrder[0], entity.locationOrder.at(-1)!];
        addTestEquipment(entity, caseEquipment('F_CASE_II'), { location: nose });
        addTestEquipment(entity, new AmmoEquipment({
            id: 'Test AC/5 Ammo', name: 'AC/5 Ammo', type: 'ammo', ammo: { type: 'AC', rackSize: 5, shots: 24 },
        }), { location: fuselage, shotsCount: 24 });

        expect(await ammoProfileLines(entity, 'letter')).toEqual(['Ammo: (AC/5) 24']);

        addTestEquipment(entity, caseEquipment('F_CASE_II'), { location: fuselage });

        expect(await ammoProfileLines(entity, 'letter')).toEqual(['Ammo (CASE II): (AC/5) 24']);
    });

    it('orders ammo by name in code-unit order, like the TreeMap MegaMekLab prints from', () => {
        expect(recordSheetAmmoEntries([['iNarc Ammo', 4], ['LRM 5 Ammo', 24], ['AC/5 Ammo', 20], ['LRM 5 Ammo', 24]]))
            .toEqual(['(AC/5) 20', '(LRM 5) 48', '(iNarc) 4']);
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
