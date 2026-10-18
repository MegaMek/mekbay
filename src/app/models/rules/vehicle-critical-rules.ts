// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EquipmentStatus } from '../equipment-status.model';
import type { VehicleMotiveType } from '../entity/types/motive';
import type { NonMekHitArc } from '../runtime/non-mek-hit-location';

/** The column of a Vehicle Critical Hits Table: the location struck. */
export type VehicleCriticalColumn = 'front' | 'side' | 'rear' | 'turret' | 'rotor';

export type VehicleCriticalEffect =
    | 'driver-hit' | 'commander-hit' | 'pilot-hit' | 'co-pilot-hit'
    | 'crew-stunned' | 'crew-killed'
    | 'weapon-malfunction' | 'weapon-destroyed'
    | 'stabilizer' | 'sensors' | 'engine-hit' | 'fuel-tank' | 'ammunition' | 'cargo-hit'
    | 'turret-jam' | 'turret-locks' | 'turret-blown-off'
    | 'rotor-damage' | 'flight-stabilizer' | 'rotors-destroyed';

export const VEHICLE_CRITICAL_LABELS: Readonly<Record<VehicleCriticalEffect, string>> = {
    'driver-hit': 'Driver Hit', 'commander-hit': 'Commander Hit', 'pilot-hit': 'Pilot Hit', 'co-pilot-hit': 'Co-Pilot Hit',
    'crew-stunned': 'Crew Stunned', 'crew-killed': 'Crew Killed',
    'weapon-malfunction': 'Weapon Malfunction', 'weapon-destroyed': 'Weapon Destroyed',
    stabilizer: 'Stabilizer', sensors: 'Sensors', 'engine-hit': 'Engine Hit', 'fuel-tank': 'Fuel Tank',
    ammunition: 'Ammunition', 'cargo-hit': 'Cargo/Infantry Hit',
    'turret-jam': 'Turret Jam', 'turret-locks': 'Turret Locks', 'turret-blown-off': 'Turret Blown Off',
    'rotor-damage': 'Rotor Damage', 'flight-stabilizer': 'Flight Stabilizer Hit', 'rotors-destroyed': 'Rotors Destroyed',
};

/** Results 6 through 12 of each column (TW p.194; VTOL p.196). */
const GROUND_CRITICALS: Readonly<Record<Exclude<VehicleCriticalColumn, 'rotor'>, readonly VehicleCriticalEffect[]>> = {
    front: ['driver-hit', 'weapon-malfunction', 'stabilizer', 'sensors', 'commander-hit', 'weapon-destroyed', 'crew-killed'],
    side: ['cargo-hit', 'weapon-malfunction', 'crew-stunned', 'stabilizer', 'weapon-destroyed', 'engine-hit', 'fuel-tank'],
    rear: ['weapon-malfunction', 'cargo-hit', 'stabilizer', 'weapon-destroyed', 'engine-hit', 'ammunition', 'fuel-tank'],
    turret: ['stabilizer', 'turret-jam', 'weapon-malfunction', 'turret-locks', 'weapon-destroyed', 'ammunition',
        'turret-blown-off'],
};

const VTOL_CRITICALS: Readonly<Record<VehicleCriticalColumn, readonly VehicleCriticalEffect[]>> = {
    front: ['co-pilot-hit', 'weapon-malfunction', 'stabilizer', 'sensors', 'pilot-hit', 'weapon-destroyed', 'crew-killed'],
    side: ['weapon-malfunction', 'cargo-hit', 'stabilizer', 'weapon-destroyed', 'engine-hit', 'ammunition', 'fuel-tank'],
    rear: ['cargo-hit', 'weapon-malfunction', 'stabilizer', 'weapon-destroyed', 'sensors', 'engine-hit', 'fuel-tank'],
    rotor: ['rotor-damage', 'rotor-damage', 'rotor-damage', 'flight-stabilizer', 'flight-stabilizer', 'rotors-destroyed',
        'rotors-destroyed'],
    turret: GROUND_CRITICALS.turret,
};

/** What decides whether a critical result applies to the vehicle as it stands. */
export interface VehicleCriticalFacts {
    readonly vtol: boolean;
    readonly crewAlive: boolean;
    /** Ground: the driver; VTOL: the pilot. */
    readonly driverHit: boolean;
    /** Ground: the commander; VTOL: the co-pilot. */
    readonly commanderHit: boolean;
    /** Every weapon mounted in the location struck. */
    readonly weaponStatuses: readonly EquipmentStatus[];
    readonly stabilizerHit: boolean;
    readonly sensorHits: number;
    readonly engineHit: boolean;
    readonly fusionEngine: boolean;
    readonly hasAmmo: boolean;
    readonly turretLocked: boolean;
    readonly flightStabilizerHit: boolean;
}

