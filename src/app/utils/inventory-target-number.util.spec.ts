// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { AmmoEquipment, MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { MountedEquipment } from '../models/mounted-equipment.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules, type HitModifier, type ToHitModifierBreakdownEntry, type ToHitResolution } from '../models/rules/game-rules';
import type { InventoryTargetNumberInput } from './inventory-target-number.util';
import { compileInventoryTargetToHitModifiers, inventoryTargetEffectiveTnModifier, inventoryTargetModifierGroups, inventoryTargetNumberBreakdown, inventoryTargetNumberState, inventoryTargetRangeSelection } from './inventory-target-number.util';

function toHitResolution(
    value: HitModifier = 0,
    modifierBreakdown: readonly ToHitModifierBreakdownEntry[] = []
): ToHitResolution {
    return {
        profile: typeof value === 'number' ? [value] : [],
        value,
        changed: false,
        weakened: modifierBreakdown.some(entry => entry.weakened === true),
        modifierBreakdown,
    };
}

function artilleryInput(distance: number, gameRules: CBTGameRules = CORE_2026_GAME_RULES): InventoryTargetNumberInput {
    const owner = {} as never;
    const equipment = new WeaponEquipment({
        id: 'ArrowIV',
        name: 'Arrow IV',
        type: 'weapon',
        weapon: { ammoType: 'ARROW_IV', ranges: [10, 20, 30, 40] },
    });
    const selectedAmmo = new AmmoEquipment({
        id: 'ArrowIVAmmo',
        name: 'Arrow IV Ammo',
        type: 'ammo',
        ammo: { type: 'ARROW_IV', shots: 5 },
    });
    const entry = new MountedEquipment({ owner, id: 'arrow', name: 'Arrow IV', equipment });

    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '10', medium: '20', long: '30' },
        selectedAmmo,
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
        gameRules,
    };
}

function aeroInput(
    distance: number,
    maxRangeBracket: WeaponEquipment['maxRangeBracket'] = 'extreme',
    targetUnitType: 'aero' | 'mek-biped' = 'aero',
    capital = false
): InventoryTargetNumberInput {
    const owner = {
        getUnit: () => ({ type: 'Aero' }),
    } as never;
    const equipment = new WeaponEquipment({
        id: 'AeroWeapon',
        name: 'Aero Weapon',
        type: 'weapon',
        weapon: {
            ammoType: 'NA',
            ranges: [7, 14, 21, 28],
            av: [8, 8, 8, 8],
            maxRangeBracket,
            capital
        }
    });
    const entry = new MountedEquipment({ owner, id: 'aero-weapon', name: 'Aero Weapon', equipment });

    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '6', medium: '12', long: '20' },
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', unitType: targetUnitType, distance, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
    };
}

function c3LaserInput(actualDistance: number, c3Distance: number, allowExtremeRange = false, indirectFire = false): InventoryTargetNumberInput {
    const owner = {
        getUnit: () => ({ type: 'Mek' }),
        isEquipmentSubmerged: () => false,
        turnState: () => ({ submerged: () => false }),
    } as never;
    const equipment = new WeaponEquipment({
        id: 'ERLargeLaser',
        name: 'ER Large Laser',
        type: 'weapon',
        flags: indirectFire ? ['F_INDIRECT_FIRE'] : [],
        weapon: { ammoType: 'NA', ranges: [7, 14, 19, 25] },
    });
    const entry = new MountedEquipment({ owner, id: 'er-large-laser', name: equipment.internalName, equipment });
    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '7', medium: '14', long: '19' },
        extremeRange: 25,
        target: { id: 'A', letter: 'A', name: 'Target', color: '#000', distance: actualDistance, c3Distance, useC3: true, tnModifier: 0 },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
        c3DegradationSource: 'unit',
        allowExtremeRange,
        gameRules: CORE_2026_GAME_RULES,
    };
}

function guidedIndirectInput(
    munitionType: 'M_NARC_CAPABLE' | 'M_SEMIGUIDED',
    weaponUnderwater = false,
): InventoryTargetNumberInput {
    const owner = {
        getUnit: () => ({ type: 'Mek' }),
        isEquipmentSubmerged: () => weaponUnderwater,
        turnState: () => ({ submerged: () => false }),
    } as never;
    const equipment = new WeaponEquipment({
        id: 'LRM20',
        name: 'LRM 20',
        type: 'weapon',
        flags: ['F_INDIRECT_FIRE'],
        weapon: { ammoType: 'LRM', rackSize: 20, ranges: [7, 14, 21, 28] },
    });
    const selectedAmmo = new AmmoEquipment({
        id: `${munitionType}Ammo`,
        name: 'Guided LRM Ammo',
        type: 'ammo',
        ammo: { type: 'LRM', rackSize: 20, shots: 6, munitionType: [munitionType] },
    });
    const entry = new MountedEquipment({ owner, id: 'lrm-20', name: equipment.internalName, equipment });
    return {
        entry,
        category: 'ranged',
        display: { min: '—', short: '7', medium: '14', long: '21' },
        selectedAmmo,
        target: {
            id: 'A',
            letter: 'A',
            name: 'Target',
            color: '#000',
            distance: 5,
            tnModifier: 6,
            tnCalculator: {
                indirectFire: true,
                interveningWoods: 'light2',
                spotterMoveMode: 'run',
                spotterDeclaredAttacks: true,
            },
        },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
    };
}

