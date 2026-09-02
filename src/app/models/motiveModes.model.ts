// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { BaseEntity } from './entity/base-entity';
import type { UnitSubtype, UnitType } from './entity/types';

export type MotiveModes = 'stationary' | 'walk' | 'run' | 'sprint' | 'jump' | 'UMU' | 'VTOL';

export interface MotiveModeOption {
    mode: MotiveModes;
    label: string;
    psr?: boolean;
}

/** Small rules input shared by unloaded search summaries and loaded Entities. */
export interface MotiveModeUnitFacts {
    readonly type: UnitType;
    readonly subtype: UnitSubtype;
    readonly moveType: string;
    readonly walk: number;
    readonly walk2: number;
    readonly run: number;
    readonly run2: number;
    readonly jump: number;
    readonly umu: number;
}

/** Canonical movement facts for a loaded unit; unloaded catalog data is never consulted. */
export function motiveModeFactsForEntity(entity: BaseEntity): MotiveModeUnitFacts {
    return Object.freeze({
        type: entity.unitType(),
        subtype: entity.unitSubtype(),
        moveType: entity.getMotiveTypeAsString() ?? 'None',
        walk: entity.walkMP(),
        walk2: entity.maxWalkMP(),
        run: entity.runMP(),
        run2: entity.maxRunMP(),
        jump: entity.jumpMP(),
        umu: entity.umuMP(),
    });
}

export function canChangeAirborneGround(unit: MotiveModeUnitFacts): boolean {
    return unit.moveType === 'VTOL' || unit.moveType === 'WiGE' || unit.subtype === 'Land-Air BattleMek';
}

export function getMotiveModeLabel(mode: MotiveModes, unit: MotiveModeUnitFacts, airborne: boolean = false): string {
    if (unit.type === 'Aero') {
        if (mode === 'walk') return 'Safe Thrust';
        if (mode === 'run') return 'Maximum Thrust';
    }
    let isVehicle = unit.type === 'VTOL' || unit.type === 'Naval' || unit.type === 'Tank' || unit.type === 'Aero';
    switch (mode) {
        case 'stationary':
            return 'Stationary';
        case 'walk':
            return (isVehicle || airborne) ? 'Cruise' : 'Walk';
        case 'run':
            return (isVehicle || airborne) ? 'Flank' : 'Run';
        case 'sprint':
            return 'Sprint';
        case 'jump':
            return 'Jump';
        case 'UMU':
            return 'UMU';
        default:
            return mode;
    }
}

function canStationary(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    if (airborne && unit.subtype === 'Land-Air BattleMek') return false;
    return true;
}

function canWalk(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    if (!airborne) {
        if (unit.type === 'Aero' || unit.type === 'VTOL') return false;
    }
    return true;
}

function canRun(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    if (unit.type === 'Infantry') return false;
    if (!canWalk(unit, airborne)) return false;
    return true;
}

function canJump(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    return (unit.jump > 0 && !airborne);
}

function canSprint(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    return unit.type === 'Mek' && !airborne;
}

function canUMU(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    return (unit.umu > 0);
}

function canVTOL(unit: MotiveModeUnitFacts, airborne: boolean = false): boolean {
    // We exclude VTOL units since their walk/run are VTOL modes
    if (unit.type === 'VTOL') return false;
    return (airborne && unit.moveType === 'VTOL');
}

export function getMotiveModesByUnit(unit: MotiveModeUnitFacts, airborne: boolean = false): MotiveModes[] {
    if ((unit.type === 'Handheld Weapon')) return [];
    if (unit.type === 'Aero') return ['stationary', 'walk', 'run'];
    const modes: MotiveModes[] = [];
    if (canStationary(unit, airborne)) {
        modes.push('stationary');
    }
    if (canWalk(unit, airborne)) {
        modes.push('walk');
    }
    if (canRun(unit, airborne)) {
        modes.push('run');
    }
    if (canSprint(unit, airborne)) {
        modes.push('sprint');
    }
    if (canJump(unit, airborne)) {
        modes.push('jump');
    }
    if (canUMU(unit, airborne)) {
        modes.push('UMU');
    }
    if (canVTOL(unit, airborne)) {
        modes.push('VTOL');
    }
    return modes;
}

export function getMotiveModesOptionsByUnit(unit: MotiveModeUnitFacts, airborne: boolean = false): MotiveModeOption[] {
    const modes = getMotiveModesByUnit(unit, airborne ?? false);
    return modes.map(mode => ({
        mode,
        label: getMotiveModeLabel(mode, unit, airborne)
    }));
}
