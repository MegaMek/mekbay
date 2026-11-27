// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MekEntity } from './entity/entities/mek/mek-entity';
import type { MotiveModes } from './motiveModes.model';
import type { UnitConditionKey } from './unit-condition.model';

/**
 * The operating modes a Land-Air Mek or a QuadVee converts between (Interstellar Operations: Alternate Eras
 * pp. 100-107 and 127-128; neither Total Warfare nor the Core Rulebook covers these units).
 */
export type MekConversionMode = 'mek' | MekConvertedMode;

/** A mode other than BattleMech mode: the one fact a converted unit stores. */
export type MekConvertedMode = typeof MEK_CONVERTED_MODES[number];

export const MEK_CONVERTED_MODES = Object.freeze(['airmek', 'fighter', 'vehicle'] as const);

export function isMekConvertedMode(value: unknown): value is MekConvertedMode {
    return MEK_CONVERTED_MODES.includes(value as MekConvertedMode);
}

const MODE_LABELS: Readonly<Record<MekConversionMode, string>> = Object.freeze({
    mek: 'BattleMech',
    airmek: 'AirMech',
    fighter: 'Fighter',
    vehicle: 'Vehicle',
});

/** The condition a converted unit shows for its mode; it is derived for display, the mode itself is the stored fact. */
export function mekConvertedModeCondition(mode: MekConvertedMode): UnitConditionKey {
    return `${mode}-mode`;
}

/** Whether a condition is one of the display conditions derived from the conversion mode. */
export function isMekConvertedModeCondition(condition: UnitConditionKey): boolean {
    return MEK_CONVERTED_MODES.some(mode => mekConvertedModeCondition(mode) === condition);
}

/** The modes this Mek converts between, BattleMech mode first; empty for a Mek that does not convert. */
export function mekConversionModes(entity: MekEntity): readonly MekConversionMode[] {
    if (entity.chassisConfig === 'QuadVee') return ['mek', 'vehicle'];
    if (entity.chassisConfig !== 'LAM') return [];
    // A Bimodal LAM has no AirMech mode.
    return entity.isLandAirMek() ? ['mek', 'airmek', 'fighter'] : ['mek', 'fighter'];
}

export function mekConversionModeLabel(mode: MekConversionMode): string {
    return MODE_LABELS[mode];
}

/**
 * Only an AirMech and a fighter choose between the ground and the air. They declare it every turn, as an aerospace
 * fighter does; until then they count as on the ground.
 */
export function mekChoosesAirborne(mode: MekConversionMode): boolean {
    return mode === 'airmek' || mode === 'fighter';
}

/**
 * A converted unit's Walking-type and Running-type MP, from the MP its BattleMech mode has left. An AirMech walks at a
 * third of its Walking MP, or cruises at three times its Jumping MP once it is `airborne`. A fighter's Safe Thrust is
 * its Jumping MP; landed, it taxis at half of that and has no Maximum Thrust, as MegaMek's grounded fighters do. Each
 * otherwise runs, flanks or reaches Maximum Thrust at one and a half times its Walking-type MP, rounded up. BattleMech
 * and Vehicle modes run on the Mek's own MP rules and are not converted here.
 */
export function mekConvertedMovementPoints(
    mode: 'airmek' | 'fighter',
    airborne: boolean,
    walkMp: number,
    jumpMp: number,
): { readonly walkMp: number; readonly runMp: number } {
    if (mode === 'fighter' && !airborne) return { walkMp: Math.floor(jumpMp / 2), runMp: 0 };
    const walk = mode === 'fighter' ? jumpMp : airborne ? jumpMp * 3 : Math.ceil(walkMp * 0.33);
    return { walkMp: walk, runMp: Math.ceil(walk * 1.5) };
}

/**
 * The movement a converted unit may declare: on the ground an AirMech or a QuadVee in Vehicle mode stands still, walks
 * (cruises) or runs (flanks) and a landed fighter stands still or taxis; in the air an AirMech or a fighter cruises or
 * flanks. Only BattleMech mode jumps or sprints.
 */
export function mekConvertedMotiveModes(mode: MekConvertedMode, airborne: boolean): readonly MotiveModes[] {
    if (airborne && mode !== 'vehicle') return ['walk', 'run'];
    return mode === 'fighter' ? ['stationary', 'walk'] : ['stationary', 'walk', 'run'];
}

/** What a converted unit calls a movement mode: a fighter's thrust, an airborne AirMech's or a vehicle's cruise and flank. */
export function mekConvertedMotiveLabel(
    mode: MekConvertedMode,
    airborne: boolean,
    motive: MotiveModes,
): string {
    if (motive === 'stationary') return 'Stationary';
    const running = motive === 'run';
    if (mode === 'fighter') return running ? 'Max Thrust' : 'Safe Thrust';
    return mode === 'vehicle' || airborne ? (running ? 'Flank' : 'Cruise') : (running ? 'Run' : 'Walk');
}
