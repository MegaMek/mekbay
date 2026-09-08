// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { BattleArmorEntity, InfantryEntity } from '../../models/entity/entities';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment, type InfantryWeaponEquipment } from '../../models/equipment.model';
import type { EquipmentFlag } from '../../models/equipment-flags.type';
import type { EntityMountedEquipmentInit } from '../../models/entity/types';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { encodeNativeEntity } from '../../models/entity/write-entity';
import { parseEntity } from '../../models/entity/parse-entity';
import { PREDEFINED_INFANTRY_MOUNTS } from '../../models/entity/types/infantry';
import { createConstructionEntity } from './construction-factory';
import { constructionInfantryBaMessages } from './construction-infantry-ba-rules';

const misc = (id: string, flags: EquipmentFlag[]) => new MiscEquipment({ id, name: id, type: 'misc', flags: ['F_BA_EQUIPMENT', ...flags], stats: { criticalSlots: 0, tonnage: 0.01 } });
const rifle = new WeaponEquipment({ id: 'TestRifle', name: 'Test Rifle', type: 'weapon', flags: ['F_INFANTRY'], infantry: { crew: 1 } });
const support = new WeaponEquipment({ id: 'TestSupport', name: 'Test Support', type: 'weapon', flags: ['F_INFANTRY', 'F_INF_SUPPORT'], infantry: { crew: 4 } }) as InfantryWeaponEquipment;
const gun = new WeaponEquipment({ id: 'TestBAGun', name: 'Test BA Gun', type: 'weapon', flags: ['F_BA_WEAPON'], weapon: { ammoType: 'AC', rackSize: 2 } });
const ammo = new AmmoEquipment({ id: 'TestBAAmmo', name: 'Test BA Ammo', type: 'ammo', flags: ['F_BATTLEARMOR'], ammo: { type: 'AC', rackSize: 2, shots: 4 } });
const ap = misc('TestAP', ['F_AP_MOUNT']);
const glove = misc('BAArmoredGlove', ['F_BA_MANIPULATOR', 'F_ARMORED_GLOVE', 'F_AP_MOUNT']);
const pack = misc('ISDetachableWeaponPack', ['F_DETACHABLE_WEAPON_PACK']);
const paired = misc('BABattleClawMagnets', ['F_BA_MANIPULATOR']);
const adapter = misc('BAMEA', ['F_BA_MEA']);
const wing = misc('TestWing', ['F_PARTIAL_WING']);
const booster = misc('TestBooster', ['F_JUMP_BOOSTER']);
const mechanical = misc('TestMechanical', ['F_MECHANICAL_JUMP_BOOSTER']);
const myomer = misc('TestMyomer', ['F_MASC']);
const registry = createTestEquipmentRegistry(Object.fromEntries([rifle, support, gun, ammo, ap, glove, pack, paired, adapter, wing, booster, mechanical, myomer].map(eq => [eq.id, eq])));
const ba = () => createConstructionEntity('BattleArmor', registry) as BattleArmorEntity;
const infantry = () => createConstructionEntity('Infantry', registry) as InfantryEntity;
const codes = (entity: BattleArmorEntity | InfantryEntity) => constructionInfantryBaMessages(entity).map(message => message.code);
const add = (entity: BattleArmorEntity, equipment: Equipment, values: Partial<EntityMountedEquipmentInit> = {}) => entity.addEquipment({
    equipment, equipmentId: equipment.id, allocation: { kind: 'location', location: 'Squad' }, baMountLocation: 'Body',
    rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false, ...values,
});

