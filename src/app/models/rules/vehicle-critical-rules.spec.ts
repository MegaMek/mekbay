// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    vehicleCriticalColumn,
    vehicleCriticalEffect,
    vehicleMotiveModifiers,
    vehicleMotiveStage,
    type VehicleCriticalFacts,
} from './vehicle-critical-rules';

describe('vehicle critical rules', () => {
    const facts = (overrides: Partial<VehicleCriticalFacts> = {}): VehicleCriticalFacts => ({
        vtol: false,
        crewAlive: true,
        driverHit: false,
        commanderHit: false,
        weaponStatuses: ['available'],
        stabilizerHit: false,
        sensorHits: 0,
        engineHit: false,
        fusionEngine: false,
        hasAmmo: true,
        turretLocked: false,
        flightStabilizerHit: false,
        ...overrides,
    });

    it('reads the column of the location struck', () => {
        expect(['Front', 'Left', 'Rear Right', 'Rear', 'Turret', 'Front Turret', 'Rotor'].map(vehicleCriticalColumn))
            .toEqual(['front', 'side', 'side', 'rear', 'turret', 'turret', 'rotor']);
    });

    it('moves down the column past results that cannot apply, starting over at 6 after 12', () => {
        expect(vehicleCriticalEffect(5, 'front', facts())).toBeNull();
        expect(vehicleCriticalEffect(14, 'front', facts())).toBe('crew-killed');
        // No weapons in the front: Weapon Malfunction and Stabilizer give way to Sensors.
        expect(vehicleCriticalEffect(7, 'front', facts({ weaponStatuses: [] }))).toBe('sensors');
        // Rear 12 is the fuel tank; a fusion engine already hit wraps around to 6.
        expect(vehicleCriticalEffect(12, 'rear', facts({ fusionEngine: true, engineHit: true })))
            .toBe('weapon-malfunction');
        // A turret with nothing else left to damage is blown off; ground vehicles have no rotor column.
        expect(vehicleCriticalEffect(8, 'turret', facts({
            weaponStatuses: [], hasAmmo: false, turretLocked: true,
        }))).toBe('turret-blown-off');
        expect(vehicleCriticalEffect(6, 'rotor', facts())).toBeNull();
    });

    it('turns successive crew hits into Crew Stunned, then Crew Killed', () => {
        expect(vehicleCriticalEffect(6, 'front', facts())).toBe('driver-hit');
        expect(vehicleCriticalEffect(6, 'front', facts({ driverHit: true }))).toBe('crew-stunned');
        expect(vehicleCriticalEffect(10, 'front', facts({ driverHit: true, commanderHit: true }))).toBe('crew-killed');
        expect(vehicleCriticalEffect(8, 'side', facts({ driverHit: true, commanderHit: true }))).toBe('crew-killed');
        // A VTOL's second pilot or co-pilot hit kills the crew.
        expect(vehicleCriticalEffect(10, 'front', facts({ vtol: true }))).toBe('pilot-hit');
        expect(vehicleCriticalEffect(6, 'front', facts({ vtol: true, commanderHit: true }))).toBe('crew-killed');
    });

    it('applies the table footnotes for ammunition and fusion engines', () => {
        expect(vehicleCriticalEffect(11, 'rear', facts({ hasAmmo: false }))).toBe('weapon-destroyed');
        expect(vehicleCriticalEffect(12, 'side', facts({ fusionEngine: true }))).toBe('engine-hit');
        expect(vehicleCriticalEffect(12, 'side', facts())).toBe('fuel-tank');
    });

    it('reads the VTOL rotor column', () => {
        const vtol = facts({ vtol: true });
        expect([6, 8, 9, 10, 11, 12].map(roll => vehicleCriticalEffect(roll, 'rotor', vtol)))
            .toEqual(['rotor-damage', 'rotor-damage', 'flight-stabilizer', 'flight-stabilizer', 'rotors-destroyed',
                'rotors-destroyed']);
        expect(vehicleCriticalEffect(9, 'rotor', facts({ vtol: true, flightStabilizerHit: true }))).toBe('rotors-destroyed');
    });

    it('modifies motive rolls by direction and motive type', () => {
        const total = (rows: readonly { value: number }[]) => rows.reduce((sum, row) => sum + row.value, 0);
        expect(total(vehicleMotiveModifiers('front', 'Tracked', false))).toBe(0);
        expect(total(vehicleMotiveModifiers('rear', 'Wheeled', false))).toBe(3);
        expect(total(vehicleMotiveModifiers('rear-left', 'Hover', false))).toBe(5);
        expect(total(vehicleMotiveModifiers('left', 'WiGE', true))).toBe(4);
        expect([5, 6, 8, 10, 12, 15].map(vehicleMotiveStage)).toEqual([0, 1, 2, 3, 4, 4]);
    });
});
