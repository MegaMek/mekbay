// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestAeroSpaceFighterEntity, TestBipedMekEntity, TestDropShipEntity, TestProtoMekEntity, TestSmallCraftEntity, TestTankEntity } from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { WeaponEquipment } from '../../models/equipment.model';
import { weaponQuirkAddress } from '../../models/entity/utils/weapon-quirks';
import { RecordSheetSvgGenerator } from './record-sheet-svg-generator';

describe('record sheet quirk visibility', () => {
    it('retains authored aerospace quirks in the footer and respects the display option in both rulesets', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            for (const entity of [new TestAeroSpaceFighterEntity(), new TestSmallCraftEntity(), new TestDropShipEntity()]) {
                entity.quirks.set([
                    { quirk: { key: 'obsolete', name: 'Obsolete', type: 'negative', description: '' } },
                    { quirk: { key: 'atmo_instability', name: 'Atmospheric Flight Instability', type: 'negative', description: '' } },
                ]);
                const enabled = await RecordSheetSvgGenerator.generate(entity, { ruleset });
                expect(enabled.querySelector('.unitQuirks')?.textContent)
                    .withContext(entity.entityType).toContain('Obsolete, Atmospheric Flight Instability');
                const disabled = await RecordSheetSvgGenerator.generate(entity, { ruleset, showQuirks: false });
                expect(disabled.querySelector('.unitQuirks')).withContext(entity.entityType).toBeNull();
                expect(entity.quirks()).toHaveSize(2);
            }
        }
    });

    it('prints ProtoMek quirks in both rulesets without inventing an absent main-gun damage track', async () => {
        for (const ruleset of ['total-warfare', 'core-2026'] as const) {
            const entity = new TestProtoMekEntity();
            entity.setTonnage(6);
            entity.quirks.set([{ quirk: { key: 'distracting', name: 'Distracting', type: 'positive', description: '' } }]);
            const enabled = await RecordSheetSvgGenerator.generate(entity, { ruleset });
            expect(enabled.querySelector('.unitQuirks')?.textContent).toBe('Quirks: Distracting');
            expect(enabled.textContent).not.toContain('Main Gun Destroyed');
            const disabled = await RecordSheetSvgGenerator.generate(entity, { ruleset, showQuirks: false });
            expect(disabled.querySelector('.unitQuirks')).toBeNull();
        }
    });

    it('omits design and weapon quirks on full and compact sheets without altering the design', async () => {
        for (const entity of [new TestBipedMekEntity(), new TestTankEntity()]) {
            entity.setTonnage(50);
            entity.quirks.set([{ quirk: { key: 'easy_maintain', name: 'Easy to Maintain', type: 'positive', description: '' } }]);
            const location = entity.entityType === 'Mek' ? 'LT' : 'FR';
            const laser = new WeaponEquipment({ id: 'Sheet Laser', name: 'Sheet Laser', type: 'weapon', weapon: { heat: 3, damage: 5 } });
            const mount = addTestEquipment(entity, laser, { allocation: { kind: 'location', location,
                ...(entity.entityType === 'Mek' ? { placements: [{ location, slotIndex: 0 }] } : {}) } });
            entity.weaponQuirks.set([{ name: 'accurate', ...weaponQuirkAddress(entity, mount) }]);
            const formats = entity.entityType === 'Mek' ? ['letter', 'a4'] as const : ['compact', 'letter', 'a4'] as const;
            for (const format of formats) {
                const enabled = await RecordSheetSvgGenerator.generate(entity, { format });
                const visible = [...enabled.querySelectorAll('.unitQuirks')].map(node => node.textContent).join(' ');
                expect(visible).withContext(`${entity.entityType} ${format}`).toContain('Easy to Maintain');
                expect(visible).toContain('Accurate Weapon');
                const disabled = await RecordSheetSvgGenerator.generate(entity, { format, showQuirks: false });
                expect(disabled.querySelector('.unitQuirks')).withContext(`${entity.entityType} ${format}`).toBeNull();
                expect(disabled.textContent).not.toContain('Accurate Weapon');
                expect(entity.quirks().length).toBe(1);
                expect(entity.weaponQuirks().length).toBe(1);
            }
        }
    });
});
