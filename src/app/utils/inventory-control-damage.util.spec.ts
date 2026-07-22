import { AmmoEquipment, StructureEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment, MountedWeapon } from '../models/mounted-equipment.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { resolveInventoryControlDamageText, resolveInventoryControlWeaponDamage, resolveWeaponDamageText, type InventoryControlDamage } from './inventory-control-damage.util';
import { MML_LRM_PROFILE, MML_SRM_PROFILE } from '../models/ammo-weapon-profile.model';

describe('inventory-control damage resolution', () => {
    it('resolves range damage with effective handler weapon types', () => {
        const weapon = new WeaponEquipment({
            id: 'MRM10',
            name: 'MRM 10',
            type: 'weapon',
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM', damage: [3, 2, 1] }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

        const damage = resolveInventoryControlDamageText(mounted, {
            selectedRange: 'medium',
            selectedAmmo: null
        }, {
            applyWeaponTypes: (_entry, types) => new Set([...types, 'AE'])
        });

        expect(damage).toBe('2 [AE,M,V]');
    });

    it('applies damage modifiers once before formatting weapon types', () => {
        const weapon = new WeaponEquipment({
            id: 'LightPPC',
            name: 'Light PPC',
            type: 'weapon',
            flags: ['F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { damage: 5 }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });
        const applyDamageEffects = jasmine.createSpy('applyDamageEffects')
            .and.callFake((_entry, damage: InventoryControlDamage): InventoryControlDamage =>
                damage.kind === 'simple' ? { kind: 'simple', value: damage.value + 5 } : damage);

        const damage = resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: null
        }, { applyDamageEffects });

        expect(damage).toBe('10 [DE]');
        expect(applyDamageEffects).toHaveBeenCalledTimes(1);
    });

    it('resolves fixed damage from the weapon model rather than presentation text', () => {
        const weapon = new WeaponEquipment({
            id: 'MediumLaser',
            name: 'Medium Laser',
            type: 'weapon',
            flags: ['F_DIRECT_FIRE', 'F_ENERGY'],
            weapon: { damage: 5 }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

        const damage = resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: null
        });

        expect(damage).toBe('5 [DE]');
    });

    it('formats TAG and AMS with weapon types but no numeric damage', () => {
        const tag = new WeaponEquipment({
            id: 'TAG',
            name: 'TAG',
            type: 'weapon',
            flags: ['F_TAG'],
            weapon: { damage: 0 }
        });
        const ams = new WeaponEquipment({
            id: 'AMS',
            name: 'AMS',
            type: 'weapon',
            flags: ['F_AMS'],
            weapon: { damage: 2 }
        });

        expect(resolveWeaponDamageText(tag)).toBe('[E]');
        expect(resolveWeaponDamageText(ams)).toBe('[PB]');

        const mountedTag = new MountedWeapon({ owner: {} as CBTForceUnit, id: tag.id, name: tag.name, equipment: tag });
        expect(resolveInventoryControlDamageText(mountedTag, {
            selectedRange: null,
            selectedAmmo: null
        })).toBe('[E]');
    });

    it('uses selected ammo damage for cluster weapons regardless of mode', () => {
        const weapon = new WeaponEquipment({
            id: 'ATM6',
            name: 'ATM 6',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_ATM'],
            weapon: { ammoType: 'ATM', rackSize: 6, damage: 'cluster' }
        });
        const ammo = new AmmoEquipment({
            id: 'ATM6HE',
            name: 'ATM 6 HE Ammo',
            type: 'ammo',
            ammo: { type: 'ATM', rackSize: 6, damagePerShot: 7, munitionType: ['M_HIGH_EXPLOSIVE'] }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

        expect(resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: ammo
        })).toBe('7/Msl [C6,M,S]');
    });

    it('renders quantified cluster types capped at rack size', () => {
        const mml3 = new WeaponEquipment({
            id: 'ISMML3',
            name: 'MML 3',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', rackSize: 3, damage: 'cluster' }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: mml3.id, name: mml3.name, equipment: mml3 });

        expect(resolveWeaponDamageText(mml3, {
            selectedRange: null,
            selectedAmmo: null,
            fallbackAmmoProfile: MML_LRM_PROFILE
        })).toBe('1/Msl [C3,M,S]');
        const resolution = resolveInventoryControlWeaponDamage(mounted, {
            selectedRange: null,
            selectedAmmo: null,
            fallbackAmmoProfile: MML_LRM_PROFILE
        });
        expect(resolution?.text).toBe('1/Msl [C3,M,S]');
        expect(resolution?.damageTypes).toEqual(['C', 'M', 'S']);
    });

    it('renders incorporated MML damage from its fallback ammunition profile', () => {
        const mml9 = new WeaponEquipment({
            id: 'ISMML9',
            name: 'MML 9',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', rackSize: 9, damage: 'cluster' }
        });
        const mml3 = new WeaponEquipment({
            id: 'ISMML3',
            name: 'MML 3',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', rackSize: 3, damage: 'cluster' }
        });

        expect(resolveWeaponDamageText(mml9, { selectedRange: null, selectedAmmo: null, fallbackAmmoProfile: MML_LRM_PROFILE }))
            .toBe('1/Msl [C5,M,S]');
        expect(resolveWeaponDamageText(mml9, { selectedRange: null, selectedAmmo: null, fallbackAmmoProfile: MML_SRM_PROFILE }))
            .toBe('2/Msl [C2,M,S]');
        expect(resolveWeaponDamageText(mml3, { selectedRange: null, selectedAmmo: null, fallbackAmmoProfile: MML_LRM_PROFILE }))
            .toBe('1/Msl [C3,M,S]');
        expect(resolveWeaponDamageText(mml3, { selectedRange: null, selectedAmmo: null, fallbackAmmoProfile: MML_SRM_PROFILE }))
            .toBe('2/Msl [C2,M,S]');
    });

    it('uses loaded MML ammunition without requiring a weapon mode', () => {
        const mml9 = new WeaponEquipment({
            id: 'ISMML9',
            name: 'MML 9',
            type: 'weapon',
            flags: ['F_MISSILE', 'F_MML'],
            weapon: { ammoType: 'MML', rackSize: 9, damage: 'cluster' }
        });
        const srmAmmo = new AmmoEquipment({
            id: 'ISMML9SRMAmmo',
            name: 'MML 9 SRM Ammo',
            type: 'ammo',
            flags: ['F_MML_SRM'],
            ammo: { type: 'MML', rackSize: 9, damagePerShot: 4 }
        });

        expect(resolveWeaponDamageText(mml9, { selectedRange: null, selectedAmmo: srmAmmo }))
            .toBe('4/Msl [C2,M,S]');
    });

    it('renders quantified rapid-fire types for Ultra and Rotary autocannons', () => {
        const autocannon = (ammoType: 'AC_ULTRA' | 'AC_ROTARY') => new WeaponEquipment({
            id: ammoType,
            name: ammoType,
            type: 'weapon',
            flags: ['F_BALLISTIC', 'F_DIRECT_FIRE'],
            weapon: { ammoType, damage: 5 }
        });

        expect(resolveWeaponDamageText(autocannon('AC_ULTRA'))).toBe('5/s [DB,R2]');
        expect(resolveWeaponDamageText(autocannon('AC_ROTARY'))).toBe('5/s [DB,R6,S]');
    });

    it('keeps C unquantified when the weapon has no corresponding cluster count', () => {
        const repeatingCluster = new WeaponEquipment({
            id: 'RepeatingCluster',
            name: 'Repeating Cluster',
            type: 'weapon',
            flags: ['F_REPEATING'],
            weapon: { damage: 'cluster', rackSize: 10 }
        });

        expect(resolveWeaponDamageText(repeatingCluster)).toBe('1/Msl [C]');
    });

    it('does not apply point bonuses to per-missile or special damage', () => {
        const weapon = new WeaponEquipment({
            id: 'ClusterWeapon',
            name: 'Cluster Weapon',
            type: 'weapon',
            weapon: { ammoType: 'MRM', damage: 'cluster' }
        });
        const mounted = new MountedWeapon({ owner: {} as CBTForceUnit, id: weapon.id, name: weapon.name, equipment: weapon });

        expect(resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: null
        }, {
            applyDamageEffects: (_entry, damage) => damage.kind === 'simple'
                ? { kind: 'simple', value: damage.value + 5 }
                : damage
        })).toBe('1/Msl [C,M]');
    });

    it('returns null for non-weapon entries', () => {
        const equipment = new StructureEquipment({ id: 'structure', name: 'Structure', type: 'structure' });
        const mounted = new MountedEquipment({ owner: {} as CBTForceUnit, id: equipment.id, name: equipment.name, equipment });

        expect(resolveInventoryControlDamageText(mounted, {
            selectedRange: null,
            selectedAmmo: null
        })).toBeNull();
    });
});