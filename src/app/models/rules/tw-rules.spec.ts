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
import { MEK_LOCATIONS } from '../entity/types';

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
        internal: new Map(MEK_LOCATIONS.map(loc => [loc, { loc, points: 1 }])),
        armor: new Map(MEK_LOCATIONS.map(loc => [loc, { loc, rear: false, points: 1 }])),
    };
    forceUnit.setLocations({}, true);
    forceUnit.writeCrits(critSlots);
    forceUnit.isLoaded.set(true);
    return forceUnit;
}

function hitCrit(forceUnit: CBTForceUnit, loc: string, slot: number): void {
    const crit = forceUnit.getCritSlot(loc, slot);
    if (!crit) throw new Error(`Missing critical slot ${loc}:${slot}`);
    forceUnit.applyHitToCritSlot(crit);
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

    it('ignores TW fall checks while prone but retains the TW hip modifier', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL'),
        ]);
        const turnState = forceUnit.turnState();
        forceUnit.setCondition('prone', true);
        turnState.addDmgReceived(20);
        turnState.setPSRCheckState({ hipsHit: new Set(['LL']) });

        expect(turnState.getPSRChecks()).toEqual([]);
        expect(turnState.PSRRollsCount()).toBe(0);
        expect(forceUnit.rules.PSRModifiers()).toEqual(jasmine.objectContaining({
            modifier: 2,
            modifiers: jasmine.arrayContaining([
                jasmine.objectContaining({ pilotCheck: 2, loc: 'LL', reason: 'Hip Destroyed' }),
            ]),
        }));
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

    it('keeps multiple committed leg-actuator modifiers cumulative in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
            legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL', false),
        ]);

        hitCrit(forceUnit, 'LL', 1);
        hitCrit(forceUnit, 'LL', 2);
        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        expect(forceUnit.rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 2,
            loc: 'LL',
            modifierReason: 'Leg Actuators Destroyed (2)',
        }));
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 3, run: 5 }));
    });

    it('keeps same-phase actuator then hip modifiers cumulative after commit in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);
        let timestamp = 100;
        spyOn(Date, 'now').and.callFake(() => ++timestamp);

        hitCrit(forceUnit, 'LL', 1);
        const actuatorDestructionTimestamp = forceUnit.getCritSlot('LL', 1)?.destroying;
        hitCrit(forceUnit, 'LL', 0);
        const hipDestructionTimestamp = forceUnit.getCritSlot('LL', 0)?.destroying;

        expect(forceUnit.turnState().getPSRChecks().map(check => check.reason)).toEqual([
            'Leg actuator hit',
            'Hip hit',
        ]);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);

        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(actuatorDestructionTimestamp!).toBeLessThan(hipDestructionTimestamp!);
        expect(forceUnit.getCritSlot('LL', 0)?.destroyed).toBe(hipDestructionTimestamp);
        expect(forceUnit.getCritSlot('LL', 1)?.destroyed).toBe(actuatorDestructionTimestamp);
        expect(forceUnit.getCritSlot('LL', 0)?.destroyedTurn)
            .toBe(forceUnit.getCritSlot('LL', 1)?.destroyedTurn);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('keeps same-phase hip then actuator modifiers cumulative after commit in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);
        let timestamp = 150;
        spyOn(Date, 'now').and.callFake(() => ++timestamp);

        hitCrit(forceUnit, 'LL', 0);
        const hipDestructionTimestamp = forceUnit.getCritSlot('LL', 0)?.destroying;
        hitCrit(forceUnit, 'LL', 1);
        const actuatorDestructionTimestamp = forceUnit.getCritSlot('LL', 1)?.destroying;

        expect(forceUnit.turnState().getPSRChecks().map(check => check.reason)).toEqual(
            jasmine.arrayWithExactContents(['Hip hit', 'Leg actuator hit']),
        );
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);

        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(hipDestructionTimestamp!).toBeLessThan(actuatorDestructionTimestamp!);
        expect(forceUnit.getCritSlot('LL', 0)?.destroyed).toBe(hipDestructionTimestamp);
        expect(forceUnit.getCritSlot('LL', 1)?.destroyed).toBe(actuatorDestructionTimestamp);
        expect(forceUnit.getCritSlot('LL', 1)?.destroyedTurn)
            .toBe(forceUnit.getCritSlot('LL', 0)?.destroyedTurn);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('keeps an earlier-phase actuator when the same-turn hip is hit later in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);
        let timestamp = 200;
        spyOn(Date, 'now').and.callFake(() => ++timestamp);

        hitCrit(forceUnit, 'LL', 1);
        forceUnit.endPhase();
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(1);

        hitCrit(forceUnit, 'LL', 0);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(forceUnit.getCritSlot('LL', 1)!.destroyed!)
            .toBeLessThan(forceUnit.getCritSlot('LL', 0)!.destroyed!);
        expect(forceUnit.getCritSlot('LL', 0)?.destroyedTurn)
            .toBe(forceUnit.getCritSlot('LL', 1)?.destroyedTurn);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('keeps a later-phase actuator modifier after an existing same-leg hip in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);
        let timestamp = 300;
        spyOn(Date, 'now').and.callFake(() => ++timestamp);

        hitCrit(forceUnit, 'LL', 0);
        forceUnit.endPhase();
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);

        hitCrit(forceUnit, 'LL', 1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(forceUnit.getCritSlot('LL', 0)!.destroyed!)
            .toBeLessThan(forceUnit.getCritSlot('LL', 1)!.destroyed!);
        expect(forceUnit.getCritSlot('LL', 1)?.destroyedTurn)
            .toBe(forceUnit.getCritSlot('LL', 0)?.destroyedTurn);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('lets a later-turn hip replace an earlier same-leg actuator modifier in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);

        hitCrit(forceUnit, 'LL', 1);
        forceUnit.endTurn();

        hitCrit(forceUnit, 'LL', 0);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(2);
        expect(forceUnit.getCritSlot('LL', 0)!.destroyedTurn!)
            .toBeGreaterThan(forceUnit.getCritSlot('LL', 1)!.destroyedTurn!);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 3, run: 5 }));
    });

    it('keeps a later-turn actuator modifier after an existing same-leg hip in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('hip', 'Hip', 'LL', false),
            legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL', false),
        ]);

        hitCrit(forceUnit, 'LL', 0);
        forceUnit.endTurn();

        hitCrit(forceUnit, 'LL', 1);
        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        forceUnit.endPhase();

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(3);
        expect(forceUnit.getCritSlot('LL', 1)!.destroyedTurn!)
            .toBeGreaterThan(forceUnit.getCritSlot('LL', 0)!.destroyedTurn!);
        expect((forceUnit.rules as TWMekRules).movementState())
            .toEqual(jasmine.objectContaining({ walk: 2, run: 3 }));
    });

    it('retains the destroyed foot actuator PSR modifier in TW', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('foot', 'Foot', 'LL'),
        ]);

        expect(forceUnit.rules.PSRModifiers().modifier).toBe(1);
        expect(forceUnit.rules.PSRModifiers().modifiers).toContain(jasmine.objectContaining({
            pilotCheck: 1,
            loc: 'LL',
            reason: 'Leg Actuator(s) Destroyed',
            modifierReason: 'Leg Actuator Destroyed',
        }));
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

    it('keeps one TW movement trigger when a later hip replaces older same-leg modifiers', () => {
        const forceUnit = createTWForceUnit([
            { ...legActuatorCrit('hip', 'Hip', 'LL'), destroyedTurn: 2 },
            { ...legActuatorCrit('upper-leg', 'Upper Leg Actuator', 'LL'), destroyedTurn: 1 },
            { ...legActuatorCrit('foot', 'Foot', 'LL'), destroyedTurn: 1 },
        ]);
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);

        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            fallCheck: 0,
            pilotCheck: 0,
            kind: 'damaged-leg-actuator-movement',
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

    it('classifies movement checks independently from their display reason', () => {
        const forceUnit = createTWForceUnit([
            legActuatorCrit('lower-leg', 'Lower Leg Actuator', 'LL'),
        ]);
        const turnState = forceUnit.turnState();
        turnState.moveMode.set('jump');
        turnState.moveDistance.set(1);
        spyOn(forceUnit.rules, 'getCommittedDamageMovementModePSRCheck').and.returnValue({
            fallCheck: 0,
            pilotCheck: 0,
            kind: 'damaged-leg-actuator-movement',
            reason: 'Localized movement check label',
        });

        expect(turnState.getPSRChecks()).toEqual([jasmine.objectContaining({
            kind: 'damaged-leg-actuator-movement',
            reason: 'Localized movement check label',
        })]);
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
