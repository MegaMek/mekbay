// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BattleArmorEntity } from '../../models/entity/entities';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../../models/equipment.model';
import { createConstructionEntity } from './construction-factory';
import { constructionInfantryBaMessages } from './construction-infantry-ba-rules';
import { equipmentPlacementIssues, validateConstruction } from './construction-rules';

const registry = createTestEquipmentRegistry();
const battleArmor = () => createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
const codes = (entity: BattleArmorEntity) => validateConstruction(entity).messages.map(message => message.code);

describe('battle armor catalog construction validation', () => {
    it('requires a physical body assignment for a non-hittable neural interface with two slots', () => {
        const entity = battleArmor();
        const niu = new MiscEquipment({ id: 'NIU', name: 'NIU', type: 'misc',
            flags: ['F_BA_EQUIPMENT', 'F_BATTLEMEK_NIU'], stats: { criticalSlots: 2, hittable: false } });
        const mount = addTestEquipment(entity, niu, { location: 'Squad' });
        expect(equipmentPlacementIssues(entity, niu, mount.location, mount)).toContain('Neural interfaces require the suit body.');
        expect(codes(entity)).toContain('MOUNT_PLACEMENT');
        entity.removeEquipment(mount);
        const arm = addTestEquipment(entity, niu, { location: 'Squad', baMountLocation: 'LA' });
        expect(equipmentPlacementIssues(entity, niu, arm.location, arm)).toContain('Neural interfaces require the suit body.');
        entity.removeEquipment(arm);
        const body = addTestEquipment(entity, niu, { location: 'Squad', baMountLocation: 'Body' });
        expect(equipmentPlacementIssues(entity, niu, body.location, body)).not.toContain('Neural interfaces require the suit body.');
        expect(codes(entity)).not.toContain('MOUNT_PLACEMENT');
    });

    for (const flag of ['F_JUMP_JET', 'F_BA_VTOL', 'F_UMU'] as const) {
        it(`accepts slotless ${flag} equipment at the native None location`, () => {
            const entity = battleArmor();
            const propulsion = new MiscEquipment({ id: flag, name: flag, type: 'misc',
                flags: ['F_BA_EQUIPMENT', flag], stats: { criticalSlots: 0 },
                tech: { base: 'All', level: 'Standard', advancement: { is: { common: '2500' }, clan: { common: '2500' } } } });
            const mount = addTestEquipment(entity, propulsion, { location: 'None' });
            expect(equipmentPlacementIssues(entity, propulsion, mount.location, mount)).toEqual([]);
            expect(codes(entity)).not.toContain('MOUNT_PLACEMENT');

            const weapon = new WeaponEquipment({ id: 'unplaced gun', name: 'unplaced gun', type: 'weapon',
                flags: ['F_BA_WEAPON'], stats: { criticalSlots: 1 } });
            expect(equipmentPlacementIssues(entity, weapon, 'None')).toContain('Invalid equipment location.');
        });
    }

    it('charges only detachable packs to suit slot and weapon limits', () => {
        const entity = battleArmor();
        const pack = new MiscEquipment({ id: 'pack', name: 'pack', type: 'misc',
            flags: ['F_BA_EQUIPMENT', 'F_DETACHABLE_WEAPON_PACK'], stats: { criticalSlots: 1, tonnage: 0 } });
        const gun = new WeaponEquipment({ id: 'gun', name: 'gun', type: 'weapon',
            flags: ['F_BA_WEAPON'], stats: { criticalSlots: 2, tonnage: .01 }, weapon: { ammoType: 'AC', rackSize: 2 } });
        const ammo = new AmmoEquipment({ id: 'ammo', name: 'ammo', type: 'ammo',
            flags: ['F_BATTLEARMOR'], stats: { criticalSlots: 1 }, ammo: { type: 'AC', rackSize: 2, shots: 4 } });
        for (let index = 0; index < 3; index++) {
            const parent = addTestEquipment(entity, pack, { location: 'Squad', baMountLocation: 'Body' });
            const weapon = addTestEquipment(entity, gun, { location: 'Squad', isDWP: true });
            const ammunition = addTestEquipment(entity, ammo, { location: 'Squad', isDWP: true, shotsCount: 4 });
            entity.linkEquipment(parent, weapon);
            entity.linkEquipment(weapon, ammunition);
        }
        expect(codes(entity)).not.toContain('BA_LOCATION_SLOTS');
        expect(codes(entity)).not.toContain('BA_ANTI_MEK_WEAPON_LIMIT');

        addTestEquipment(entity, gun, { location: 'Squad', baMountLocation: 'Body' });
        expect(codes(entity)).toContain('BA_LOCATION_SLOTS');
    });

    it('allows tube artillery in a detachable pack while rejecting missile launchers', () => {
        for (const ammoType of ['BA_TUBE', 'SRM', 'NARC'] as const) {
            const entity = battleArmor();
            const parent = addTestEquipment(entity, new MiscEquipment({ id: 'pack', name: 'pack', type: 'misc',
                flags: ['F_BA_EQUIPMENT', 'F_DETACHABLE_WEAPON_PACK'] }), { location: 'Squad', baMountLocation: 'Body' });
            const weapon = addTestEquipment(entity, new WeaponEquipment({ id: ammoType, name: ammoType, type: 'weapon',
                flags: ['F_BA_WEAPON', 'F_MISSILE'], weapon: { ammoType } }), { location: 'Squad', isDWP: true });
            entity.linkEquipment(parent, weapon);
            expect(constructionInfantryBaMessages(entity).some(message => message.code === 'BA_DWP_WEAPON_TYPE'))
                .withContext(ammoType).toBe(ammoType !== 'BA_TUBE');
        }
    });
});
