import { Unit } from "./units.model";

export type MotiveModes = 'stationary' | 'walk' | 'run' | 'jump' | 'UMU';

export interface MotiveModeOption {
    mode: MotiveModes;
    label: string;
}

export function getMotiveModeLabel(mode: MotiveModes, unit: Unit): string {
    let isVehicle = unit.type === 'VTOL' || unit.type === 'Naval' || unit.type === 'Tank';
    switch (mode) {
        case 'stationary':
            return 'Stationary';
        case 'walk':
            return isVehicle ? 'Cruise' : 'Walk';
        case 'run':
            return isVehicle ? 'Flank' : 'Run';
        case 'jump':
            return 'Jump';
        case 'UMU':
            return 'UMU';
        default:
            return mode;
    }
}

export function getMotiveModesByUnit(unit: Unit): MotiveModes[] {
    if ((unit.type === 'Handheld Weapon')) return [];
    const modes: MotiveModes[] = [];
    modes.push('stationary');
    modes.push('walk');
    if (unit.type !== 'Infantry') {
        modes.push('run');
    }
    if (unit.jump > 0) {
        modes.push('jump');
    }
    if (unit.umu > 0) {
        modes.push('UMU');
    }
    return modes;
}

export function getMotiveModesOptionsByUnit(unit: Unit): MotiveModeOption[] {
    const modes = getMotiveModesByUnit(unit);
    return modes.map(mode => ({
        mode,
        label: getMotiveModeLabel(mode, unit)
    }));
}