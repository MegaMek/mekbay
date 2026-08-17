// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForce } from '../cbt-force.model';
import { CBTForceUnit } from '../cbt-force-unit.model';
import type { CriticalSlot } from '../force-serialization';
import type { Unit } from '../units.model';
import { EquipmentRegistry } from '../equipment-lookup';
import { DataService } from '../../services/data.service';
import { UnitInitializerService } from '../../services/unit-initializer.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { OptionsService } from '../../services/options.service';
import { TWMekRules } from './tw-rules';

class TestCBTForce extends CBTForce {
    override emitChanged(): void {
    }
}

let dataService: jasmine.SpyObj<DataService>;
let unitInitializer: UnitInitializerService;
let injector: Injector;
let optionsService: OptionsService;

function legActuatorCrit(id: string, name: string, loc: string, destroyed = true): CriticalSlot {
    const slotByActuator = new Map([
        ['hip', 0],
        ['upper-leg', 1],
        ['lower-leg', 2],
        ['foot', 3],
    ]);
    return {
        id,
        name,
        loc,
        slot: slotByActuator.get(id) ?? 0,
        destroyed: destroyed ? 1 : undefined,
    };
}

function createTWForceUnit(critSlots: CriticalSlot[] = []): CBTForceUnit {
    optionsService.options.update(current => ({ ...current, CBTRules: 'tw' }));
    const baseUnit = createEmptyUnit({
        type: 'Mek',
        subtype: 'BattleMek',
        crewSize: 1,
        walk: 5,
        run: 8,
        jump: 4,
        engine: 'Fusion',
    });
    dataService.getUnitByName.and.callFake((name: string): Unit | undefined => name === baseUnit.name ? baseUnit : undefined);
    const force = new TestCBTForce('Test Force', dataService, unitInitializer, injector);
    const forceUnit = new CBTForceUnit(baseUnit, force, dataService, unitInitializer, injector);
    forceUnit.locations = {
        internal: new Map(['LL', 'RL'].map(loc => [loc, { loc, points: 1 }])),
        armor: new Map(['LL', 'RL'].map(loc => [loc, { loc, rear: false, points: 1 }])),
    };
    forceUnit.setLocations({}, true);
    forceUnit.writeCrits(critSlots);
    forceUnit.isLoaded.set(true);
    return forceUnit;
}

