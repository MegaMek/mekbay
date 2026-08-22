// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { signal } from '@angular/core';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import { ArmorEquipment, MiscEquipment } from '../models/equipment.model';
import type { EquipmentFlag } from '../models/equipment-flags.type';
import type { MountedEquipment } from '../models/mounted-equipment.model';
import type { MotiveModes } from '../models/motiveModes.model';
import type { UnitSummary } from '../models/unit-summary.model';
import type { UnitCover } from '../models/unit-cover.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES, type CBTGameRules } from '../models/rules/game-rules';
import {
    deriveOpforTargetCalculatorState,
    getOpforInventoryTargetId,
    isLargeInventoryTarget,
    isOpforInventoryTargetId,
    resolveInventoryTargetUnitType
} from './inventory-control-opfor-target.util';

function unit(overrides: Partial<UnitSummary> = {}): UnitSummary {
    return {
        type: 'Mek',
        subtype: 'BattleMek',
        moveType: 'Biped',
        tons: 50,
        weightClass: 'Medium',
        ...overrides
    } as UnitSummary;
}

function forceUnit(options: {
    definition?: Partial<UnitSummary>;
    conditions?: string[];
    distance?: number | null;
    airborne?: boolean | null;
    moveMode?: MotiveModes | null;
    cover?: UnitCover;
    narcWaterLayers?: { aboveWater: boolean; underwater: boolean };
    gameRules?: CBTGameRules;
    inventory?: MountedEquipment[];
} = {}): CBTForceUnit {
    const conditions = new Set(options.conditions ?? []);
    const moveDistance = signal<number | null>(options.distance ?? null);
    const airborne = signal<boolean | null>(options.airborne ?? null);
    const moveMode = signal<MotiveModes | null>(options.moveMode ?? null);
    const cover = signal<UnitCover | undefined>(options.cover);
    return {
        gameRules: options.gameRules ?? CORE_2026_GAME_RULES,
        getUnit: () => unit(options.definition),
        getCondition: (condition: string) => conditions.has(condition),
        getInventory: () => options.inventory ?? [],
        isEquipmentOperational: () => true,
        getActiveNarcWaterLayers: () => options.narcWaterLayers ?? { aboveWater: false, underwater: false },
        turnState: () => ({
            moveDistance,
            airborne,
            moveMode,
            effectiveMoveMode: moveMode,
            cover,
            isDepth1: () => cover() === 'underwater-depth-1',
        })
    } as unknown as CBTForceUnit;
}

function mountedArmor(type: string, flags: EquipmentFlag[]): MountedEquipment {
    return {
        equipment: new ArmorEquipment({
            id: type,
            name: type,
            type: 'armor',
            flags,
            armor: { type },
        }),
        states: new Map(),
    } as unknown as MountedEquipment;
}

function mountedMisc(
    id: string,
    flags: EquipmentFlag[],
    active = false,
): MountedEquipment {
    return {
        equipment: new MiscEquipment({
            id,
            name: id,
            type: 'misc',
            flags,
            modes: active ? ['Off', 'On'] : undefined,
        }),
        states: new Map(active ? [['state', 'enabled']] : []),
    } as unknown as MountedEquipment;
}

