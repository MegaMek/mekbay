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
    let isVehicle = unit.type === 'VTOL' || unit.type === 'Naval' || unit.type === 'Tank';
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
    return modes;
}

export function getMotiveModesOptionsByUnit(unit: Unit, airborne: boolean = false): MotiveModeOption[] {
    const modes = getMotiveModesByUnit(unit, airborne ?? false);
    return modes.map(mode => ({
        mode,
        label: getMotiveModeLabel(mode, unit, airborne)
    }));
}