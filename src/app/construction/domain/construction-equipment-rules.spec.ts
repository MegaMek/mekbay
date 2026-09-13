// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import type { BaseEntity } from '../../models/entity/base-entity';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type AmmoType } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import { MountedEngine } from '../../models/entity/components';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { addTestEquipment, addTestEquipmentWithFlags } from '../../models/entity/testing/test-mounted-equipment';
import { createConstructionEntity, type ConstructionUnitKind } from './construction-factory';
import { constructionEquipmentMessages } from './construction-equipment-rules';
import { constructionEquipmentConflictMessages } from './construction-equipment-conflicts';

const design = (kind: ConstructionUnitKind = 'Tank') => createConstructionEntity(kind, createTestEquipmentRegistry());
const misc = (entity: BaseEntity, flags: EquipmentFlag[], location = 'Front') => addTestEquipmentWithFlags(entity, flags, { location });
const weapon = (entity: BaseEntity, flags: EquipmentFlag[], ammoType: AmmoType = 'NA', location = 'Front') => addTestEquipment(entity,
    new WeaponEquipment({ id: `${flags} ${ammoType}`, name: `${flags} ${ammoType}`, type: 'weapon', flags, weapon: { ammoType } }), { location });
const codes = (entity: BaseEntity) => [...constructionEquipmentMessages(entity), ...constructionEquipmentConflictMessages(entity)].map(message => message.code);