describe('battle armor attachment and infantry construction predicates', () => {
    it('uses motive, specialist and beast squad/platoon ceilings', () => {
        const unit = infantry();
        unit.motiveType.set('VTOL'); unit.isMicrolite.set(true); unit.squadSize.set(3); unit.squadCount.set(4);
        expect(codes(unit)).toContain('INFANTRY_MOTIVE_SQUAD_SIZE');
        expect(codes(unit)).toContain('INFANTRY_MOTIVE_STRENGTH');
        unit.motiveType.set('Leg'); unit.squadSize.set(7); unit.squadCount.set(3);
        unit.specializations.set(new Set(['mine-engineers']));
        expect(codes(unit)).toContain('INFANTRY_MOTIVE_SQUAD_COUNT');
        unit.specializations.set(new Set()); unit.mount.set(PREDEFINED_INFANTRY_MOUNTS.get('Hipposaur')!); unit.motiveType.set('Beast');
        unit.squadSize.set(4); unit.squadCount.set(2);
        expect(codes(unit)).toEqual([]);
        unit.squadCount.set(3);
        expect(codes(unit)).toContain('INFANTRY_MOTIVE_STRENGTH');
    });

    it('applies secondary crew reductions and motive/specialist allowances', () => {
        const unit = infantry(); unit.secondaryWeapon.set(support); unit.secondaryCount.set(2); unit.squadSize.set(6); unit.squadCount.set(1);
        expect(codes(unit)).toContain('INFANTRY_SECONDARY_CREW');
        unit.augmentations.set(['tsm_implant']);
        expect(codes(unit)).not.toContain('INFANTRY_SECONDARY_CREW');
        unit.specializations.set(new Set(['mine-engineers']));
        expect(codes(unit)).toContain('INFANTRY_SECONDARY_LIMIT');
        unit.augmentations.set([]); unit.specializations.set(new Set()); unit.mount.set(PREDEFINED_INFANTRY_MOUNTS.get('Elephant')!);
        unit.motiveType.set('Beast'); unit.squadSize.set(2); unit.secondaryCount.set(1);
        expect(codes(unit)).not.toContain('INFANTRY_SECONDARY_CREW');
    });

    it('rejects mutually exclusive augmentations and wings on incompatible infantry', () => {
        const unit = infantry(); unit.augmentations.set(['dermal_armor', 'dermal_camo_armor', 'pl_glider', 'pl_flight']);
        unit.motiveType.set('Motorized'); unit.extraneousPair1.set('arms'); unit.extraneousPair2.set('legs');
        expect(codes(unit)).toContain('INFANTRY_DERMAL_CONFLICT');
        expect(codes(unit)).toContain('INFANTRY_WING_CONFLICT');
        expect(codes(unit)).toContain('INFANTRY_WING_MOTIVE');
        expect(codes(unit)).toContain('INFANTRY_WING_LIMBS');
    });

    it('requires real AP attachments and reconstructs the native preceding mount after reload', () => {
        const unit = ba();
        const first = add(unit, ap, { baMountLocation: 'LA' });
        const second = add(unit, ap, { baMountLocation: 'RA' });
        const weapon = add(unit, rifle, { isAPM: true });
        expect(codes(unit)).toContain('BA_AP_ATTACHMENT');
        unit.reconcileEquipmentRelationships();
        expect(unit.getLinkingMount(weapon)?.mountId).toBe(second.mountId);
        expect(unit.getLinkedMount(first)).toBeUndefined();
        expect(codes(unit)).not.toContain('BA_AP_ATTACHMENT');
        const loaded = parseEntity(encodeNativeEntity(unit), 'ba.blk', registry).entity;
        const restored = loaded.equipment().find(m => m.equipmentId === rifle.id)!;
        expect(loaded.getLinkingMount(restored)?.baMountLocation).toBe('RA');
    });

    it('enforces support-weapon restrictions even when a native AP link exists', () => {
        const unit = ba(); const point = add(unit, ap); const weapon = add(unit, support, { isAPM: true });
        unit.linkEquipment(point, weapon);
        expect(codes(unit)).toContain('BA_AP_SUPPORT_WEAPON');
        unit.removeEquipment(point);
        const hand = add(unit, glove, { baMountLocation: 'LA' }); unit.linkEquipment(hand, weapon);
        expect(codes(unit)).toContain('BA_AP_SUPPORT_WEAPON');
    });

    it('infers a DWP weapon/ammo chain and preserves it through the native codec', () => {
        const unit = ba(); const dwp = add(unit, pack); const weapon = add(unit, gun, { isDWP: true });
        const ammunition = add(unit, ammo, { isDWP: true, shotsCount: 4 });
        unit.reconcileEquipmentRelationships();
        expect(unit.getLinkedMount(dwp)?.mountId).toBe(weapon.mountId);
        expect(unit.getLinkedMount(weapon)?.mountId).toBe(ammunition.mountId);
        expect(codes(unit)).not.toContain('BA_DWP_ATTACHMENT');
        expect(codes(unit)).not.toContain('BA_DWP_AMMO_ATTACHMENT');
        const loaded = parseEntity(encodeNativeEntity(unit), 'ba.blk', registry).entity;
        expect(loaded.getLinkedMount(loaded.equipment().find(m => m.equipmentId === pack.id)!)?.equipmentId).toBe(gun.id);
    });

    it('checks paired manipulators and paired modular adapters on each suit', () => {
        const unit = ba(); add(unit, paired, { baMountLocation: 'LA' });
        expect(codes(unit)).toContain('BA_MANIPULATOR_PAIR');
        add(unit, paired, { baMountLocation: 'RA' });
        expect(codes(unit)).not.toContain('BA_MANIPULATOR_PAIR');
        add(unit, adapter, { baMountLocation: 'LA' });
        expect(codes(unit)).toContain('BA_MANIPULATOR_ADAPTER_PAIR');
        add(unit, adapter, { baMountLocation: 'RA' });
        expect(codes(unit)).not.toContain('BA_MANIPULATOR_ADAPTER_PAIR');
    });

    it('checks propulsion prerequisites and incompatible suit enhancements', () => {
        const unit = ba(); add(unit, wing); add(unit, booster); add(unit, mechanical); add(unit, myomer);
        unit.motiveType.set('Leg'); unit.propulsionMP.set(0);
        expect(codes(unit)).toContain('BA_BOOSTER_PROPULSION');
        expect(codes(unit)).toContain('BA_WING_BOOSTER_CONFLICT');
        expect(codes(unit)).toContain('BA_MYOMER_MECHANICAL_CONFLICT');
    });

    it('enforces squad-support and ammunition capacity without inventing an ammo mount', () => {
        const unit = ba(); unit.chassisType.set('Quad'); add(unit, gun, { isSSWM: true }); add(unit, gun, { isSSWM: true });
        add(unit, ammo, { shotsCount: 5 });
        expect(codes(unit)).toContain('BA_SQUAD_SUPPORT_LIMIT');
        expect(codes(unit)).toContain('BA_QUAD_SQUAD_SUPPORT');
        expect(codes(unit)).toContain('BA_AMMO_SHOTS_LIMIT');
    });
});
