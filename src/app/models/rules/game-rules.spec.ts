// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { EquipmentFlag } from '../equipment-flags.type';
import { EquipmentRegistry } from '../equipment-lookup';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from '../equipment.model';
import { MountedEquipment, MountedWeapon } from '../mounted-equipment.model';
import type { WeaponType } from '../weapon-types.model';
import {
    CORE_2026_GAME_RULES,
    ESCALATING_FAILURE_AUTO_FAIL_TARGET,
    ESCALATING_FAILURE_NO_CHECK_TARGET,
    TW_GAME_RULES,
    separateHeatFireModifier,
    type MekImmediateCriticalExplosionContext,
} from './game-rules';

let entryId = 0;

function owner() {
    return {
        getEquipmentStatus: (candidate: MountedEquipment) => candidate.committedDestroyed() ? 'destroyed' : 'available',
        isEquipmentOperational: (candidate: MountedEquipment) => !candidate.committedDestroyed(),
    } as never;
}

function mountedEntry(flags: EquipmentFlag[] = []): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `entry-${entryId++}`,
        name: 'Entry',
        equipment: { flags: new Set(flags) } as Equipment
    });
}

function mountedWeapon(toHitModifier: number | number[], linkedWith: MountedEquipment[] = []): MountedEquipment {
    return new MountedEquipment({
        owner: owner(),
        id: `weapon-${entryId++}`,
        name: 'Weapon',
        equipment: new WeaponEquipment({
            id: 'TestWeapon',
            name: 'Test weapon',
            type: 'weapon',
            stats: { toHitModifier },
            weapon: { ammoType: 'NA', ranges: [1, 2, 3, 4] }
        }),
        linkedWith
    });
}

function physicalAttack(name: string): MountedEquipment {
    return new MountedEquipment({ owner: owner(), id: name, name, intrinsicPhysicalAttack: true });
}

function criticalExplosionContext(
    hitEntry: MountedEquipment,
    options: {
        readonly types?: readonly WeaponType[];
        readonly remainingAmmoDamage?: number;
        readonly remainingAmmoShots?: number;
        readonly mountedCriticalSlots?: number;
        readonly componentCriticalHits?: number;
        readonly operational?: boolean;
        readonly usableAmmo?: boolean;
    } = {},
): MekImmediateCriticalExplosionContext {
    return {
        hitEntry,
        hitEquipment: hitEntry.equipment ?? null,
        remainingAmmoDamage: options.remainingAmmoDamage ?? 0,
        remainingAmmoShots: options.remainingAmmoShots ?? 0,
        mountedCriticalSlots: options.mountedCriticalSlots ?? 1,
        previousComponentCriticalHits: options.componentCriticalHits ?? 0,
        explosiveWeapon: options.types?.includes('X') === true,
        parentOperational: options.operational !== false,
        hasUsableAmmo: options.usableAmmo !== false,
    };
}

