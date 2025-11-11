/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { Unit } from "./units.model";

export type MotiveState = ''

export type MotiveModes = 'stationary' | 'walk' | 'run' | 'jump' | 'UMU' | 'VTOL';

export interface MotiveModeOption {
    mode: MotiveModes;
    label: string;
}

export function canChangeAirborneGround(unit: Unit): boolean {
    return unit.moveType === 'VTOL' || unit.moveType === 'WiGE' || unit.subtype === 'Land-Air BattleMek';
}

export function getMotiveModeLabel(mode: MotiveModes, unit: Unit, airborne: boolean = false): string {
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

export function getMotiveModeMaxDistance(mode: MotiveModes, unit: Unit, airborne: boolean = false): number {
    switch (mode) {
        case 'stationary':
            return 0;
        case 'walk':
            return unit.walk;
        case 'run':
            return unit.run;
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

function canStationary(unit: Unit, airborne: boolean = false): boolean {
    return true;
}

function canWalk(unit: Unit, airborne: boolean = false): boolean {
    if (!airborne) {
        if (unit.type === 'Aero' || unit.type === 'VTOL') return false;
    }
    return true;
}

function canRun(unit: Unit, airborne: boolean = false): boolean {
    if (unit.type === 'Infantry') return false;
    if (!canWalk(unit, airborne)) return false;
    return true;
}

function canJump(unit: Unit, airborne: boolean = false): boolean {
    return (unit.jump > 0 && !airborne);
}

function canUMU(unit: Unit, airborne: boolean = false): boolean {
    return (unit.umu > 0);
}

function canVTOL(unit: Unit, airborne: boolean = false): boolean {
    // We exclude VTOL units since their walk/run are VTOL modes
    if (unit.type === 'VTOL') return false;
    return (airborne && unit.moveType === 'VTOL');
}

export function getMotiveModesByUnit(unit: Unit, airborne: boolean = false): MotiveModes[] {
    if ((unit.type === 'Handheld Weapon')) return [];
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

export function getMotiveModesOptionsByUnit(unit: Unit, airborne: boolean = false): MotiveModeOption[] {
    const modes = getMotiveModesByUnit(unit, airborne ?? false);
    return modes.map(mode => ({
        mode,
        label: getMotiveModeLabel(mode, unit, airborne)
    }));
}