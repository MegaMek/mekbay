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

export function getMotiveModesByUnit(unit: Unit, airborne: boolean = false): MotiveModes[] {
    if ((unit.type === 'Handheld Weapon')) return [];
    const modes: MotiveModes[] = [];
    modes.push('stationary');
    modes.push('walk');
    if (unit.type !== 'Infantry') {
        modes.push('run');
    }
    if (unit.jump > 0 && !airborne) {
        modes.push('jump');
    }
    if (unit.umu > 0) {
        modes.push('UMU');
    }
    if (airborne && unit.moveType === 'VTOL') {
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