function tagBvContext(options: {
    tagCount?: number;
    unavailableTagIndexes?: number[];
    guidedAmmo?: boolean;
    ammoAvailable?: boolean;
    compatibleLauncher?: boolean;
    homingAmmo?: boolean;
    loaded?: boolean;
    launcherAvailable?: boolean;
    unitType?: 'Mek' | 'Tank';
} = {}) {
    const unavailable = new Set<MountedEquipment>();
    const tagUnit = {
        getOperationalMountedEquipmentByFlag: () => tagMounts.filter(mount => !unavailable.has(mount)),
        force: { units: () => [ammoUnit] },
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    const tagMounts = Array.from({ length: options.tagCount ?? 1 }, (_, index) => new MountedEquipment({
        owner: tagUnit,
        id: `tag-${index}`,
        name: 'TAG',
        equipment: { flags: new Set(['F_TAG']) } as Equipment,
        states: new Map(),
    }));
    for (const index of options.unavailableTagIndexes ?? []) unavailable.add(tagMounts[index]);

    let launcher!: MountedEquipment;
    let ammo!: MountedEquipment;
    const ammoUnit = {
        isLoaded: () => options.loaded !== false,
        getUnit: () => ({ type: options.unitType ?? 'Tank' }),
        getInventory: () => options.unitType === 'Mek' ? [launcher] : [launcher, ammo],
        getCritSlots: () => options.unitType === 'Mek' ? [{
            id: 'ammo-crit', eq: ammo.equipment, totalAmmo: ammo.totalAmmo, consumed: ammo.consumed,
        }] : [],
        isEquipmentOperational: (entry: MountedEquipment) => !unavailable.has(entry),
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    launcher = new MountedEquipment({
        owner: ammoUnit,
        id: 'launcher',
        name: 'LRM Launcher',
        equipment: new WeaponEquipment({
            id: 'LRM20', name: 'LRM 20', type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: options.compatibleLauncher === false ? 15 : 20 },
        }),
        states: new Map(),
    });
    ammo = new MountedEquipment({
        owner: ammoUnit,
        id: 'ammo',
        name: 'Semi-Guided LRM 20 Ammo',
        equipment: new AmmoEquipment({
            id: 'LRM20SG', name: 'Semi-Guided LRM 20 Ammo', type: 'ammo',
            stats: { bv: 30 },
            ammo: {
                type: 'LRM', rackSize: 20, shots: 6,
                munitionType: options.guidedAmmo === false
                    ? []
                    : [options.homingAmmo ? 'M_HOMING' : 'M_SEMIGUIDED'],
            },
        }),
        totalAmmo: 6,
        consumed: options.ammoAvailable === false ? 6 : 0,
        states: new Map(),
    });
    if (options.ammoAvailable === false) unavailable.add(ammo);
    if (options.launcherAvailable === false) unavailable.add(launcher);

    return { tagUnit, tagMounts, unavailable };
}

function vehicleTagBvContext(options: {
    tagCount?: number;
    baseGuided?: boolean;
    selectedAmmo?: 'resolved' | 'missing';
    selectedGuided?: boolean;
    selectedAmmoBV?: number | 'variable';
} = {}) {
    const unavailable = new Set<MountedEquipment>();
    const baseAmmo = new AmmoEquipment({
        id: 'LRM20BaseAmmo',
        name: 'LRM 20 Ammo',
        type: 'ammo',
        stats: { bv: 23 },
        ammo: {
            type: 'LRM',
            rackSize: 20,
            shots: 6,
            munitionType: options.baseGuided ? ['M_SEMIGUIDED'] : [],
        },
    });
    const selectedAmmo = new AmmoEquipment({
        id: 'LRM20SelectedAmmo',
        name: 'LRM 20 Semi-Guided Ammo',
        type: 'ammo',
        stats: { bv: options.selectedAmmoBV ?? 37 },
        ammo: {
            type: 'LRM',
            rackSize: 20,
            shots: 6,
            munitionType: options.selectedGuided === false ? [] : ['M_SEMIGUIDED'],
        },
    });
    const registry = new EquipmentRegistry({
        [baseAmmo.id]: baseAmmo,
        [selectedAmmo.id]: selectedAmmo,
    });
    let launcher!: MountedEquipment;
    let ammo!: MountedEquipment;
    const ammoUnit = {
        isLoaded: () => true,
        getUnit: () => ({ type: 'Tank' }),
        getInventory: () => [launcher, ammo],
        getCritSlots: () => [],
        getEquipmentRegistry: () => registry,
        isEquipmentOperational: (entry: MountedEquipment) => !unavailable.has(entry),
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    launcher = new MountedEquipment({
        owner: ammoUnit,
        id: 'launcher',
        name: 'LRM 20',
        equipment: new WeaponEquipment({
            id: 'LRM20',
            name: 'LRM 20',
            type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: 20 },
        }),
        states: new Map(),
    });
    ammo = new MountedEquipment({
        owner: ammoUnit,
        id: 'ammo',
        name: baseAmmo.id,
        equipment: baseAmmo,
        ammo: options.selectedAmmo === 'missing' ? 'MissingAmmo' : selectedAmmo.id,
        totalAmmo: 6,
        states: new Map(),
    });

    const tagUnit = {
        getOperationalMountedEquipmentByFlag: () => tagMounts.filter(mount => !unavailable.has(mount)),
        force: { units: () => [ammoUnit] },
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    const tagMounts = Array.from({ length: options.tagCount ?? 1 }, (_, index) => new MountedEquipment({
        owner: tagUnit,
        id: `tag-${index}`,
        name: 'TAG',
        equipment: { flags: new Set(['F_TAG']) } as Equipment,
        states: new Map(),
    }));

    return { tagUnit, tagMounts, unavailable };
}

function coreTagBvContext(options: {
    tagCount?: number;
    launcherCount?: number;
    ammoType?: 'ARROW_IV' | 'LONG_TOM';
    homingAmmo?: boolean;
    ammoAvailable?: boolean;
    loaded?: boolean;
    unitType?: 'Mek' | 'Tank';
} = {}) {
    const unavailable = new Set<MountedEquipment>();
    let launchers: MountedEquipment[] = [];
    let ammo!: MountedEquipment;
    const ammoType = options.ammoType ?? 'ARROW_IV';
    const ammoUnit = {
        isLoaded: () => options.loaded !== false,
        getUnit: () => ({ type: options.unitType ?? 'Tank' }),
        getInventory: () => options.unitType === 'Mek' ? launchers : [...launchers, ammo],
        getCritSlots: () => options.unitType === 'Mek' ? [{
            id: 'ammo-crit', eq: ammo.equipment, totalAmmo: ammo.totalAmmo, consumed: ammo.consumed,
        }] : [],
        isEquipmentOperational: (entry: MountedEquipment) => !unavailable.has(entry),
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    launchers = Array.from({ length: options.launcherCount ?? 1 }, (_, index) => new MountedEquipment({
        owner: ammoUnit,
        id: `arrow-${index}`,
        name: 'Arrow IV',
        equipment: new WeaponEquipment({
            id: `ARROW_IV_${index}`,
            name: 'Arrow IV',
            type: 'weapon',
            flags: ['F_ARTILLERY'],
            weapon: { ammoType, rackSize: 10 },
        }),
        states: new Map(),
    }));
    ammo = new MountedEquipment({
        owner: ammoUnit,
        id: 'ammo',
        name: 'Arrow IV Homing Ammo',
        equipment: new AmmoEquipment({
            id: 'ARROW_IV_HOMING',
            name: 'Arrow IV Homing Ammo',
            type: 'ammo',
            ammo: {
                type: ammoType, rackSize: 10, shots: 1,
                munitionType: options.homingAmmo === false ? [] : ['M_HOMING'],
            },
        }),
        totalAmmo: 1,
        consumed: options.ammoAvailable === false ? 1 : 0,
        states: new Map(),
    });
    const tagUnit = {
        getOperationalMountedEquipmentByFlag: () => tagMounts.filter(mount => !unavailable.has(mount)),
        force: { units: () => [ammoUnit] },
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    const tagMounts = Array.from({ length: options.tagCount ?? 1 }, (_, index) => new MountedEquipment({
        owner: tagUnit,
        id: `tag-${index}`,
        name: 'TAG',
        equipment: { flags: new Set(['F_TAG']) } as Equipment,
        states: new Map(),
    }));

    return { tagUnit, launchers, ammo, tagMounts, unavailable };
}

describe('game rules', () => {
    it('declares whether consciousness rolls accumulate phase damage', () => {
        expect(CORE_2026_GAME_RULES.aggregatedEndPhaseConsciousRolls).toBeTrue();
        expect(TW_GAME_RULES.aggregatedEndPhaseConsciousRolls).toBeFalse();
    });

    it('defines the ruleset-specific Machine Gun Array cluster modifier', () => {
        expect(CORE_2026_GAME_RULES.machineGunArrayClusterModifier).toBe(2);
        expect(TW_GAME_RULES.machineGunArrayClusterModifier).toBe(0);
    });

    it('owns the ruleset-specific hull-breach result and label', () => {
        expect(CORE_2026_GAME_RULES.getHullBreachCheckRangeLabel()).toBe('2–4');
        expect(CORE_2026_GAME_RULES.hullBreachCheckSucceeds(2)).toBeTrue();
        expect(CORE_2026_GAME_RULES.hullBreachCheckSucceeds(4)).toBeTrue();
        expect(CORE_2026_GAME_RULES.hullBreachCheckSucceeds(5)).toBeFalse();

        expect(TW_GAME_RULES.getHullBreachCheckRangeLabel()).toBe('10+');
        expect(TW_GAME_RULES.hullBreachCheckSucceeds(9)).toBeFalse();
        expect(TW_GAME_RULES.hullBreachCheckSucceeds(10)).toBeTrue();
        expect(TW_GAME_RULES.hullBreachCheckSucceeds(12)).toBeTrue();
    });

    describe('escalating failure targets', () => {
        it('uses the standardized numeric Core sequence for every checked component', () => {
            const standard = [3, 5, 7, 10, 11] as const;

            expect(CORE_2026_GAME_RULES.escalatingFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.radicalHeatSinkFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.emergencyCoolantSystemFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.viralJammerFailureTargets).toEqual(standard);
            expect(CORE_2026_GAME_RULES.blueShieldFailureTargets).toEqual([
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ESCALATING_FAILURE_NO_CHECK_TARGET,
                ...standard,
            ]);
        });

        it('preserves numeric legacy TW component sequences', () => {
            expect(TW_GAME_RULES.escalatingFailureTargets).toEqual([
                3, 5, 7, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.radicalHeatSinkFailureTargets).toEqual([
                3, 5, 7, 10, 11, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.blueShieldFailureTargets).toEqual([
                0, 0, 0, 0, 0, 0,
                3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
                ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.emergencyCoolantSystemFailureTargets).toEqual([
                3, 5, 7, 10, ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
            expect(TW_GAME_RULES.viralJammerFailureTargets).toEqual([
                4, 5, 6, 7, 8, 9, 10, 11, 12,
                ESCALATING_FAILURE_AUTO_FAIL_TARGET,
            ]);
        });
    });

    describe('C3 degradation', () => {
        const target = {
            id: 'A', letter: 'A', name: 'Target', color: '#000',
            distance: 15, c3Distance: 12, useC3: true, tnModifier: 0
        } as const;

        it('preserves C3 and returns the Core ECM bracket-improvement modifier', () => {
            const resolution = CORE_2026_GAME_RULES.resolveC3Targeting(target, 'network-member');

            expect(CORE_2026_GAME_RULES.c3DegradationLabel).toBe('DEGRADED');
            expect(resolution.target).toBe(target);
            expect(resolution.degradationSource).toBe('network-member');
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('network-member', 2)).toEqual({
                label: 'ECM', modifier: 2, weakened: true
            });
        });

        it('does not add a Core modifier without degradation or bracket improvement', () => {
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('none', 2)).toBeNull();
            expect(CORE_2026_GAME_RULES.resolveC3TargetingModifier('unit', 0)).toBeNull();
        });

        it('removes C3 from Total Warfare calculations without mutating the target', () => {
            const resolution = TW_GAME_RULES.resolveC3Targeting(target, 'unit');

            expect(TW_GAME_RULES.c3DegradationLabel).toBe('JAMMED');
            expect(resolution.target.c3Distance).toBeUndefined();
            expect(resolution.target.useC3).toBeTrue();
            expect(resolution.degradationSource).toBe('unit');
            expect(target.c3Distance).toBe(12);
            expect(TW_GAME_RULES.resolveC3TargetingModifier('unit', 2)).toBeNull();
        });

        it('preserves an unaffected Total Warfare target by reference', () => {
            expect(TW_GAME_RULES.resolveC3Targeting(target, 'none').target).toBe(target);
        });
    });

    describe('indirect-fire ammunition legality', () => {
        const dryContext = { weaponUnderwater: false, targetHasUnderwaterLayer: false } as const;
        const underwaterContext = { weaponUnderwater: true, targetHasUnderwaterLayer: true } as const;
        const launcher = (ammoType: 'LRM' | 'MML', indirect = true) => new MountedEquipment({
            owner: owner(),
            id: `indirect-${entryId++}`,
            name: 'Launcher',
            equipment: new WeaponEquipment({
                id: `Launcher-${entryId++}`,
                name: 'Launcher',
                type: 'weapon',
                flags: indirect ? ['F_INDIRECT_FIRE'] : [],
                weapon: { ammoType, rackSize: ammoType === 'MML' ? 9 : 10 },
            }),
        });
        const ammunition = (
            id: string,
            ammoType: 'LRM' | 'MML',
            flags: EquipmentFlag[] = [],
            torpedo = false,
        ) => new AmmoEquipment({
            id,
            name: id,
            shortName: id,
            type: 'ammo',
            flags,
            ammo: {
                type: ammoType,
                rackSize: ammoType === 'MML' ? 9 : 10,
                shots: 12,
                munitionType: torpedo ? ['M_TORPEDO'] : [],
            },
        });

        it('requires an indirect launcher and the LRM profile for MML ammunition', () => {
            const standardLrm = ammunition('LRM Ammo', 'LRM');
            const mmlLrm = ammunition('MML LRM Ammo', 'MML', ['F_MML_LRM']);
            const mmlSrm = ammunition('MML SRM Ammo', 'MML', ['F_MML_SRM']);

            expect(CORE_2026_GAME_RULES.canFireIndirectly(launcher('LRM', false), standardLrm, dryContext)).toBeFalse();
            expect(CORE_2026_GAME_RULES.canFireIndirectly(launcher('LRM'), standardLrm, dryContext)).toBeTrue();
            expect(CORE_2026_GAME_RULES.canFireIndirectly(launcher('MML'), mmlLrm, dryContext)).toBeTrue();
            expect(CORE_2026_GAME_RULES.canFireIndirectly(launcher('MML'), mmlSrm, dryContext)).toBeFalse();
            expect(TW_GAME_RULES.canFireIndirectly(launcher('MML'), mmlLrm, dryContext)).toBeTrue();
            expect(TW_GAME_RULES.canFireIndirectly(launcher('MML'), mmlSrm, dryContext)).toBeFalse();
        });

        it('forbids Core torpedo indirect fire and requires both TW endpoints underwater', () => {
            const lrm = launcher('LRM');
            const torpedo = ammunition('LRM Torpedo Ammo', 'LRM', [], true);

            expect(CORE_2026_GAME_RULES.canFireIndirectly(lrm, torpedo, underwaterContext)).toBeFalse();
            expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, dryContext)).toBeFalse();
            expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, {
                weaponUnderwater: true,
                targetHasUnderwaterLayer: false,
            })).toBeFalse();
            expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, {
                weaponUnderwater: false,
                targetHasUnderwaterLayer: true,
            })).toBeFalse();
            expect(TW_GAME_RULES.canFireIndirectly(lrm, torpedo, underwaterContext)).toBeTrue();
        });
    });

    it('resolves the Core 2026 MRM modifier as zero in Core 2026 and one in TW', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: 0 },
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM' }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(1);
    });

    it('calculates special ammo shots according to each ruleset', () => {
        const baseAmmo = new AmmoEquipment({
            id: 'AC5Ammo', name: 'AC/5 Ammo', type: 'ammo',
            ammo: { type: 'AC', shots: 10 }
        });
        const precisionAmmo = new AmmoEquipment({
            id: 'PrecisionAC5', name: 'Precision AC/5', type: 'ammo',
            ammo: { type: 'AC', shots: 20, baseAmmo: baseAmmo.id, munitionType: ['M_PRECISION'] }
        });
        const armorPiercingAmmo = new AmmoEquipment({
            id: 'ArmorPiercingAC5', name: 'Armor-Piercing AC/5', type: 'ammo',
            ammo: { type: 'AC', shots: 20, kgPerShot: 50, baseAmmo: baseAmmo.id, munitionType: ['M_ARMOR_PIERCING'] }
        });
        const axHeadAmmo = new AmmoEquipment({
            id: 'AxHeadAC5', name: 'AX HEAD AC/5 Ammo', type: 'ammo',
            ammo: { type: 'AC', shots: 20, baseAmmo: baseAmmo.id, munitionType: ['M_AX_HEAD'] }
        });
        const registry = new EquipmentRegistry({
            [baseAmmo.id]: baseAmmo,
            [precisionAmmo.id]: precisionAmmo,
            [armorPiercingAmmo.id]: armorPiercingAmmo,
            [axHeadAmmo.id]: axHeadAmmo,
        });

        expect(precisionAmmo.getShots(CORE_2026_GAME_RULES, registry)).toBe(6);
        expect(armorPiercingAmmo.getShots(CORE_2026_GAME_RULES, registry)).toBe(8);
        expect(axHeadAmmo.getShots(CORE_2026_GAME_RULES, registry)).toBe(10);
        expect(precisionAmmo.getShots(CORE_2026_GAME_RULES)).toBe(20);
        expect(precisionAmmo.getShots(TW_GAME_RULES, registry)).toBe(5);
        expect(armorPiercingAmmo.getShots(TW_GAME_RULES, registry)).toBe(5);
        expect(axHeadAmmo.getShots(TW_GAME_RULES, registry)).toBe(5);
        expect(precisionAmmo.getEffectiveKgPerShot(CORE_2026_GAME_RULES, registry)).toBe(1000 / 6);
        expect(precisionAmmo.getEffectiveKgPerShot(TW_GAME_RULES, registry)).toBe(1000 / 5);
        expect(armorPiercingAmmo.getEffectiveKgPerShot(CORE_2026_GAME_RULES, registry)).toBe(1000 / 8);
        expect(armorPiercingAmmo.getEffectiveKgPerShot(TW_GAME_RULES, registry)).toBe(200);
    });

    it('resolves M_AX_HEAD BV from base ammo according to each ruleset', () => {
        const baseAmmo = new AmmoEquipment({
            id: 'AC2Ammo', name: 'AC/2 Ammo', type: 'ammo',
            stats: { bv: 12 },
            ammo: { type: 'AC', shots: 45 },
        });
        const axHeadAmmo = new AmmoEquipment({
            id: 'AxHeadAC2', name: 'AX HEAD AC/2 Ammo', type: 'ammo',
            stats: { bv: 99 }, // some ridiculous value we ignore because we calculate it
            ammo: {
                type: 'AC', shots: 1, baseAmmo: baseAmmo.id,
                munitionType: ['M_AX_HEAD'],
            },
        });
        const registry = new EquipmentRegistry({
            [baseAmmo.id]: baseAmmo,
            [axHeadAmmo.id]: axHeadAmmo,
        });

        expect(CORE_2026_GAME_RULES.getAmmoBV(axHeadAmmo, registry)).toBe(12);
        expect(TW_GAME_RULES.getAmmoBV(axHeadAmmo, registry)).toBe(24);
    });

    describe('Total Warfare TAG BV', () => {
        it('multiplies compatible guided-ammo BV by operational mounted TAG count', () => {
            const { tagUnit } = tagBvContext({ tagCount: 2 });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(60);
        });

        it('excludes unavailable mounted TAG systems', () => {
            const { tagUnit } = tagBvContext({ tagCount: 2, unavailableTagIndexes: [1] });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(30);
        });

        it('requires usable guided ammo and a compatible operational launcher', () => {
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ guidedAmmo: false }).tagUnit)).toBe(0);
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ ammoAvailable: false }).tagUnit)).toBe(0);
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ compatibleLauncher: false }).tagUnit)).toBe(0);
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ launcherAvailable: false }).tagUnit)).toBe(0);
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ loaded: false }).tagUnit)).toBe(0);
        });

        it('counts homing ammo and Mek critical-slot ammo', () => {
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ homingAmmo: true }).tagUnit)).toBe(30);
            expect(TW_GAME_RULES.calculateTagBVCost(tagBvContext({ unitType: 'Mek' }).tagUnit)).toBe(30);
        });

        it('uses selected guided ammo and its BV for non-Mek inventory mounts', () => {
            const { tagUnit } = vehicleTagBvContext({
                tagCount: 2,
                baseGuided: false,
                selectedGuided: true,
                selectedAmmoBV: 37,
            });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(74);
        });

        it('does not treat a selected non-guided ammo override as guided', () => {
            const { tagUnit } = vehicleTagBvContext({
                baseGuided: true,
                selectedGuided: false,
            });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(0);
        });

        it('falls back to the mounted base ammo when the selected ammo cannot be resolved', () => {
            const { tagUnit } = vehicleTagBvContext({
                baseGuided: true,
                selectedAmmo: 'missing',
            });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(23);
        });

        it('excludes selected guided ammo with variable BV', () => {
            const { tagUnit } = vehicleTagBvContext({ selectedAmmoBV: 'variable' });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(0);
        });

        it('returns zero when no mounted TAG system is operational', () => {
            const { tagUnit } = tagBvContext({ tagCount: 1, unavailableTagIndexes: [0] });

            expect(TW_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(0);
        });
    });

    describe('Core 2026 TAG BV', () => {
        it('charges 50 BV per Arrow IV launcher for each operational TAG instance', () => {
            const { tagUnit } = coreTagBvContext({ tagCount: 2, launcherCount: 3 });

            expect(CORE_2026_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(300);
        });

        it('recognizes homing ammunition without restricting the artillery type', () => {
            const { tagUnit } = coreTagBvContext({ ammoType: 'LONG_TOM' });

            expect(CORE_2026_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(50);
        });

        it('counts Arrow IV launchers with homing ammo in Mek critical slots', () => {
            const { tagUnit } = coreTagBvContext({ unitType: 'Mek' });

            expect(CORE_2026_GAME_RULES.calculateTagBVCost(tagUnit)).toBe(50);
        });

        it('requires loaded, usable homing Arrow IV ammo', () => {
            expect(CORE_2026_GAME_RULES.calculateTagBVCost(coreTagBvContext({ homingAmmo: false }).tagUnit)).toBe(0);
            expect(CORE_2026_GAME_RULES.calculateTagBVCost(coreTagBvContext({ ammoAvailable: false }).tagUnit)).toBe(0);
            expect(CORE_2026_GAME_RULES.calculateTagBVCost(coreTagBvContext({ loaded: false }).tagUnit)).toBe(0);
            expect(CORE_2026_GAME_RULES.calculateTagBVCost(tagBvContext().tagUnit)).toBe(0);
        });
    });

    it('keeps the Core 2026 claw hit modifier at zero and adds one under TW', () => {
        const claw = new WeaponEquipment({
            id: 'BattleClaw', name: 'Battle Claw', type: 'weapon',
            flags: ['S_CLAW'], stats: { toHitModifier: 0 }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([0]);
        expect(TW_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([1]);
    });

    it('resolves scalar and range-specific mounted weapon hit modifiers', () => {
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mountedWeapon(-2) }).value).toBe(-2);

        const weapon = mountedWeapon([-3, -2, -1]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon }).value).toBe('*');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'short' }).value).toBe(-3);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'medium' }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'long' }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon, range: 'extreme' }).value).toBe(-1);
    });

    it('replaces the base while preserving explicit zero', () => {
        const weapon = mountedWeapon(-2);

        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: weapon,
            adjustments: [{ kind: 'replace-base', value: 0, label: 'Explicit Zero Override' }]
        });

        expect(resolution.value).toBe(0);
        expect(resolution.changed).toBeTrue();
        expect(resolution.weakened).toBeFalse();
    });

    it('keeps the first and highest-priority base replacement', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [
                { kind: 'replace-base', value: 0, label: 'First Base Override' },
                { kind: 'replace-base', value: 4, label: 'Second Base Override' },
                { kind: 'add', modifier: 1, label: 'Positive Adjustment' }
            ]
        });

        expect(resolution.value).toBe(1);
        expect(resolution.profile).toEqual([1]);
    });

    it('resolves ruleset-specific physical attack modifiers', () => {
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') })).toEqual(jasmine.objectContaining({
            value: -1,
            modifierBreakdown: [{ label: 'Base Hit Modifier', modifier: -1 }],
        }));
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('Punch') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('club') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('push') }).value).toBe(-1);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('charge') }).value).toBe('Vs');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('death from above') }).value).toBe('Vs');
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: physicalAttack('frenzy') }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('punch') }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: physicalAttack('kick') }).value).toBe(-2);
    });

    it('uses equipment data for mounted physical weapon modifiers', () => {
        const sword = new MountedEquipment({
            owner: owner(),
            id: 'sword',
            name: 'Sword',
            equipment: new MiscEquipment({
                id: 'Sword',
                name: 'Sword',
                type: 'misc',
                flags: ['F_HAND_WEAPON'],
                stats: { toHitModifier: -2 }
            })
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: sword }).value).toBe(-2);
    });

    it('includes resolved linked modifiers in final hit modifiers', () => {
        const launcher = mountedWeapon(-1, [mountedEntry(['F_WEAPON_ENHANCEMENT'])]);

        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: launcher,
            adjustments: [{ kind: 'add', label: 'Linked equipment', modifier: 1 }]
        }).value).toBe(0);
    });

    it('reports changed and weakened metadata without a second resolution', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            stateModifiers: [{ label: 'Hit Modifier', modifier: 1 }],
            adjustments: [{
                kind: 'add',
                label: 'Lost bonus',
                modifier: 0,
                weakened: true,
            }]
        });

        expect(resolution).toEqual({
            profile: [-1], value: -1, changed: true, weakened: true,
            modifierBreakdown: [
                { label: 'Base Hit Modifier', modifier: -2 },
                { label: 'Hit Modifier', modifier: 1 },
                { label: 'Lost bonus', modifier: 0, weakened: true },
            ]
        });
    });

    it('marks a canceled adverse state modifier as weakened', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(0),
            stateModifiers: [
                { label: 'Targeting Computer', modifier: -1 },
                { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }
            ]
        });

        expect(resolution.value).toBe(0);
        expect(resolution.changed).toBeFalse();
        expect(resolution.weakened).toBeTrue();
        expect(resolution.modifierBreakdown).toEqual([
            { label: 'Targeting Computer', modifier: -1 },
            { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }
        ]);
    });

    it('derives adverse state totals from their provenance', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(0),
            stateModifiers: [{ label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }]
        });

        expect(resolution.value).toBe(1);
        expect(resolution.weakened).toBeTrue();
        expect(resolution.modifierBreakdown).toEqual([
            { label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }
        ]);
    });

    it('preserves named state and equipment adjustment sources', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(0),
            range: 'medium',
            stateModifiers: [{ label: 'Targeting Computer', modifier: -1 }],
            adjustments: [{
                kind: 'add', label: 'Apollo MRM FCS', modifier: -1
            }]
        });

        expect(resolution.value).toBe(-2);
        expect(resolution.modifierBreakdown).toEqual([
            { label: 'Targeting Computer', modifier: -1 },
            { label: 'Apollo MRM FCS', modifier: -1 }
        ]);
    });

    it('uses named replacement and state sources', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(1),
            stateModifiers: [{ label: 'State Modifier', modifier: 2 }],
            adjustments: [{ kind: 'replace-base', value: -2, label: 'Vibroblade' }]
        });

        expect(resolution.modifierBreakdown).toEqual([
            { label: 'Vibroblade', modifier: -2 },
            { label: 'State Modifier', modifier: 2 }
        ]);
    });

    it('separates heat by typed provenance without relying on its label', () => {
        const separated = separateHeatFireModifier({
            profile: [2],
            value: 2,
            changed: true,
            weakened: true,
            modifierBreakdown: [
                { label: 'Targeting Computer', modifier: -1 },
                { label: 'Localized heat label', modifier: 3, weakened: true, kind: 'heat' }
            ]
        });

        expect(separated).toEqual({
            hitModifier: -1,
            hitModifierBreakdown: [{ label: 'Targeting Computer', modifier: -1 }],
            heatFireModifier: 3
        });
    });

    it('supports explicit rejection and no-range boundary cases', () => {
        const weapon = mountedWeapon(-2);
        const noRange = weapon.equipment as WeaponEquipment;
        noRange.weapon.ranges.fill(0);

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: weapon }).value).toBeNull();
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: weapon,
            adjustments: [{ kind: 'replace-base', value: -2, label: 'No-Range Override' }]
        }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [{ kind: 'unsupported' }]
        }).value).toBeNull();
    });
});