describe('shared construction equipment combinations', () => {
    it('allows hierarchical master/slave networks but rejects C3i mixed with masters or Nova', () => {
        const entity = design();
        weapon(entity, ['F_C3M']);
        weapon(entity, ['F_C3MBS']);
        expect(codes(entity)).not.toContain('NETWORK_SYSTEM_CONFLICT');
        misc(entity, ['F_C3S']);
        misc(entity, ['F_C3SBS']);
        expect(codes(entity)).not.toContain('NETWORK_SYSTEM_CONFLICT');
        misc(entity, ['F_C3I']);
        expect(codes(entity)).toContain('NETWORK_SYSTEM_CONFLICT');
        const other = design();
        misc(other, ['F_C3I']);
        weapon(other, ['F_C3M']);
        expect(codes(other)).toContain('NETWORK_SYSTEM_CONFLICT');
        const nova = design();
        misc(nova, ['F_NOVA']);
        misc(nova, ['F_C3I']);
        expect(codes(nova)).toContain('NETWORK_SYSTEM_CONFLICT');
    });

    it('requires a fusion engine for Nova and one robotic controller per chassis', () => {
        const entity = design();
        entity.mountedEngine.set(new MountedEngine({ type: 'Fission', rating: 100, techBase: 'IS' }));
        misc(entity, ['F_NOVA']);
        expect(codes(entity)).toContain('NOVA_ENGINE');
        misc(entity, ['F_SRCS']);
        misc(entity, ['F_CASPAR_II']);
        expect(codes(entity)).toContain('DRONE_SYSTEM_CONFLICT');
    });

    it('enforces kitchen, minesweeper and family-specific hoist maxima at the boundary', () => {
        const entity = design();
        for (let index = 0; index < 3; index++) misc(entity, ['F_FIELD_KITCHEN']);
        misc(entity, ['F_MINESWEEPER']);
        for (let index = 0; index < 4; index++) misc(entity, ['F_LIFT_HOIST']);
        expect(codes(entity)).toEqual([]);
        misc(entity, ['F_FIELD_KITCHEN']);
        misc(entity, ['F_MINESWEEPER']);
        misc(entity, ['F_LIFT_HOIST']);
        expect(codes(entity)).toEqual(jasmine.arrayContaining(['FIELD_KITCHEN_LIMIT', 'MINESWEEPER_LIMIT', 'LIFT_HOIST_LIMIT']));
        const mek = design('Biped');
        for (let index = 0; index < 3; index++) misc(mek, ['F_LIFT_HOIST'], 'RT');
        expect(codes(mek)).toContain('LIFT_HOIST_LIMIT');
    });

    it('rejects emergency cooling mixed with coolant pods and duplicate emergency systems', () => {
        const entity = design();
        misc(entity, ['F_EMERGENCY_COOLANT_SYSTEM']);
        addTestEquipment(entity, new AmmoEquipment({ id: 'Coolant Pod', name: 'Coolant Pod', type: 'ammo', ammo: { type: 'COOLANT_POD' } }));
        expect(codes(entity)).toContain('COOLANT_SYSTEM_CONFLICT');
        expect(codes(entity)).not.toContain('EMERGENCY_COOLANT_LIMIT');
        misc(entity, ['F_EMERGENCY_COOLANT_SYSTEM']);
        expect(codes(entity)).toContain('EMERGENCY_COOLANT_LIMIT');
    });

    it('keeps physical tools and bridge layers exclusive per location while allowing separate locations', () => {
        const entity = design();
        misc(entity, ['F_CLUB']);
        misc(entity, ['F_BULLDOZER'], 'Rear');
        misc(entity, ['F_LIGHT_BRIDGE_LAYER']);
        misc(entity, ['F_HEAVY_BRIDGE_LAYER'], 'Rear');
        expect(codes(entity)).toEqual([]);
        misc(entity, ['F_HAND_WEAPON']);
        misc(entity, ['F_MEDIUM_BRIDGE_LAYER']);
        expect(codes(entity)).toEqual(jasmine.arrayContaining(['PHYSICAL_TOOL_LOCATION', 'BRIDGE_LAYER_LOCATION']));
    });

    it('allows modular armor on both front and rear but rejects duplicates on the same side', () => {
        const entity = design('Biped');
        misc(entity, ['F_MODULAR_ARMOR'], 'RT');
        const rear = new MiscEquipment({ id: 'Rear Modular Armor', name: 'Rear Modular Armor', type: 'misc', flags: ['F_MODULAR_ARMOR'] });
        addTestEquipment(entity, rear, { location: 'RT', rearMounted: true });
        expect(codes(entity)).not.toContain('MODULAR_ARMOR_LOCATION');
        addTestEquipment(entity, rear, { location: 'RT', rearMounted: true });
        expect(constructionEquipmentMessages(entity)).toContain(jasmine.objectContaining({ code: 'MODULAR_ARMOR_LOCATION', location: 'RT', message: 'Only one modular armor mount is permitted on the rear of this location.' }));
    });

    it('requires Artemis on every compatible launcher and a link in the matching location', () => {
        const entity = design();
        const first = weapon(entity, ['F_ARTEMIS_COMPATIBLE'], 'LRM');
        weapon(entity, ['F_ARTEMIS_COMPATIBLE'], 'SRM', 'Rear');
        const artemis = misc(entity, ['F_ARTEMIS']);
        entity.linkEquipment(artemis, first);
        expect(codes(entity)).toContain('ARTEMIS_COVERAGE');
        const misplaced = misc(entity, ['F_ARTEMIS']);
        expect(codes(entity)).toContain('ARTEMIS_LINK');
        entity.removeEquipment(misplaced);
        misc(entity, ['F_ARTEMIS'], 'Rear');
        entity.reconcileEquipmentRelationships();
        expect(codes(entity)).not.toContain('ARTEMIS_LINK');
        expect(codes(entity)).not.toContain('ARTEMIS_COVERAGE');
        misc(entity, ['F_ARTEMIS_V'], 'Rear');
        expect(codes(entity)).toContain('ARTEMIS_GENERATION');
    });

    it('requires Apollo for every MRM and validates detached laser/PPC enhancements', () => {
        const entity = design();
        weapon(entity, [], 'MRM');
        weapon(entity, [], 'MRM', 'Rear');
        misc(entity, ['F_APOLLO']);
        expect(codes(entity)).toContain('APOLLO_COVERAGE');
        misc(entity, ['F_APOLLO'], 'Rear');
        entity.reconcileEquipmentRelationships();
        expect(codes(entity)).not.toContain('APOLLO_LINK');
        const insulator = misc(entity, ['F_LASER_INSULATOR']);
        expect(codes(entity)).toContain('WEAPON_ENHANCEMENT_LINK');
        const laser = weapon(entity, ['F_LASER']);
        entity.linkEquipment(insulator, laser);
        expect(codes(entity)).not.toContain('WEAPON_ENHANCEMENT_LINK');
    });

    it('enforces fusion/fission weapon requirements while exempting battle-armor flamers', () => {
        const entity = design();
        entity.mountedEngine.set(new MountedEngine({ type: 'ICE', rating: 100, techBase: 'IS' }));
        weapon(entity, ['F_FLAMER']);
        weapon(entity, ['F_HYPER']);
        weapon(entity, ['F_GAUSS'], 'GAUSS_HEAVY');
        expect(codes(entity).filter(code => code === 'WEAPON_ENGINE').length).toBe(3);
        entity.mountedEngine.set(new MountedEngine({ type: 'Fission', rating: 100, techBase: 'IS' }));
        expect(codes(entity)).not.toContain('WEAPON_ENGINE');
        const ba = design('BattleArmor');
        weapon(ba, ['F_FLAMER', 'F_BA_WEAPON'], 'NA', 'Squad');
        expect(codes(ba)).not.toContain('WEAPON_ENGINE');
        for (const kind of ['SmallCraft', 'DropShip', 'WarShip'] as const) {
            const craft = design(kind);
            weapon(craft, ['F_GAUSS'], 'GAUSS_HEAVY', 'Nose');
            expect(codes(craft)).not.toContain('WEAPON_ENGINE');
        }
    });

    it('rejects pod-mounted equipment/transport on ordinary chassis and fixed-only Omni pods', () => {
        const entity = design();
        const fixed = new MiscEquipment({ id: 'Fixed Only', name: 'Fixed Only', type: 'misc', stats: { omniFixedOnly: true } });
        addTestEquipment(entity, fixed, { location: 'Front', omniPodMounted: true });
        entity.transporters.set([{ id: 'test-troop-space', kind: 'troop-space', totalSpace: 1, omni: true }]);
        expect(codes(entity)).toEqual(jasmine.arrayContaining(['OMNI_POD_CHASSIS', 'OMNI_POD_TRANSPORT']));
        entity.omni.set(true);
        expect(codes(entity)).toContain('OMNI_FIXED_EQUIPMENT');
        expect(codes(entity)).not.toContain('OMNI_POD_TRANSPORT');
    });
});
