// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type { UnitSummary } from "./unit-summary.model";

export type MotiveState = ''

export type MotiveModes = 'stationary' | 'walk' | 'run' | 'jump' | 'UMU' | 'VTOL';

export interface MotiveModeOption {
    mode: MotiveModes;
    label: string;
    psr?: boolean;
}

export function canChangeAirborneGround(unit: UnitSummary): boolean {
    return unit.moveType === 'VTOL' || unit.moveType === 'WiGE' || unit.subtype === 'Land-Air BattleMek';
}

export function getMotiveModeLabel(mode: MotiveModes, unit: UnitSummary, airborne: boolean = false): string {
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
        case 'jump':
            return 'Jump';
        case 'UMU':
            return 'UMU';
        default:
            return mode;
    }
}

export function getMotiveModeMaxDistance(mode: MotiveModes, unit: UnitSummary, airborne: boolean = false): number {
    switch (mode) {
        case 'stationary':
            return 0;
        case 'walk':
            return Math.max(unit.walk, unit.walk2);
        case 'run':
            return Math.max(unit.run, unit.run2);
        case 'jump':
            return unit.jump;
        case 'UMU':
            return unit.umu;
        case 'VTOL':
            return unit.jump; // VTOL MP are stored in the jump field
        default:
            return 0;
    }
}

function canStationary(unit: UnitSummary, airborne: boolean = false): boolean {
    if (airborne && unit.subtype === 'Land-Air BattleMek') return false;
    return true;
}

function canWalk(unit: UnitSummary, airborne: boolean = false): boolean {
    if (!airborne) {
        if (unit.type === 'Aero' || unit.type === 'VTOL') return false;
    }
    return true;
}

function canRun(unit: UnitSummary, airborne: boolean = false): boolean {
    if (unit.type === 'Infantry') return false;
    if (!canWalk(unit, airborne)) return false;
    return true;
}

function canJump(unit: UnitSummary, airborne: boolean = false): boolean {
    return (unit.jump > 0 && !airborne);
}

function canUMU(unit: UnitSummary, airborne: boolean = false): boolean {
    return (unit.umu > 0);
}

function canVTOL(unit: UnitSummary, airborne: boolean = false): boolean {
    // We exclude VTOL units since their walk/run are VTOL modes
    if (unit.type === 'VTOL') return false;
    return (airborne && unit.moveType === 'VTOL');
}

export function getMotiveModesByUnit(unit: UnitSummary, airborne: boolean = false): MotiveModes[] {
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

export function getMotiveModesOptionsByUnit(unit: UnitSummary, airborne: boolean = false): MotiveModeOption[] {
    const modes = getMotiveModesByUnit(unit, airborne ?? false);
    return modes.map(mode => ({
        mode,
        label: getMotiveModeLabel(mode, unit, airborne)
    }));
}