function waterPartialCoverInput(
    name: string,
    intrinsicPhysicalAttack: boolean,
    nonIntrinsicPhysicalAttack = false,
    attackerSubmerged = false,
): InventoryTargetNumberInput {
    const owner = {
        getUnit: () => ({ type: 'Mek' }),
        isEquipmentSubmerged: () => attackerSubmerged,
        turnState: () => ({ submerged: () => attackerSubmerged }),
    } as never;
    const equipment = nonIntrinsicPhysicalAttack
        ? new MiscEquipment({ id: 'club', name: 'Club', type: 'misc', flags: ['F_CLUB'] })
        : new WeaponEquipment({
            id: 'laser', name: 'Laser', type: 'weapon', flags: ['F_ENERGY'],
            weapon: { ammoType: 'NA', ranges: [3, 6, 9, 12] },
        });
    const entry = new MountedEquipment({
        owner,
        id: name,
        name,
        equipment,
        intrinsicPhysicalAttack,
    });
    return {
        entry,
        category: entry.isPhysicalWeapon() ? 'physical' : 'ranged',
        display: { min: '—', short: '3', medium: '6', long: '9' },
        target: {
            id: 'A', letter: 'A', name: 'Target', color: '#000',
            unitType: 'mek-biped', distance: 1, tnModifier: 1,
            tnCalculator: { waterDepth: 'underwater-depth-1' },
        },
        gunnerySkill: 4,
        pilotingSkill: 5,
        attackModifierBreakdown: [],
        hitResolution: toHitResolution(),
    };
}

