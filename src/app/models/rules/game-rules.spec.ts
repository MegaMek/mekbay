import { EquipmentFlag } from '../equipment-flags.type';
import { EquipmentRegistry } from '../equipment-lookup';
import { AmmoEquipment, MiscEquipment, WeaponEquipment, type Equipment } from '../equipment.model';
import { MountedEquipment } from '../mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, separateHeatFireModifier } from './game-rules';

let entryId = 0;

function owner() {
    return {
        rules: {
            computeEntryState: (candidate: MountedEquipment) => ({ isDamaged: candidate.committedDestroyed(), isDisabled: false, hitMod: 0 }),
            computeAllEntryStates: () => new Map(),
            heatDissipation: () => null
        }
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

    const launcher = new MountedEquipment({
        owner: null!,
        id: 'launcher',
        name: 'LRM Launcher',
        equipment: new WeaponEquipment({
            id: 'LRM20', name: 'LRM 20', type: 'weapon',
            weapon: { ammoType: 'LRM', rackSize: options.compatibleLauncher === false ? 15 : 20 },
        }),
        states: new Map(),
    });
    const ammo = new MountedEquipment({
        owner: null!,
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
    const ammoUnit = {
        isLoaded: () => options.loaded !== false,
        getUnit: () => ({ type: options.unitType ?? 'Tank' }),
        getInventory: () => options.unitType === 'Mek' ? [launcher] : [launcher, ammo],
        getCritSlots: () => options.unitType === 'Mek' ? [{
            id: 'ammo-crit', eq: ammo.equipment, totalAmmo: ammo.totalAmmo, consumed: ammo.consumed,
        }] : [],
        isEquipmentUnavailable: (entry: MountedEquipment) => unavailable.has(entry),
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    launcher.owner = ammoUnit;
    ammo.owner = ammoUnit;
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
    const launcher = new MountedEquipment({
        owner: null!,
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
    const ammo = new MountedEquipment({
        owner: null!,
        id: 'ammo',
        name: baseAmmo.id,
        equipment: baseAmmo,
        ammo: options.selectedAmmo === 'missing' ? 'MissingAmmo' : selectedAmmo.id,
        totalAmmo: 6,
        states: new Map(),
    });
    const ammoUnit = {
        isLoaded: () => true,
        getUnit: () => ({ type: 'Tank' }),
        getInventory: () => [launcher, ammo],
        getCritSlots: () => [],
        getEquipmentRegistry: () => registry,
        isEquipmentUnavailable: (entry: MountedEquipment) => unavailable.has(entry),
    } as unknown as import('../cbt-force-unit.model').CBTForceUnit;
    launcher.owner = ammoUnit;
    ammo.owner = ammoUnit;

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

describe('game rules', () => {
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

    it('reduces Core 2026 MRM hit modifiers without changing TW values', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: [-1, 0, 1] },
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM' }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([-2, -1, 0]);
        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm, range: 'medium' }).value).toBe(-1);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).profile).toEqual([-1, 0, 1]);
    });

    it('resolves the catalog MRM +1 modifier as zero in Core 2026 and one in TW', () => {
        const mrm = new WeaponEquipment({
            id: 'MRM10', name: 'MRM 10', type: 'weapon',
            stats: { toHitModifier: 1 },
            flags: ['F_MRM'],
            weapon: { ammoType: 'MRM' }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(0);
        expect(TW_GAME_RULES.resolveToHit({ subject: mrm }).value).toBe(1);
    });

    it('increases Core 2026 precision ammo shots without changing TW values', () => {
        const precisionAmmo = new AmmoEquipment({
            id: 'PrecisionAC5', name: 'Precision AC/5', type: 'ammo',
            ammo: { type: 'AC', shots: 10, munitionType: ['M_PRECISION'] }
        });

        expect(precisionAmmo.getShots(CORE_2026_GAME_RULES)).toBe(16);
        expect(precisionAmmo.getShots(TW_GAME_RULES)).toBe(10);
        expect(precisionAmmo.getEffectiveKgPerShot(CORE_2026_GAME_RULES)).toBe(62.5);
        expect(precisionAmmo.getEffectiveKgPerShot(TW_GAME_RULES)).toBe(100);
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

    it('sets Core 2026 claw and lance hit modifiers to zero without changing TW values', () => {
        const claw = new WeaponEquipment({
            id: 'BattleClaw', name: 'Battle Claw', type: 'weapon',
            flags: ['S_CLAW'], stats: { toHitModifier: -2 }
        });

        expect(CORE_2026_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([0]);
        expect(TW_GAME_RULES.resolveToHit({ subject: claw }).profile).toEqual([-2]);
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
            adjustments: [{ kind: 'replace-base', value: 0 }]
        });

        expect(resolution.value).toBe(0);
        expect(resolution.changed).toBeTrue();
        expect(resolution.weakened).toBeFalse();
    });

    it('keeps the first and highest-priority base replacement', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [
                { kind: 'replace-base', value: 0 },
                { kind: 'replace-base', value: 4 },
                { kind: 'add', modifier: 1 }
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
            adjustments: [{ kind: 'add', modifier: 1 }]
        }).value).toBe(0);
    });

    it('reports changed and weakened metadata without a second resolution', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            stateModifier: 1,
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
            stateModifier: 0,
            stateModifierBreakdown: [
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

    it('does not trust adverse provenance whose total differs from the state modifier', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(0),
            stateModifier: 0,
            stateModifierBreakdown: [{ label: 'Heat - Fire Modifier', modifier: 1, weakened: true, kind: 'heat' }]
        });

        expect(resolution.value).toBe(0);
        expect(resolution.weakened).toBeFalse();
        expect(resolution.modifierBreakdown).toEqual([]);
    });

    it('preserves named state and equipment adjustment sources', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(0),
            range: 'medium',
            stateModifier: -1,
            stateModifierBreakdown: [{ label: 'Targeting Computer', modifier: -1 }],
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

    it('uses a named replacement source and rejects an invalid source total', () => {
        const resolution = CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(1),
            stateModifier: 2,
            stateModifierBreakdown: [{ label: 'Wrong', modifier: 1 }],
            adjustments: [{ kind: 'replace-base', value: -2, label: 'Vibroblade' }]
        });

        expect(resolution.modifierBreakdown).toEqual([
            { label: 'Vibroblade', modifier: -2 },
            { label: 'Hit Modifier', modifier: 2 }
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
            adjustments: [{ kind: 'replace-base', value: -2 }]
        }).value).toBe(-2);
        expect(CORE_2026_GAME_RULES.resolveToHit({
            subject: mountedWeapon(-2),
            adjustments: [{ kind: 'unsupported' }]
        }).value).toBeNull();
    });
});