describe('TWMekRules', () => {
    beforeEach(() => {
        dataService = jasmine.createSpyObj<DataService>('DataService', ['getEquipmentRegistry', 'findEquipment', 'getUnitByName']);
        dataService.getEquipmentRegistry.and.returnValue(new EquipmentRegistry({}));
        dataService.findEquipment.and.returnValue(undefined);
        TestBed.configureTestingModule({
            providers: [
                UnitInitializerService,
                { provide: DataService, useValue: dataService },
            ],
        });
        unitInitializer = TestBed.inject(UnitInitializerService);
        injector = TestBed.inject(Injector);
        optionsService = TestBed.inject(OptionsService);
    });

    it('uses TWMekRules for the Total Warfare harness', () => {
        expect(createTWForceUnit().rules instanceof TWMekRules).toBeTrue();
    });

    it('keeps every same-leg actuator hit as an independent TW PSR', () => {
        const forceUnit = createTWForceUnit();
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({
            legActuators: new Map([['LL', 2]]),
            hipsHit: new Set(['LL']),
        });

        expect(turnState.getPSRChecks()).toEqual([
            jasmine.objectContaining({ loc: 'LL', fallCheck: 1, pilotCheck: 1, reason: 'Leg actuator hit' }),
            jasmine.objectContaining({ loc: 'LL', fallCheck: 1, pilotCheck: 1, reason: 'Leg actuator hit' }),
            jasmine.objectContaining({ loc: 'LL', fallCheck: 2, pilotCheck: 2, reason: 'Hip hit' }),
        ]);
        expect(turnState.PSRRollsCount()).toBe(3);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(4);
    });

    it('records foot, upper-leg, lower-leg, and hip hits as separate TW triggers', () => {
        const forceUnit = createTWForceUnit([
            { ...legActuatorCrit('foot', 'Foot', 'LL', false), destroying: 1 },
            { ...legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false), destroying: 1 },
            { ...legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL', false), destroying: 1 },
            { ...legActuatorCrit('hip', 'Hip', 'LL', false), destroying: 1 },
        ]);
        const turnState = forceUnit.turnState();
        forceUnit.getCritSlots().forEach(slot => forceUnit.rules.evaluateCritSlotHit(slot));

        expect(turnState.getPSRCheckState().legActuators?.get('LL')).toBe(3);
        expect(turnState.getPSRCheckState().hipsHit?.has('LL')).toBeTrue();
        expect(turnState.getPSRChecks().map(check => check.reason)).toEqual([
            'Leg actuator hit',
            'Leg actuator hit',
            'Leg actuator hit',
            'Hip hit',
        ]);
        expect(turnState.PSRRollsCount()).toBe(4);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(5);
    });

    it('keeps TW actuator hits independent across both legs', () => {
        const forceUnit = createTWForceUnit();
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({
            legActuators: new Map([['LL', 2], ['RL', 1]]),
            hipsHit: new Set(['RL']),
        });

        const checks = turnState.getPSRChecks();

        expect(checks.filter(check => check.loc === 'LL').length).toBe(2);
        expect(checks.filter(check => check.loc === 'RL').length).toBe(2);
        expect(turnState.PSRRollsCount()).toBe(4);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(5);
    });

    it('stacks independent TW actuator checks with damage and gyro PSRs', () => {
        const forceUnit = createTWForceUnit();
        const turnState = forceUnit.turnState();
        turnState.addDmgReceived(20);
        turnState.setPSRCheckState({
            hipsHit: new Set(['LL']),
            gyroHit: 1,
        });

        expect(turnState.getPSRChecks().map(check => check.reason)).toEqual([
            'Received 20 damage',
            'Hip hit',
            'Gyro hit',
        ]);
        expect(turnState.getPSRChecks().map(check => check.pilotCheck)).toEqual([1, 2, 3]);
        expect(turnState.PSRRollsCount()).toBe(3);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(6);
    });

    it('retains one legacy TW movement trigger and hip-dominant modifier for same-leg damage', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL'),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'),
            legActuatorCrit('foot', 'Foot', 'LL'),
        ]);
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            fallCheck: 0,
            pilotCheck: 0,
            reason: 'Jumping with damaged leg actuator',
        })]);
        expect(turnState.PSRRollsCount()).toBe(1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 2,
            loc: 'LL',
            reason: 'Hip Destroyed',
        }));
    });

    it('keeps current-hit and committed-movement actuator PSRs independent in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL'),
        ]);
        const turnState = forceUnit.turnState();
        turnState.setPSRCheckState({ legActuators: new Map([['LL', 1]]) });
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([
            jasmine.objectContaining({ loc: 'LL', pilotCheck: 1, reason: 'Leg actuator hit' }),
            jasmine.objectContaining({ pilotCheck: 0, reason: 'Jumping with damaged leg actuator' }),
        ]);
        expect(turnState.PSRRollsCount()).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
    });

    it('uses Total Warfare Life Support heat thresholds, including torso-mounted cockpits', () => {
        const intact = createTWForceUnit().rules;
        const standard = createTWForceUnit([
            { id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 },
        ]).rules;
        const torsoCockpit = createTWForceUnit([
            { id: 'cockpit', name: 'Cockpit', loc: 'CT', slot: 0 },
            { id: 'life-support', name: 'Life Support', loc: 'HD', slot: 0, destroyed: 1 },
        ]).rules;

        expect(intact.heatLifeSupportPilotHits(30)).toBe(0);
        expect([14, 15, 25, 26].map(heat => standard.heatLifeSupportPilotHits(heat))).toEqual([0, 1, 1, 2]);
        expect([1, 14, 15].map(heat => torsoCockpit.heatLifeSupportPilotHits(heat))).toEqual([1, 1, 2]);
    });
});