describe('Mek explosion rules', () => {
    it('uses effective X as the sole weapon explosion eligibility gate', () => {
        const equipment = new WeaponEquipment({
            id: 'ExplosiveWeapon',
            name: 'Explosive weapon',
            type: 'weapon',
            stats: { explosive: true, criticalSlots: 4 },
            weapon: { explosionDamage: 15 },
        });
        const entry = new MountedWeapon({
            owner: owner(), id: 'explosive-weapon', name: equipment.name, equipment,
        });

        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { mountedCriticalSlots: 4 }),
        )).toBeNull();
        expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { mountedCriticalSlots: 4 }),
        )).toBeNull();

        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { types: ['X'], mountedCriticalSlots: 4 }),
        )).toEqual(jasmine.objectContaining({ rawDamage: 8 }));
        expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { types: ['X'], mountedCriticalSlots: 4 }),
        )).toEqual(jasmine.objectContaining({ rawDamage: 15 }));
    });

    it('requires the explosive flag for miscellaneous equipment', () => {
        const explosive = new MountedEquipment({
            owner: owner(),
            id: 'explosive-misc',
            name: 'Explosive misc',
            equipment: new MiscEquipment({
                id: 'ExplosiveMisc', name: 'Explosive misc', type: 'misc',
                stats: { explosive: true },
            }),
        });
        const inert = new MountedEquipment({
            owner: owner(),
            id: 'inert-misc',
            name: 'Inert misc',
            equipment: new MiscEquipment({
                id: 'InertMisc', name: 'Inert misc', type: 'misc',
                stats: { explosive: false },
            }),
        });

        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(explosive, { mountedCriticalSlots: 3 }),
        )).toEqual(jasmine.objectContaining({ rawDamage: 6 }));
        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(inert, { mountedCriticalSlots: 3 }),
        )).toBeNull();
    });

    it('resolves stateful and fixed-damage miscellaneous explosions', () => {
        const blueShield = new MountedEquipment({
            owner: owner(),
            id: 'blue-shield',
            name: 'Blue Shield',
            states: new Map([['blueShieldUsedThisTurn', 'true']]),
            equipment: new MiscEquipment({
                id: 'BlueShield', name: 'Blue Shield', type: 'misc',
                flags: ['F_BLUE_SHIELD'], stats: { explosive: true },
            }),
        });
        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(blueShield),
        )).toEqual(jasmine.objectContaining({ rawDamage: 5 }));
        blueShield.states.delete('blueShieldUsedThisTurn');
        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(blueShield),
        )).toBeNull();

        for (const [flags, expectedDamage] of [
            [['F_JUMP_JET', 'S_IMPROVED', 'S_PROTOTYPE'], 10],
            [['F_EMERGENCY_COOLANT_SYSTEM'], 5],
            [['F_FUEL'], 20],
        ] as const) {
            const equipment = new MiscEquipment({
                id: flags[0], name: flags[0], type: 'misc',
                flags: [...flags], stats: { explosive: true },
            });
            const entry = new MountedEquipment({
                owner: owner(), id: flags[0], name: flags[0], equipment,
            });
            expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(criticalExplosionContext(entry)))
                .withContext(flags.join(' + '))
                .toEqual(jasmine.objectContaining({ rawDamage: expectedDamage }));
        }
    });

    it('replaces the RISC pulse-module follow-up check with its linked laser critical', () => {
        const laserEquipment = new WeaponEquipment({
            id: 'MediumLaser', name: 'Medium Laser', type: 'weapon',
            flags: ['F_ENERGY', 'F_LASER'],
        });
        const laser = new MountedWeapon({
            owner: owner(), id: 'laser', name: laserEquipment.name, equipment: laserEquipment,
        });
        const module = new MountedEquipment({
            owner: laser.owner,
            id: 'pulse-module',
            name: 'RISC Laser Pulse Module',
            parent: laser,
            equipment: new MiscEquipment({
                id: 'RISCLaserPulseModule', name: 'RISC Laser Pulse Module', type: 'misc',
                flags: ['F_WEAPON_ENHANCEMENT', 'F_RISC_LASER_PULSE_MODULE'],
                stats: { explosive: true },
            }),
        });

        expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(criticalExplosionContext(module)))
            .toEqual(jasmine.objectContaining({ rawDamage: 2, automaticCriticalEntry: laser }));
        expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(module, { operational: false }),
        )).toBeNull();
    });

    it('explodes only unused coolant pods using the active ruleset damage', () => {
        const equipment = new AmmoEquipment({
            id: 'CoolantPod', name: 'Coolant Pod', type: 'ammo',
            ammo: { type: 'COOLANT_POD', shots: 1 },
        });
        const entry = new MountedEquipment({
            owner: owner(), id: 'coolant-pod', name: equipment.name, equipment,
        });

        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { remainingAmmoShots: 1 }),
        )).toEqual(jasmine.objectContaining({ rawDamage: 2 }));
        expect(TW_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry, { remainingAmmoShots: 1 }),
        )).toEqual(jasmine.objectContaining({ rawDamage: 10 }));
        expect(CORE_2026_GAME_RULES.getMekImmediateCriticalExplosion(
            criticalExplosionContext(entry),
        )).toBeNull();
    });

    it('uses mounted critical slots and the Core 20-point cap', () => {
        const weapon = mountedWeapon(0).equipment as WeaponEquipment;

        expect(CORE_2026_GAME_RULES.getExplosiveWeaponDamage(weapon, 4)).toBe(8);
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'none',
            remainingInternal: 12,
            remainingArmor: 8,
            originalArmor: 8,
            torso: true,
        })).toEqual({
            internalDamage: 20,
            armorDamage: 0,
            armorRear: true,
            stopsTransfer: false,
        });
    });

    it('applies the Core armor blowout only when the standard cap is exceeded', () => {
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 20,
            protection: 'none',
            remainingInternal: 25,
            remainingArmor: 8,
            originalArmor: 8,
            torso: true,
        })).toEqual({
            internalDamage: 20,
            armorDamage: 0,
            armorRear: true,
            stopsTransfer: false,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 21,
            protection: 'none',
            remainingInternal: 25,
            remainingArmor: 8,
            originalArmor: 8,
            torso: true,
        })).toEqual({
            internalDamage: 20,
            armorDamage: 8,
            armorRear: true,
            stopsTransfer: false,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 8,
            protection: 'none',
            remainingInternal: 31,
            remainingArmor: 12,
            originalArmor: 12,
            torso: true,
            armorBlowoutPending: true,
        })).toEqual({
            internalDamage: 8,
            armorDamage: 12,
            armorRear: true,
            stopsTransfer: false,
        });
    });

    it('applies Core CASE and CASE II caps and armor blowout', () => {
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'case',
            remainingInternal: 12,
            remainingArmor: 8,
            originalArmor: 8,
            torso: true,
        })).toEqual({
            internalDamage: 10,
            armorDamage: 8,
            armorRear: true,
            stopsTransfer: true,
        });
        expect(CORE_2026_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'case-ii',
            remainingInternal: 12,
            remainingArmor: 20,
            originalArmor: 20,
            torso: false,
        })).toEqual({
            internalDamage: 1,
            armorDamage: 10,
            armorRear: false,
            stopsTransfer: true,
        });
    });

    it('uses full TW damage for normal and CASE explosions', () => {
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'none',
            remainingInternal: 12,
            remainingArmor: 10,
            originalArmor: 10,
            torso: true,
        })).toEqual({
            internalDamage: 100,
            armorDamage: 0,
            armorRear: true,
            stopsTransfer: false,
        });
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'case',
            remainingInternal: 12,
            remainingArmor: 10,
            originalArmor: 10,
            torso: true,
        })).toEqual({
            internalDamage: 100,
            armorDamage: 0,
            armorRear: true,
            stopsTransfer: true,
        });
    });

    it('uses weapon explosion damage and BMM/TW CASE II venting', () => {
        const weapon = new WeaponEquipment({
            id: 'ExplosiveWeapon',
            name: 'Explosive weapon',
            type: 'weapon',
            weapon: { explosionDamage: 15 },
        });

        expect(TW_GAME_RULES.getExplosiveWeaponDamage(weapon, 4)).toBe(15);
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'case-ii',
            remainingInternal: 10,
            remainingArmor: 20,
            originalArmor: 15,
            torso: false,
        })).toEqual({
            internalDamage: 1,
            armorDamage: 8,
            armorRear: false,
            stopsTransfer: true,
        });
        expect(TW_GAME_RULES.resolveMekExplosionDamage({
            damage: 100,
            protection: 'case-ii',
            remainingInternal: 10,
            remainingArmor: 120,
            originalArmor: 120,
            torso: true,
        })).toEqual({
            internalDamage: 1,
            armorDamage: 99,
            armorRear: true,
            stopsTransfer: true,
        });
    });

    it('describes CASE effects for the active ruleset', () => {
        expect(CORE_2026_GAME_RULES.getMekExplosionProtectionNote('case')).toContain('Caps internal damage at 10');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('case')).toContain('full explosion damage');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('case-ii')).toContain('half the original armor');
        expect(TW_GAME_RULES.getMekExplosionProtectionNote('none')).toBeNull();
    });
});