export function vehicleCriticalColumn(locationCode: string): VehicleCriticalColumn {
    if (locationCode === 'Front') return 'front';
    if (locationCode === 'Rear') return 'rear';
    if (locationCode === 'Rotor') return 'rotor';
    return locationCode.includes('Turret') ? 'turret' : 'side';
}

/**
 * One critical roll on the location's column. A result that cannot apply moves down the column, starting
 * over at 6 after 12; a column with nothing left to damage has no effect (TW p.194).
 */
export function vehicleCriticalEffect(
    roll: number,
    column: VehicleCriticalColumn,
    facts: VehicleCriticalFacts,
): VehicleCriticalEffect | null {
    const effects = facts.vtol ? VTOL_CRITICALS[column] : column === 'rotor' ? undefined : GROUND_CRITICALS[column];
    if (roll < 6 || !effects) return null;
    const start = Math.min(roll, 12) - 6;
    for (let offset = 0; offset < effects.length; offset++) {
        const effect = applicableVehicleCriticalEffect(effects[(start + offset) % effects.length]!, facts);
        if (effect) return effect;
    }
    return null;
}

/** The result a listed effect becomes on this vehicle, or null when it cannot apply. */
export function applicableVehicleCriticalEffect(
    effect: VehicleCriticalEffect,
    facts: VehicleCriticalFacts,
): VehicleCriticalEffect | null {
    switch (effect) {
        // Successive driver and commander hits are crew stunned (TW p.195).
        case 'driver-hit':
            return !facts.crewAlive ? null : facts.driverHit ? applicableVehicleCriticalEffect('crew-stunned', facts) : effect;
        case 'commander-hit':
            return !facts.crewAlive ? null : facts.commanderHit ? applicableVehicleCriticalEffect('crew-stunned', facts) : effect;
        // A VTOL's second pilot or co-pilot hit kills the crew (TW p.197).
        case 'pilot-hit':
            return !facts.crewAlive ? null : facts.driverHit ? 'crew-killed' : effect;
        case 'co-pilot-hit':
            return !facts.crewAlive ? null : facts.commanderHit ? 'crew-killed' : effect;
        case 'crew-stunned':
            return !facts.crewAlive ? null : facts.driverHit && facts.commanderHit ? 'crew-killed' : effect;
        case 'crew-killed':
            return facts.crewAlive ? effect : null;
        case 'weapon-malfunction':
            return facts.weaponStatuses.includes('available') ? effect : null;
        case 'weapon-destroyed':
            return facts.weaponStatuses.some(status => status !== 'destroyed') ? effect : null;
        // A stabilizer steadies the weapons in its location; one hit per location (MegaMek).
        case 'stabilizer':
            return !facts.stabilizerHit && facts.weaponStatuses.length > 0 ? effect : null;
        case 'sensors':
            return facts.sensorHits < 4 ? effect : null;
        case 'engine-hit':
            return facts.engineHit ? null : effect;
        case 'fuel-tank':
            return facts.fusionEngine ? applicableVehicleCriticalEffect('engine-hit', facts) : effect;
        case 'ammunition':
            return facts.hasAmmo ? effect : applicableVehicleCriticalEffect('weapon-destroyed', facts);
        // Carried cargo and infantry are not tracked, so the hit moves down the column.
        case 'cargo-hit':
            return null;
        case 'turret-jam':
        case 'turret-locks':
            return facts.turretLocked ? null : effect;
        case 'flight-stabilizer':
            return facts.flightStabilizerHit ? null : effect;
        case 'turret-blown-off':
        case 'rotor-damage':
        case 'rotors-destroyed':
            return effect;
    }
}

export interface VehicleMotiveModifier {
    readonly label: string;
    readonly value: number;
}

/** Motive System Damage Table modifiers (TW p.193); an armored motive system subtracts 2 (TacOps). */
export function vehicleMotiveModifiers(
    arc: NonMekHitArc,
    motive: VehicleMotiveType,
    armoredMotiveSystem: boolean,
): readonly VehicleMotiveModifier[] {
    const direction = arc === 'front' ? 0 : arc === 'rear' ? 1 : 2;
    const type = motive === 'Wheeled' ? 2 : motive === 'Hover' || motive === 'Hydrofoil' ? 3 : motive === 'WiGE' ? 4 : 0;
    return Object.freeze([
        ...(direction > 0 ? [{ label: direction === 1 ? 'Hit from the rear' : 'Hit from the side', value: direction }] : []),
        ...(type > 0 ? [{ label: motive, value: type }] : []),
        ...(armoredMotiveSystem ? [{ label: 'Armored motive system', value: -2 }] : []),
    ].map(row => Object.freeze(row)));
}

/** The motive damage stage of a modified roll: none, minor, moderate, heavy, or immobile (TW p.193). */
export function vehicleMotiveStage(total: number): 0 | 1 | 2 | 3 | 4 {
    return total >= 12 ? 4 : total >= 10 ? 3 : total >= 8 ? 2 : total >= 6 ? 1 : 0;
}