describe('inventory target number rules profiles', () => {
    it('adds +1 ECM when C3 improves long range to medium', () => {
        const state = inventoryTargetNumberState(c3LaserInput(15, 12));

        expect(state.rangeSelection?.range).toBe('medium');
        expect(state.breakdown?.total).toBe(7);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+1', weakened: true }));
    });

    it('adds +1 ECM when C3 improves medium range to short', () => {
        const state = inventoryTargetNumberState(c3LaserInput(10, 7));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.breakdown?.total).toBe(5);
    });

    it('adds +2 ECM when C3 improves long range to short', () => {
        const state = inventoryTargetNumberState(c3LaserInput(15, 7));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.breakdown?.total).toBe(6);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+2', weakened: true }));
    });

    it('does not add ECM without a C3 bracket improvement', () => {
        const sameBracket = inventoryTargetNumberState(c3LaserInput(13, 10));
        const c3DisabledInput = c3LaserInput(15, 12);
        c3DisabledInput.target = { ...c3DisabledInput.target!, useC3: false };
        const c3Disabled = inventoryTargetNumberState(c3DisabledInput);

        expect(sameBracket.breakdown?.total).toBe(6);
        expect(sameBracket.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
        expect(c3Disabled.breakdown?.total).toBe(8);
        expect(c3Disabled.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
    });

    it('adds active stealth using each weapon\'s effective range bracket', () => {
        const input = c3LaserInput(15, 12);
        input.target = {
            ...input.target!,
            tnCalculator: {
                stealth: { short: 0, medium: 1, long: 2, secondaryTargetRestricted: true },
            },
        };

        const state = inventoryTargetNumberState(input);

        expect(state.rangeSelection?.range).toBe('medium');
        expect(state.breakdown?.total).toBe(8);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({
            label: 'Stealth',
            value: '+1',
        }));
        expect(inventoryTargetEffectiveTnModifier(
            input.target!,
            input.entry,
            undefined,
            CORE_2026_GAME_RULES,
            'long',
        )).toBe(2);
    });

    it('applies the conventional-infantry exception to electronic stealth only', () => {
        const input = c3LaserInput(15, 12);
        Object.assign(input.entry.owner, {
            getUnit: () => ({ type: 'Infantry', subtype: 'Conventional Infantry' }),
        });
        input.target = {
            ...input.target!,
            tnCalculator: {
                stealth: {
                    short: 0,
                    medium: 1,
                    long: 2,
                    conventionalInfantry: { short: 0, medium: 0, long: 0 },
                },
            },
        };

        expect(inventoryTargetEffectiveTnModifier(
            input.target,
            input.entry,
            undefined,
            CORE_2026_GAME_RULES,
            'medium',
        )).toBe(0);

        input.target.tnCalculator = {
            stealth: { short: 0, medium: 1, long: 2 },
        };
        expect(inventoryTargetEffectiveTnModifier(
            input.target,
            input.entry,
            undefined,
            CORE_2026_GAME_RULES,
            'medium',
        )).toBe(1);
    });

    it('rejects secondary attacks against active Mek or vehicle stealth armor', () => {
        const input = c3LaserInput(10, 10);
        input.target = {
            ...input.target!,
            tnCalculator: {
                secondaryTarget: true,
                stealth: { short: 0, medium: 1, long: 2, secondaryTargetRestricted: true },
            },
        };

        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('does not apply C3 to an indirect-fire target', () => {
        const input = c3LaserInput(15, 7, false, true);
        input.target = {
            ...input.target!,
            tnCalculator: { indirectFire: true }
        };

        const state = inventoryTargetNumberState(input);

        expect(state.rangeSelection?.range).toBe('long');
        expect(state.rangeSelection?.c3Distance).toBeNull();
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
    });

    it('does not let overridden calculator state block C3', () => {
        const input = c3LaserInput(15, 7);
        input.target = {
            ...input.target!,
            tnModifier: 6,
            manualTnModifier: 6,
            tnCalculator: { indirectFire: true }
        };

        const state = inventoryTargetNumberState(input);

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.rangeSelection?.c3Distance).toBe(7);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM' }));
    });

    it('rejects indirect targets for weapons without indirect-fire capability', () => {
        const input = c3LaserInput(5, 5);
        input.target = { ...input.target!, tnCalculator: { indirectFire: true } };

        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('allows only the selected MML LRM ammunition profile to fire indirectly', () => {
        const input = guidedIndirectInput('M_NARC_CAPABLE');
        input.entry.equipment = new WeaponEquipment({
            id: 'MML9',
            name: 'MML 9',
            type: 'weapon',
            flags: ['F_INDIRECT_FIRE', 'F_MML'],
            weapon: { ammoType: 'MML', rackSize: 9, ranges: [0, 0, 0, 0] },
        });
        input.selectedAmmo = new AmmoEquipment({
            id: 'MML9SRMAmmo',
            name: 'MML 9 SRM Ammo',
            type: 'ammo',
            flags: ['F_MML_SRM'],
            ammo: { type: 'MML', rackSize: 9, shots: 11 },
        });

        expect(inventoryTargetNumberState(input).text).toBe('X');

        input.selectedAmmo = new AmmoEquipment({
            id: 'MML9LRMAmmo',
            name: 'MML 9 LRM Ammo',
            type: 'ammo',
            flags: ['F_MML_LRM'],
            ammo: { type: 'MML', rackSize: 9, shots: 8 },
        });

        expect(inventoryTargetNumberState(input).text).not.toBe('X');
    });

    it('forbids Core torpedo indirect fire and permits TW fire only with both endpoints underwater', () => {
        const input = guidedIndirectInput('M_NARC_CAPABLE', true);
        input.selectedAmmo = new AmmoEquipment({
            id: 'LRT20Ammo',
            name: 'LRT 20 Ammo',
            type: 'ammo',
            ammo: { type: 'LRM_TORPEDO', rackSize: 20, shots: 6 },
        });
        input.target = {
            ...input.target!,
            unitType: 'mek-biped',
            tnCalculator: {
                ...input.target!.tnCalculator,
                waterDepth: 'underwater-depth-1',
            },
        };
        input.gameRules = CORE_2026_GAME_RULES;

        expect(inventoryTargetNumberState(input).text).toBe('X');

        input.gameRules = TW_GAME_RULES;
        expect(inventoryTargetNumberState(input).text).not.toBe('X');

        input.entry.owner.isEquipmentSubmerged = () => false;
        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('does not apply indirect target restrictions through a manual TN override', () => {
        const input = c3LaserInput(5, 5);
        input.target = {
            ...input.target!,
            tnModifier: 2,
            manualTnModifier: 2,
            tnCalculator: { indirectFire: true },
        };

        expect(inventoryTargetNumberState(input).text).not.toBe('X');
    });

    it('rejects targets across a dry-to-submerged water boundary', () => {
        const aboveWater = c3LaserInput(5, 5);
        aboveWater.target = {
            ...aboveWater.target!,
            unitType: 'mek-biped',
            tnCalculator: { waterDepth: 'underwater-depth-2' },
        };
        expect(inventoryTargetNumberState(aboveWater).text).toBe('X');

        const underwater = c3LaserInput(5, 5);
        underwater.entry.owner.isEquipmentSubmerged = () => true;
        underwater.target = {
            ...underwater.target!,
            unitType: 'mek-biped',
            tnCalculator: {},
        };
        expect(inventoryTargetNumberState(underwater).text).toBe('X');
    });

    it('allows either water layer to target a partially underwater Mek', () => {
        const aboveWater = c3LaserInput(5, 5);
        aboveWater.target = {
            ...aboveWater.target!,
            unitType: 'mek-biped',
            tnCalculator: { waterDepth: 'underwater-depth-1' },
        };
        expect(inventoryTargetNumberState(aboveWater).text).not.toBe('X');

        const underwater = c3LaserInput(5, 5);
        underwater.entry.owner.isEquipmentSubmerged = () => true;
        underwater.target = { ...aboveWater.target! };
        expect(inventoryTargetNumberState(underwater).text).not.toBe('X');
    });

    it('enforces water-layer restrictions for non-Mek attackers and targets', () => {
        const nonMekAttacker = c3LaserInput(5, 5);
        nonMekAttacker.entry.owner.getUnit = () => ({ type: 'Tank' }) as never;
        nonMekAttacker.target = {
            ...nonMekAttacker.target!,
            unitType: 'mek-biped',
            tnCalculator: { waterDepth: 'underwater-depth-2' },
        };
        expect(inventoryTargetNumberState(nonMekAttacker).text).toBe('X');

        const nonMekTarget = c3LaserInput(5, 5);
        nonMekTarget.target = {
            ...nonMekTarget.target!,
            unitType: 'vehicle',
            tnCalculator: { waterDepth: 'underwater-depth-2' },
        };
        expect(inventoryTargetNumberState(nonMekTarget).text).toBe('X');
    });

    it('removes water partial cover when the attacker is fully submerged', () => {
        const aboveWater = waterPartialCoverInput('Laser', false);
        const submerged = waterPartialCoverInput('Laser', false, false, true);

        expect(inventoryTargetEffectiveTnModifier(aboveWater.target!, aboveWater.entry)).toBe(1);
        expect(inventoryTargetEffectiveTnModifier(submerged.target!, submerged.entry)).toBe(0);
    });

    it('applies water partial cover only to specific physical attacks', () => {
        for (const name of ['punch', 'kick', 'push', 'charge', 'death from above']) {
            const input = waterPartialCoverInput(name, true);
            expect(inventoryTargetEffectiveTnModifier(input.target!, input.entry))
                .withContext(name)
                .toBe(0);
        }
        const intrinsicClub = waterPartialCoverInput('club', true);
        expect(inventoryTargetEffectiveTnModifier(intrinsicClub.target!, intrinsicClub.entry)).toBe(1);
        const mountedClub = waterPartialCoverInput('Hatchet', false, true);
        expect(inventoryTargetEffectiveTnModifier(mountedClub.target!, mountedClub.entry)).toBe(1);
    });

    it('ignores the Battle Armor target modifier only for ranged infantry attacks', () => {
        const input = c3LaserInput(5, 5);
        input.target = {
            ...input.target!,
            unitType: 'battle-armor',
            tnModifier: 1,
            tnCalculator: {},
        };

        expect(inventoryTargetEffectiveTnModifier(input.target, input.entry)).toBe(1);

        input.entry.owner.getUnit = () => ({
            type: 'Infantry',
            subtype: 'Conventional Infantry',
        }) as never;
        expect(inventoryTargetEffectiveTnModifier(input.target, input.entry)).toBe(0);
        expect(compileInventoryTargetToHitModifiers({
            target: input.target,
            entry: input.entry,
        })).toContain(jasmine.objectContaining({
            id: 'battle-armor',
            modifier: 1,
            ignored: true,
        }));

        input.entry.owner.getUnit = () => ({
            type: 'Infantry',
            subtype: 'Battle Armor',
        }) as never;
        expect(inventoryTargetEffectiveTnModifier(input.target, input.entry)).toBe(0);
    });

    it('compiles target-movement groups once for handlers and omits them for a complete override', () => {
        const input = c3LaserInput(5, 5);
        input.target = {
            ...input.target!,
            tnModifier: 6,
            tnCalculator: {
                isAirborne: true,
                targetMovementBracket: '7-9',
                skidding: true,
            },
        };

        expect(inventoryTargetModifierGroups(input.target, TW_GAME_RULES)).toEqual({
            'target-movement': 6,
            terrain: 0,
            'partial-cover': 0,
        });
        expect(inventoryTargetModifierGroups({
            ...input.target,
            manualTnModifier: 6,
        }, TW_GAME_RULES)).toBeUndefined();
    });

    it('uses profile-specific Immobile eligibility for artillery and artillery cannons', () => {
        const regularArtillery = artilleryInput(15);
        regularArtillery.target = {
            ...regularArtillery.target!,
            tnModifier: -4,
            tnCalculator: { immobile: true },
        };

        expect(inventoryTargetEffectiveTnModifier(
            regularArtillery.target,
            regularArtillery.entry,
            regularArtillery.selectedAmmo,
            CORE_2026_GAME_RULES,
            undefined,
            ['A', 'AE'],
        )).toBe(0);
        expect(inventoryTargetEffectiveTnModifier(
            regularArtillery.target,
            regularArtillery.entry,
            regularArtillery.selectedAmmo,
            TW_GAME_RULES,
            undefined,
            ['A', 'AE'],
        )).toBe(-4);

        regularArtillery.entry.equipment = new WeaponEquipment({
            id: 'ThumperCannon',
            name: 'Thumper Cannon',
            type: 'weapon',
            flags: ['F_ARTILLERY', 'F_DIRECT_FIRE'],
            weapon: { ammoType: 'THUMPER_CANNON', ranges: [6, 13, 21, 28] },
        });
        regularArtillery.selectedAmmo = new AmmoEquipment({
            id: 'ThumperCannonAmmo',
            name: 'Thumper Cannon Ammo',
            type: 'ammo',
            ammo: { type: 'THUMPER_CANNON', shots: 10 },
        });
        expect(inventoryTargetEffectiveTnModifier(
            regularArtillery.target,
            regularArtillery.entry,
            regularArtillery.selectedAmmo,
            TW_GAME_RULES,
            undefined,
            ['DB', 'F'],
        )).toBe(0);
    });

    it('does not apply water-layer restrictions through a manual TN override', () => {
        const input = c3LaserInput(5, 5);
        input.target = {
            ...input.target!,
            unitType: 'mek-biped',
            tnModifier: 2,
            manualTnModifier: 2,
            tnCalculator: { waterDepth: 'underwater-depth-2' },
        };

        expect(inventoryTargetNumberState(input).text).not.toBe('X');
    });

    it('ignores spotter modifiers for NARC-capable ammo against an active NARC target', () => {
        const input = guidedIndirectInput('M_NARC_CAPABLE');
        input.target = { ...input.target!, tnCalculator: { ...input.target!.tnCalculator, narcAboveWater: true } };
        const breakdown = inventoryTargetNumberBreakdown(input);

        expect(inventoryTargetEffectiveTnModifier(input.target!, input.entry, input.selectedAmmo)).toBe(1);
        expect(breakdown?.total).toBe(5);
        expect(breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'NARC' }));
        expect(breakdown?.lines).toContain(jasmine.objectContaining({
            label: 'Spotter',
            value: 'Not required (NARC)',
        }));
        for (const label of ['Intervening Woods', 'Spotter Moved (Run)', 'Spotter Declared Attack']) {
            expect(breakdown?.lines).withContext(label).toContain(jasmine.objectContaining({
                label,
                nested: true,
                ignored: true,
            }));
        }
    });

    it('retains target-hex terrain for Core NARC indirect fire and ignores it for TW', () => {
        const input = guidedIndirectInput('M_NARC_CAPABLE');
        input.target = {
            ...input.target!,
            tnModifier: 8,
            tnCalculator: {
                ...input.target!.tnCalculator,
                targetHexCover: 'heavy',
                narcAboveWater: true,
            },
        };

        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(3);
        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, TW_GAME_RULES,
        )).toBe(1);

        input.gameRules = TW_GAME_RULES;
        expect(inventoryTargetNumberBreakdown(input)?.lines).toContain(jasmine.objectContaining({
            label: 'Heavy Cover',
            nested: true,
            ignored: true,
        }));
    });

    it('uses the profile-specific NARC homing modifier for direct and indirect attacks', () => {
        const direct = guidedIndirectInput('M_NARC_CAPABLE');
        direct.target = {
            ...direct.target!,
            tnModifier: 0,
            tnCalculator: { narcAboveWater: true },
        };
        expect(inventoryTargetEffectiveTnModifier(
            direct.target!, direct.entry, direct.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(-1);
        expect(inventoryTargetEffectiveTnModifier(
            direct.target!, direct.entry, direct.selectedAmmo, TW_GAME_RULES,
        )).toBe(0);
        expect(inventoryTargetNumberBreakdown(direct)?.lines)
            .not.toContain(jasmine.objectContaining({ label: 'Spotter', value: 'Not required (NARC)' }));

        const indirect = guidedIndirectInput('M_NARC_CAPABLE');
        indirect.target = {
            ...indirect.target!,
            tnCalculator: { ...indirect.target!.tnCalculator, narcAboveWater: true },
        };
        expect(inventoryTargetEffectiveTnModifier(
            indirect.target!, indirect.entry, indirect.selectedAmmo, TW_GAME_RULES,
        )).toBe(1);
        expect(inventoryTargetEffectiveTnModifier(
            indirect.target!, indirect.entry, indirect.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(1);
        for (const gameRules of [CORE_2026_GAME_RULES, TW_GAME_RULES]) {
            indirect.gameRules = gameRules;
            expect(inventoryTargetNumberBreakdown(indirect)?.lines)
                .withContext(gameRules.id)
                .toContain(jasmine.objectContaining({ label: 'Spotter', value: 'Not required (NARC)' }));
        }
    });

    it('suppresses direct and indirect NARC guidance while the pod is ECM shielded', () => {
        const direct = guidedIndirectInput('M_NARC_CAPABLE');
        direct.target = {
            ...direct.target!,
            tnModifier: 0,
            tnCalculator: { narcAboveWater: true, ecmShielded: true },
        };
        expect(inventoryTargetEffectiveTnModifier(
            direct.target!, direct.entry, direct.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(0);

        const indirect = guidedIndirectInput('M_NARC_CAPABLE');
        indirect.target = {
            ...indirect.target!,
            tnCalculator: {
                ...indirect.target!.tnCalculator,
                narcAboveWater: true,
                ecmShielded: true,
            },
        };
        expect(inventoryTargetEffectiveTnModifier(
            indirect.target!, indirect.entry, indirect.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(6);
        expect(inventoryTargetNumberBreakdown(indirect)?.lines)
            .not.toContain(jasmine.objectContaining({ label: 'Spotter', value: 'Not required (NARC)' }));
    });

    it('applies NARC guidance only when the beacon and firing weapon share a water layer', () => {
        const cases = [
            { weaponUnderwater: false, narcAboveWater: true, narcUnderwater: false, expected: 1 },
            { weaponUnderwater: true, narcAboveWater: false, narcUnderwater: true, expected: 1 },
            { weaponUnderwater: false, narcAboveWater: false, narcUnderwater: true, expected: 6 },
            { weaponUnderwater: true, narcAboveWater: true, narcUnderwater: false, expected: 6 },
        ];

        for (const testCase of cases) {
            const input = guidedIndirectInput('M_NARC_CAPABLE', testCase.weaponUnderwater);
            input.target = {
                ...input.target!,
                tnCalculator: {
                    ...input.target!.tnCalculator,
                    narcAboveWater: testCase.narcAboveWater,
                    narcUnderwater: testCase.narcUnderwater,
                },
            };

            expect(inventoryTargetEffectiveTnModifier(input.target!, input.entry, input.selectedAmmo))
                .withContext(JSON.stringify(testCase))
                .toBe(testCase.expected);
            const noSpotter = inventoryTargetNumberBreakdown(input)?.lines.some(
                line => line.label === 'Spotter' && line.value === 'Not required (NARC)',
            ) ?? false;
            expect(noSpotter)
                .withContext(JSON.stringify(testCase))
                .toBe(testCase.expected === 1);
        }
    });

    it('ignores spotter modifiers for semi-guided ammo against a TAG-designated target', () => {
        const input = guidedIndirectInput('M_SEMIGUIDED');
        input.target = { ...input.target!, tnCalculator: { ...input.target!.tnCalculator, tagged: true } };
        const lines = inventoryTargetNumberBreakdown(input)?.lines;

        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(1);
        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, TW_GAME_RULES,
        )).toBe(0);
        expect(lines).not.toContain(jasmine.objectContaining({
            label: 'Spotter',
            value: 'Not required (NARC)',
        }));
        for (const label of ['Intervening Woods', 'Spotter Moved (Run)', 'Spotter Declared Attack']) {
            expect(lines).withContext(label).toContain(jasmine.objectContaining({
                label,
                nested: true,
                ignored: true,
            }));
        }
    });

    it('does not apply stale TAG guidance to TW infantry targets', () => {
        const input = guidedIndirectInput('M_SEMIGUIDED');
        input.target = {
            ...input.target!,
            unitType: 'infantry',
            tnCalculator: { ...input.target!.tnCalculator, tagged: true },
        };

        expect(inventoryTargetEffectiveTnModifier(
            input.target, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(1);
        expect(inventoryTargetEffectiveTnModifier(
            input.target, input.entry, input.selectedAmmo, TW_GAME_RULES,
        )).toBe(6);
    });

    it('applies profile-specific direct semi-guided adjustments', () => {
        const input = guidedIndirectInput('M_SEMIGUIDED');
        input.target = {
            ...input.target!,
            tnModifier: 6,
            tnCalculator: {
                tagged: true,
                targetMovementBracket: '3-4',
                interveningWoods: 'light2',
                targetHexCover: 'heavy',
                partialCover: true,
            },
        };

        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(3);
        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, TW_GAME_RULES,
        )).toBe(5);
    });

    it('treats water and building cover as terrain for direct Core semi-guided fire', () => {
        for (const testCase of [
            { tnModifier: 1, tnCalculator: { tagged: true, waterDepth: 'underwater-depth-1' as const } },
            { tnModifier: 1, tnCalculator: { tagged: true, buildingCover: 'building-1' as const } },
            { tnModifier: 2, tnCalculator: { tagged: true, buildingCover: 'building-2' as const } },
        ]) {
            const input = guidedIndirectInput('M_SEMIGUIDED');
            input.target = {
                ...input.target!,
                unitType: 'mek-biped',
                tnModifier: testCase.tnModifier,
                tnCalculator: testCase.tnCalculator,
            };

            expect(inventoryTargetEffectiveTnModifier(
                input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
            )).withContext(JSON.stringify(testCase)).toBe(0);
            expect(inventoryTargetEffectiveTnModifier(
                input.target!, input.entry, input.selectedAmmo, TW_GAME_RULES,
            )).withContext(JSON.stringify(testCase)).toBe(testCase.tnModifier);
        }
    });

    it('ignores water and building cover for indirect semi-guided fire', () => {
        for (const testCase of [
            { tnModifier: 2, cover: { waterDepth: 'underwater-depth-1' as const } },
            { tnModifier: 2, cover: { buildingCover: 'building-1' as const } },
            { tnModifier: 3, cover: { buildingCover: 'building-2' as const } },
        ]) {
            const input = guidedIndirectInput('M_SEMIGUIDED');
            input.target = {
                ...input.target!,
                unitType: 'mek-biped',
                tnModifier: testCase.tnModifier,
                tnCalculator: {
                    tagged: true,
                    indirectFire: true,
                    ...testCase.cover,
                },
            };

            expect(inventoryTargetEffectiveTnModifier(
                input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
            )).withContext(JSON.stringify(testCase)).toBe(1);
            expect(inventoryTargetEffectiveTnModifier(
                input.target!, input.entry, input.selectedAmmo, TW_GAME_RULES,
            )).withContext(JSON.stringify(testCase)).toBe(0);
        }
    });

    it('reduces combined terrain by two for Core direct semi-guided fire', () => {
        const input = guidedIndirectInput('M_SEMIGUIDED');
        input.target = {
            ...input.target!,
            unitType: 'mek-biped',
            tnModifier: 3,
            tnCalculator: {
                tagged: true,
                interveningWoods: 'light2',
                waterDepth: 'underwater-depth-1',
            },
        };

        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(1);
        (input.entry.owner as unknown as { turnState: () => { submerged: () => boolean } }).turnState
            = () => ({ submerged: () => true });
        expect(inventoryTargetEffectiveTnModifier(
            input.target!, input.entry, input.selectedAmmo, CORE_2026_GAME_RULES,
        )).toBe(0);
    });

    it('keeps spotter modifiers without matching guidance or with a manual TN override', () => {
        const input = guidedIndirectInput('M_NARC_CAPABLE');
        input.target = { ...input.target!, tnCalculator: { ...input.target!.tnCalculator, narcAboveWater: false } };
        expect(inventoryTargetEffectiveTnModifier(input.target!, input.entry, input.selectedAmmo)).toBe(6);
        expect(inventoryTargetNumberBreakdown(input)?.lines)
            .not.toContain(jasmine.objectContaining({ label: 'Spotter', value: 'Not required (NARC)' }));

        input.target = {
            ...input.target!,
            manualTnModifier: 6,
            tnCalculator: { ...input.target!.tnCalculator, narcAboveWater: true },
        };
        expect(inventoryTargetEffectiveTnModifier(input.target!, input.entry, input.selectedAmmo)).toBe(6);
    });

    it('shows calculator target modifiers as nested details while keeping overrides compact', () => {
        const input = guidedIndirectInput('M_SEMIGUIDED');
        let lines = inventoryTargetNumberBreakdown(input)?.lines ?? [];

        expect(lines).toContain(jasmine.objectContaining({ label: 'Target A', value: '+6', isHeader: true }));
        expect(lines).toContain(jasmine.objectContaining({ label: 'Intervening Woods', value: '+2', nested: true }));
        expect(lines).toContain(jasmine.objectContaining({ label: 'Indirect Fire', value: '+1', nested: true }));
        expect(lines).toContain(jasmine.objectContaining({ label: 'Spotter Moved (Run)', value: '+2', nested: true }));
        expect(lines).toContain(jasmine.objectContaining({ label: 'Spotter Declared Attack', value: '+1', nested: true }));

        input.target = { ...input.target!, manualTnModifier: 6 };
        lines = inventoryTargetNumberBreakdown(input)?.lines ?? [];
        expect(lines).toContain(jasmine.objectContaining({ label: 'Target (A)', value: '+6' }));
        expect(lines.some(line => line.nested)).toBeFalse();
    });

    it('keeps ground attacks beyond Long illegal when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 20);

        const selection = inventoryTargetRangeSelection(input);

        expect(selection).toEqual(jasmine.objectContaining({
            range: 'extreme',
            outOfRange: true,
            outOfLongRange: true,
            outOfExtremeRange: false
        }));
        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('allows ground Extreme attacks through the exact Extreme boundary when enabled', () => {
        const firstExtreme = c3LaserInput(20, 20, true);
        const exactExtreme = c3LaserInput(25, 25, true);
        const beyondExtreme = c3LaserInput(26, 26, true);

        expect(inventoryTargetRangeSelection(firstExtreme)).toEqual(jasmine.objectContaining({ range: 'extreme', outOfRange: false }));
        expect(inventoryTargetNumberState(firstExtreme).text).toBe('10');
        expect(inventoryTargetRangeSelection(exactExtreme)).toEqual(jasmine.objectContaining({ range: 'extreme', outOfRange: false }));
        expect(inventoryTargetNumberState(exactExtreme).text).toBe('10');
        expect(inventoryTargetRangeSelection(beyondExtreme)).toEqual(jasmine.objectContaining({
            range: 'extreme', outOfRange: true, outOfExtremeRange: true
        }));
        expect(inventoryTargetNumberState(beyondExtreme).text).toBe('X');
    });

    it('counts out-of-range to Long as one increment when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 19);
        const breakdown = inventoryTargetNumberBreakdown(input);

        expect(breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ECM', value: '+1' }));
    });

    it('counts out-of-range to Medium as two increments when Extreme range is disabled', () => {
        const input = c3LaserInput(20, 14);

        expect(inventoryTargetNumberBreakdown(input)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

    it('counts out-of-range to Extreme as one and out-of-range to Long as two when Extreme is enabled', () => {
        const toExtreme = c3LaserInput(26, 25, true);
        const toLong = c3LaserInput(26, 19, true);

        expect(inventoryTargetNumberBreakdown(toExtreme)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+1' }));
        expect(inventoryTargetNumberBreakdown(toLong)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

    it('uses one bracket beyond the closest C3 unit for legal Extreme attacks', () => {
        const cases: ReadonlyArray<{
            c3Distance: number;
            range: 'medium' | 'long' | 'extreme';
            modifier: string | null;
        }> = [
            { c3Distance: 19, range: 'extreme', modifier: null },
            { c3Distance: 14, range: 'long', modifier: '+1' },
            { c3Distance: 7, range: 'medium', modifier: '+2' }
        ] as const;

        for (const testCase of cases) {
            const state = inventoryTargetNumberState(c3LaserInput(25, testCase.c3Distance, true));
            expect(state.rangeSelection?.range).withContext(`C3 distance ${testCase.c3Distance}`)
                .toBe(testCase.range);
            if (testCase.modifier === null) {
                expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'ECM' }));
            } else {
                expect(state.breakdown?.lines).withContext(`C3 distance ${testCase.c3Distance}`)
                    .toContain(jasmine.objectContaining({ label: 'ECM', value: testCase.modifier }));
            }
        }
    });

    it('does not shift the C3 bracket for non-Extreme attacks', () => {
        const state = inventoryTargetNumberState(c3LaserInput(19, 7, true));

        expect(state.rangeSelection?.range).toBe('short');
    });

    it('does not let C3 make a beyond-Extreme ground attack legal', () => {
        const state = inventoryTargetNumberState(c3LaserInput(26, 7, true));

        expect(state.rangeSelection?.range).toBe('short');
        expect(state.rangeSelection?.outOfRange).toBeTrue();
        expect(state.text).toBe('X');
    });

    it('does not synthesize an Extreme bracket for a sparse ground range profile', () => {
        const input = c3LaserInput(10, 10, true);
        input.display = { min: '—', short: '5', medium: '—', long: '—' };

        expect(inventoryTargetRangeSelection(input)).toEqual(jasmine.objectContaining({
            maximumRange: 'short',
            outOfRange: true
        }));
        expect(inventoryTargetNumberState(input).text).toBe('X');
    });

    it('selects standard-scale Aero-to-Aero brackets at MegaMek boundaries', () => {
        const cases = [
            { distance: 6, range: 'short' },
            { distance: 7, range: 'medium' },
            { distance: 12, range: 'medium' },
            { distance: 13, range: 'long' },
            { distance: 20, range: 'long' },
            { distance: 21, range: 'extreme' },
            { distance: 25, range: 'extreme' },
        ] as const;

        for (const testCase of cases) {
            const selection = inventoryTargetRangeSelection(aeroInput(testCase.distance));
            expect(selection?.range).withContext(`distance ${testCase.distance}`).toBe(testCase.range);
            expect(selection?.outOfRange).withContext(`distance ${testCase.distance}`).toBeFalse();
        }
        expect(inventoryTargetRangeSelection(aeroInput(26))?.outOfRange).toBeTrue();
    });

    it('rejects Aero brackets beyond the weapon maximum range bracket', () => {
        expect(inventoryTargetRangeSelection(aeroInput(7, 'short'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(13, 'medium'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(21, 'long'))?.outOfRange).toBeTrue();
        expect(inventoryTargetRangeSelection(aeroInput(21, 'extreme'))?.outOfRange).toBeFalse();
    });

    it('uses the short bracket for Aero-to-Ground attacks regardless of entered distance', () => {
        const selection = inventoryTargetRangeSelection(aeroInput(20, 'short', 'mek-biped'));

        expect(selection).toEqual(jasmine.objectContaining({
            range: 'short',
            outOfRange: false,
            minimumRangeModifier: 0
        }));
    });

    it('uses capital aerospace range boundaries for capital weapons', () => {
        expect(inventoryTargetRangeSelection(aeroInput(12, 'extreme', 'aero', true))?.range).toBe('short');
        expect(inventoryTargetRangeSelection(aeroInput(13, 'extreme', 'aero', true))?.range).toBe('medium');
        expect(inventoryTargetRangeSelection(aeroInput(41, 'extreme', 'aero', true))?.range).toBe('extreme');
        expect(inventoryTargetRangeSelection(aeroInput(51, 'extreme', 'aero', true))?.outOfRange).toBeTrue();
    });

    it('uses C3 only for the Aero to-hit bracket, not weapon range legality', () => {
        const input = aeroInput(18, 'long');
        input.target = { ...input.target!, useC3: true, c3Distance: 5 };
        const selection = inventoryTargetRangeSelection(input);

        expect(selection?.range).toBe('short');
        expect(selection?.outOfRange).toBeFalse();

        const outOfRangeInput = aeroInput(21, 'long');
        outOfRangeInput.target = { ...outOfRangeInput.target!, useC3: true, c3Distance: 5 };
        expect(inventoryTargetRangeSelection(outOfRangeInput)?.outOfRange).toBeTrue();
    });

    it('counts Aero out-of-range to Long as two C3 bracket improvements', () => {
        const input = aeroInput(26, 'extreme');
        input.target = { ...input.target!, useC3: true, c3Distance: 20 };
        input.gameRules = CORE_2026_GAME_RULES;
        input.c3DegradationSource = 'unit';

        expect(inventoryTargetNumberBreakdown(input)?.lines)
            .toContain(jasmine.objectContaining({ label: 'ECM', value: '+2' }));
    });

    it('marks core2026 artillery targets at seven hexes or less out of range', () => {
        expect(inventoryTargetNumberState(artilleryInput(7)).text).toBe('X');
        expect(inventoryTargetNumberState(artilleryInput(8)).text).toBe('8');
    });

    it('uses a flat +4 artillery modifier at every valid range', () => {
        const short = inventoryTargetNumberState(artilleryInput(8));
        const medium = inventoryTargetNumberState(artilleryInput(15));

        expect(short.breakdown?.total).toBe(8);
        expect(medium.breakdown?.total).toBe(8);
        expect(medium.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Artillery', value: '+4' }));
    });

    it('keeps normal range rules for TW artillery', () => {
        expect(inventoryTargetNumberState(artilleryInput(7, TW_GAME_RULES)).text).toBe('X');
        expect(inventoryTargetNumberState(artilleryInput(15, TW_GAME_RULES)).text).toBe('6');
    });

    it('preserves typed nonnumeric hit outcomes', () => {
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution('Vs') }).text).toBe('Vs');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution('*') }).text).toBe('*');
        expect(inventoryTargetNumberState({ ...artilleryInput(8), hitResolution: toHitResolution(null) }).text).toBe('');
    });

    it('keeps targets beyond long range out of range before resolving hit state', () => {
        expect(inventoryTargetNumberState({ ...artilleryInput(31), hitResolution: toHitResolution('Vs') }).text).toBe('X');
    });

    it('renders identified hit modifiers as separate lines', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(-2, [
                { label: 'ER Medium Laser', modifier: -1 },
                { label: 'Targeting Computer', modifier: -1 }
            ])
        });

        expect(state.breakdown?.total).toBe(2);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'ER Medium Laser', value: '-1' }));
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Targeting Computer', value: '-1' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Hit Modifier' }));
    });

    it('retains a concise weakened destruction detail without changing the total', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(0, [{ label: 'Targeting Computer Destroyed', modifier: 0, weakened: true }])
        });

        expect(state.breakdown?.total).toBe(4);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({
            label: 'Targeting Computer Destroyed', value: '+0', weakened: true
        }));
    });

    it('keeps the structured breakdown authoritative instead of synthesizing a generic label', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(2, [{ label: 'Damaged Fire Control', modifier: 1, weakened: true }])
        });

        expect(state.breakdown?.total).toBe(5);
        expect(state.breakdown?.lines).toContain(jasmine.objectContaining({ label: 'Damaged Fire Control', value: '+1' }));
        expect(state.breakdown?.lines).not.toContain(jasmine.objectContaining({ label: 'Hit Modifier' }));
    });

    it('orders regular terms before weakened terms and heat last', () => {
        const state = inventoryTargetNumberState({
            ...artilleryInput(8),
            selectedAmmo: null,
            hitResolution: toHitResolution(2, [
                { label: 'Damaged Fire Control', modifier: 1, weakened: true },
                { label: 'Targeting Computer', modifier: -1 },
                { label: 'Heat - Fire Modifier', modifier: 2, weakened: true, kind: 'heat' }
            ])
        });

        expect(state.breakdown?.lines.map(line => line.label ?? (line.isBreak ? 'BREAK' : ''))).toEqual([
            'Gunnery',
            'Range (Short)',
            'Targeting Computer',
            'Damaged Fire Control',
            'Heat - Fire Modifier',
            'BREAK',
            'Total'
        ]);
    });
});