describe('inventory control OPFOR targets', () => {
    it('uses stable namespaced IDs', () => {
        expect(getOpforInventoryTargetId('enemy-1')).toBe('opfor:enemy-1');
        expect(isOpforInventoryTargetId('opfor:enemy-1')).toBeTrue();
        expect(isOpforInventoryTargetId('A')).toBeFalse();
    });

    it('maps supported CBT unit classifications', () => {
        expect(resolveInventoryTargetUnitType(unit())).toBe('mek-biped');
        expect(resolveInventoryTargetUnitType(unit({ subtype: 'Quad BattleMek' }))).toBe('mek-quad');
        expect(resolveInventoryTargetUnitType(unit({ subtype: 'BattleMek', moveType: 'Tripod' }))).toBe('mek-tripod');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Infantry', subtype: 'Battle Armor' }))).toBe('battle-armor');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Infantry', subtype: 'Conventional Infantry' }))).toBe('infantry');
        expect(resolveInventoryTargetUnitType(unit({ type: 'ProtoMek', subtype: 'ProtoMek' }))).toBe('protoMek');
        expect(resolveInventoryTargetUnitType(unit({ type: 'VTOL', subtype: 'Combat Vehicle' }))).toBe('vtol');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Tank', subtype: 'Combat Vehicle' }))).toBe('vehicle');
        expect(resolveInventoryTargetUnitType(unit({ type: 'Aero', subtype: 'Aerospace Fighter' }))).toBe('aero');
    });

    it('recognizes only eligible superheavy and Large Support units as large targets', () => {
        expect(isLargeInventoryTarget(unit({ tons: 100 }))).toBeFalse();
        expect(isLargeInventoryTarget(unit({ tons: 101 }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'Tank', tons: 150, weightClass: 'Assault' }))).toBeFalse();
        expect(isLargeInventoryTarget(unit({ type: 'Tank', tons: 200, weightClass: 'Colossal/Super-Heavy' }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'Tank', tons: 150, weightClass: 'Large Support Vehicle' }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'VTOL', tons: 60, weightClass: 'Colossal/Super-Heavy' }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'Aero', weightClass: 'Large Support Vehicle' }))).toBeTrue();
        expect(isLargeInventoryTarget(unit({ type: 'ProtoMek', weightClass: 'Colossal/Super-Heavy' }))).toBeFalse();
        expect(isLargeInventoryTarget(unit({ type: 'Infantry', subtype: 'Battle Armor', weightClass: 'Large Support Vehicle' }))).toBeFalse();
    });

    it('derives airborne movement, size, and height state without clearing Large identity', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            definition: { tons: 120 },
            conditions: ['skidding'],
            distance: 8,
            airborne: true
        }));

        expect(state).toEqual(jasmine.objectContaining({
            targetMovementBracket: '7-9',
            targetMovementDistance: 8,
            isAirborne: true,
            skidding: true,
            targetHeight: 3,
            largeTarget: true
        }));
    });

    it('derives immobile stance without discarding movement and jump state', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            conditions: ['immobile', 'prone', 'skidding'],
            distance: 12,
            airborne: true
        }), { interveningWoods: 'light1' });

        expect(state).toEqual(jasmine.objectContaining({
            prone: true,
            immobile: true,
            targetMovementBracket: '10-17',
            targetMovementDistance: 12,
            isAirborne: true,
            skidding: true,
            interveningWoods: 'light1'
        }));
    });

    it('treats jump movement as a movement modifier without suppressing a superheavy target', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit({
            definition: { tons: 120 },
            moveMode: 'jump',
            airborne: false,
            distance: 5
        }));

        expect(state.isAirborne).toBeTrue();
        expect(state.largeTarget).toBeTrue();
        expect(state.targetMovementBracket).toBe('5-6');
        expect(state.targetMovementDistance).toBe(5);
    });

    it('preserves unknown movement instead of treating it as zero', () => {
        const state = deriveOpforTargetCalculatorState(forceUnit());
        expect(state.targetMovementBracket).toBeNull();
        expect(state.targetMovementDistance).toBeNull();
    });

    it('maps unit cover and preserves special cover levels', () => {
        expect(deriveOpforTargetCalculatorState(forceUnit()).targetHexCover).toBe('none');
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'light' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'light',
            waterDepth: undefined,
        }));
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'heavy' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'heavy',
            waterDepth: undefined,
        }));
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'underwater-depth-1' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'none',
            waterDepth: 'underwater-depth-1',
        }));
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'underwater-depth-3' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'none',
            waterDepth: 'underwater-depth-3',
        }));
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'building-1' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'none',
            waterDepth: undefined,
            buildingCover: 'building-1',
        }));
        expect(deriveOpforTargetCalculatorState(forceUnit({ cover: 'building-2' }))).toEqual(jasmine.objectContaining({
            targetHexCover: 'none',
            waterDepth: undefined,
            buildingCover: 'building-2',
        }));
    });

    it('derives the same superheavy large-target state under Core and TW rules', () => {
        expect(deriveOpforTargetCalculatorState(forceUnit({
            definition: { tons: 120 },
            gameRules: CORE_2026_GAME_RULES,
        })).largeTarget).toBeTrue();
        expect(deriveOpforTargetCalculatorState(forceUnit({
            definition: { tons: 120 },
            gameRules: TW_GAME_RULES,
        })).largeTarget).toBeTrue();
    });

    it('derives NARC, TAG, and ECM guidance state', () => {
        expect(deriveOpforTargetCalculatorState(forceUnit({
            narcWaterLayers: { aboveWater: true, underwater: true },
            conditions: ['tagged', 'ecm-shielded'],
        }))).toEqual(jasmine.objectContaining({
            narcAboveWater: true,
            narcUnderwater: true,
            tagged: true,
            ecmShielded: true,
        }));
    });

    it('derives the active Battle Armor stealth range profile', () => {
        const stealth = {
            equipment: new ArmorEquipment({
                id: 'IS BA Stealth (Improved)',
                name: 'BA Stealth (Improved)',
                type: 'armor',
                flags: ['F_BA_EQUIPMENT', 'F_STEALTH'],
                armor: { type: 'BA_STEALTH_IMP' },
            }),
            states: new Map(),
        } as unknown as MountedEquipment;

        expect(deriveOpforTargetCalculatorState(forceUnit({ inventory: [stealth] })).stealth)
            .toEqual({
                short: 1,
                medium: 2,
                long: 3,
                conventionalInfantry: { short: 0, medium: 0, long: 0 },
            });
        expect(deriveOpforTargetCalculatorState(forceUnit({
            inventory: [stealth],
            conditions: ['shutdown'],
        })).stealth).toBeUndefined();
    });

    it('stacks simple camouflage with BA electronic stealth', () => {
        const baStealth = mountedArmor('BA_STEALTH', ['F_BA_EQUIPMENT', 'F_STEALTH']);
        const simpleCamo = mountedMisc('Simple Camo', ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO']);

        expect(deriveOpforTargetCalculatorState(forceUnit({
            inventory: [baStealth, simpleCamo],
            distance: 0,
        })).stealth).toEqual({
            short: 3,
            medium: 3,
            long: 4,
            conventionalInfantry: { short: 2, medium: 2, long: 2 },
        });
        expect(deriveOpforTargetCalculatorState(forceUnit({
            inventory: [baStealth, simpleCamo],
            distance: 1,
        })).stealth).toEqual({
            short: 2,
            medium: 2,
            long: 3,
            conventionalInfantry: { short: 1, medium: 1, long: 1 },
        });
    });

    it('uses Mimetic movement protection instead of stacking Simple Camo', () => {
        const mimetic = mountedArmor('BA_MIMETIC', ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO']);
        const simpleCamo = mountedMisc('Simple Camo', ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO']);

        for (const [distance, modifier] of [[0, 3], [1, 2], [2, 1], [3, 0]] as const) {
            expect(deriveOpforTargetCalculatorState(forceUnit({
                inventory: [mimetic, simpleCamo],
                distance,
            })).stealth).withContext(`distance ${distance}`).toEqual({
                short: modifier,
                medium: modifier,
                long: modifier,
            });
        }
    });

    it('lets a BA Myomer Booster suppress BA stealth and Mimetic but not Simple Camo', () => {
        const baStealth = mountedArmor('BA_STEALTH_IMP', ['F_BA_EQUIPMENT', 'F_STEALTH']);
        const mimetic = mountedArmor('BA_MIMETIC', ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO']);
        const simpleCamo = mountedMisc('Simple Camo', ['F_BA_EQUIPMENT', 'F_STEALTH', 'F_VISUAL_CAMO']);
        const booster = mountedMisc('BA Myomer Booster', ['F_BA_EQUIPMENT', 'F_MASC']);

        expect(deriveOpforTargetCalculatorState(forceUnit({
            inventory: [baStealth, mimetic, simpleCamo, booster],
            distance: 0,
        })).stealth).toEqual({ short: 2, medium: 2, long: 2 });
    });

    it('stacks Chameleon LPS with Null Signature while infantry ignore only Null Signature', () => {
        const chameleon = mountedMisc('Chameleon LPS', ['F_CHAMELEON_SHIELD'], true);
        const nullSignature = mountedMisc('Null Signature', ['F_NULL_SIG'], true);

        expect(deriveOpforTargetCalculatorState(forceUnit({
            inventory: [chameleon, nullSignature],
        })).stealth).toEqual({
            short: 0,
            medium: 2,
            long: 4,
            conventionalInfantry: { short: 0, medium: 1, long: 2 },
        });
    });
});
