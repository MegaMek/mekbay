// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { CBTForce } from '../../models/cbt-force.model';
import { GameSystem } from '../../models/common.model';
import { CBTForceMember } from '../../models/force-member.model';
import {
    TestBipedMekEntity,
    TestTankEntity,
    TestProtoMekEntity,
} from '../../models/entity/testing/test-entities';
import { addTestEquipment } from '../../models/entity/testing/test-mounted-equipment';
import { createEquipment, WeaponEquipment } from '../../models/equipment.model';
import type { ForceUnit } from '../../models/force-unit.model';
import { buildMekRuntimeIndex } from '../../models/runtime/mek-runtime-index';
import { createDirectMekRuntimeFixture } from '../../models/runtime/testing/direct-mek-runtime-fixture';
import { createUnitTagEcmCapabilitySummary } from '../../models/unit-capability-summary.model';
import { OptionsService } from '../../services/options.service';
import { projectRuntimePendingNotification } from '../unit-notification-badges/unit-notification-badges.component';
import { UnitBlockComponent } from './unit-block.component';

describe('UnitBlockComponent capability badges', () => {
    let runtimeOptions: WritableSignal<{ readonly trackPhaseAndTurn: boolean }>;

    beforeEach(async () => {
        runtimeOptions = signal({ trackPhaseAndTurn: true });
        await TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: {
                    options: runtimeOptions,
                    cbtAutomationMode: () => 'ask',
                } },
            ],
        }).compileComponents();
    });

    it('keeps every crew station visible and displays effective rather than stored fixed piloting', () => {
        const person = { id: 'pilot', name: 'Morgan', gunnery: 2, piloting: 2 };
        const occupant = signal<typeof person | undefined>(person);
        const force = {
            changed: new Subject<void>(),
            getUnitCrewPolicy: () => ({ positions: [{ positionId: 'crew:0', label: 'Pilot' },
                { positionId: 'crew:1', label: 'Gunner' }] }),
            getAssignedPerson: (_unitId: string, positionId: string) => positionId === 'crew:0' ? occupant() : undefined,
        } as unknown as CBTForce;
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', new CBTForceMember('proto', force, new TestProtoMekEntity()));
        expect(fixture.componentInstance.crewBadges().map(badge => [badge.positionId, badge.skills, badge.vacant]))
            .toEqual([['crew:0', '2/5', false], ['crew:1', '—', true]]);
        expect(person.piloting).toBe(2);
        occupant.set(undefined);
        expect(fixture.componentInstance.crewBadges().every(badge => badge.vacant)).toBeTrue();
        fixture.destroy();
    });

    it('reads TAG and ECM display data only through the immutable unit summary', () => {
        const summary = createUnitTagEcmCapabilitySummary({
            tag: { label: 'LTAG', unavailable: true },
            ecm: { mode: 'ecm-ghost', unavailable: false },
        });
        const getTagEcmCapabilitySummary = jasmine.createSpy('getTagEcmCapabilitySummary')
            .and.returnValue(summary);
        const forceUnit = { getTagEcmCapabilitySummary } as unknown as ForceUnit;
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.tagDisplay()).toBe(summary.tag!);
        expect(fixture.componentInstance.ecmDisplay()).toBe(summary.ecm!);
        expect(getTagEcmCapabilitySummary).toHaveBeenCalledTimes(1);
    });

    it('omits both badges when the authority reports no capabilities', () => {
        const forceUnit = {
            getTagEcmCapabilitySummary: () => createUnitTagEcmCapabilitySummary({}),
        } as unknown as ForceUnit;
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.tagDisplay()).toBeUndefined();
        expect(fixture.componentInstance.ecmDisplay()).toBeNull();
    });

    it('projects CBT capability badges from Entity equipment and runtime state', () => {
        const changed = new Subject<void>();
        const entity = new TestBipedMekEntity();
        addTestEquipment(entity, new WeaponEquipment({
            id: 'Test Light TAG',
            name: 'Test Light TAG',
            type: 'weapon',
            flags: ['F_TAG'],
            weapon: { ammoType: 'NA', damage: 0, rackSize: 0, ranges: [3, 6, 9, 12] },
        }));
        addTestEquipment(entity, createEquipment({
            id: 'Test ECM', name: 'Test ECM', type: 'misc', flags: ['F_ECM'],
        }));
        const index = buildMekRuntimeIndex(entity);
        const getUnitSnapshot = jasmine.createSpy('getUnitSnapshot').and.returnValue({
            index,
            query: {
                destroyed: () => false,
                hasCondition: () => false,
                componentStatus: () => 'available',
                componentMode: () => undefined,
            },
        });
        const force = { changed, getUnitSnapshot } as unknown as CBTForce;
        const member = new CBTForceMember(
            'unit:classic-capability-card',
            force,
            entity,
        );
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);

        expect(fixture.componentInstance.tagDisplay()).toEqual({ label: 'LTAG', unavailable: false });
        expect(fixture.componentInstance.ecmDisplay()).toEqual({ mode: 'ecm', unavailable: false });
        expect(getUnitSnapshot).toHaveBeenCalledWith(member.id);
        fixture.destroy();
    });

    it('projects pending End Phase PSRs into the unit-card badge host', () => {
        runtimeOptions.set({ trackPhaseAndTurn: false });
        const runtime = createDirectMekRuntimeFixture('total-warfare');
        const foot = [...runtime.index.slots.values()].find(candidate =>
            runtime.index.locations.get(candidate.locationId)?.code === 'LL'
            && candidate.componentIds.some(componentId => {
                const component = runtime.index.components.get(componentId);
                return component?.kind === 'system' && component.systemType === 'Foot Actuator';
            }))!;
        expect(runtime.instance.dispatch({
            type: 'hit-critical',
            slotId: foot.id,
            hits: 1,
            target: 'pending',
        }).accepted).toBeTrue();
        const changed = new Subject<void>();
        const force = {
            changed,
            getUnitSnapshot: (instanceId: string) => ({
                instanceId,
                entity: runtime.entity,
                index: runtime.index,
                sourceRef: runtime.identity,
                ruleset: runtime.instance.ruleset(),
                crewAssignment: runtime.instance.query().crewAssignment(),
                state: runtime.instance.snapshot(),
                query: runtime.instance.query(),
            }),
        } as unknown as CBTForce;
        const member = new CBTForceMember('unit:pending-card', force, runtime.entity);
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);

        expect(projectRuntimePendingNotification(
            fixture.componentInstance.notificationSnapshot(),
        )).toEqual(jasmine.objectContaining({ kind: 'psr', count: 1 }));
        fixture.destroy();
    });

    it('includes computed and transient V2 conditions in the unit-card badges', () => {
        const changed = new Subject<void>();
        const force = {
            changed,
            getMekUnitStatusSnapshot: () => ({
                conditions: ['prone', 'immobile', 'crippled', 'spotting'],
                crew: [{ effectiveState: 'unconscious' }],
                hasNarc: true,
            }),
            getMekTurnPanelSnapshot: () => ({
                conditions: ['prone', 'immobile'],
                turn: { spotting: true },
            }),
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            'unit:condition-card',
            force,
            new TestBipedMekEntity(),
        );
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);

        expect(fixture.componentInstance.activeConditions().map(condition => condition.key)).toEqual([
            'immobile',
            'prone',
            'crippled',
            'spotting',
            'crew-unconscious',
            'location-narc',
        ]);
        fixture.destroy();
    });

    it('projects the declared movement mode with the complete defender modifier', () => {
        const changed = new Subject<void>();
        const force = {
            changed,
            getMekTurnPanelSnapshot: () => ({
                movementState: {
                    movement: { mode: 'walk', distance: 1, boosterComponentIds: [] },
                },
                defenseModifierTotal: { modifier: 0 },
            }),
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            'unit:movement-card',
            force,
            new TestBipedMekEntity(),
        );
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);

        expect(fixture.componentInstance.movementIndicator()).toEqual({
            color: 'walk',
            letter: 'W0',
        });
        fixture.destroy();
    });

    it('shows one direct Entity vehicle crew-state badge', () => {
        const changed = new Subject<void>();
        const force = {
            changed,
            getUnitConditions: () => ['jammed'],
            getNonMekRecordSheetSnapshot: () => ({
                unitType: 'Tank',
                crew: [
                    { effectiveState: 'stunned' },
                    { effectiveState: 'stunned' },
                ],
            }),
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            'unit:vehicle-condition-card',
            force,
            new TestTankEntity(),
        );
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);

        expect(fixture.componentInstance.activeConditions()).toEqual([
            { key: 'jammed', label: 'JAMMED', color: '#ff6be6' },
            { key: 'crew-stunned', label: 'STUNNED', color: '#ff5ce6' },
        ]);
        fixture.destroy();
    });

    it('ignores runtime changes scoped to another unit', () => {
        const changed = new Subject<readonly string[] | null>();
        const getNonMekRecordSheetSnapshot = jasmine.createSpy('getNonMekRecordSheetSnapshot')
            .and.returnValue({ unitType: 'Tank', crew: [] });
        const force = {
            changed,
            gameSystem: GameSystem.CBT,
            readOnly: () => false,
            getUnitDestroyed: () => false,
            getUnitCrewAssignment: () => ({ positions: [] }),
            getUnitCrewPolicy: () => ({ positions: [] }),
            getUnitAdjustedBattleValue: () => 0,
            getUnitCurrentBaseBattleValue: () => 0,
            getUnitPristineBattleValue: () => 0,
            getUnitTagBattleValue: () => 0,
            getUnitC3BattleValue: () => 0,
            getUnitSkillBattleValue: () => 0,
            getC3State: () => 'none',
            getUnitSnapshot: () => null,
            isUnitCommander: () => false,
            getUnitConditions: () => [],
            getNonMekRecordSheetSnapshot,
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            'unit:scoped-card',
            force,
            new TestTankEntity(),
        );
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', member);
        fixture.detectChanges();
        fixture.componentInstance.activeConditions();
        const initialCalls = getNonMekRecordSheetSnapshot.calls.count();

        changed.next(['unit:other']);
        fixture.detectChanges();
        fixture.componentInstance.activeConditions();
        expect(getNonMekRecordSheetSnapshot.calls.count()).toBe(initialCalls);

        changed.next([member.id]);
        fixture.detectChanges();
        fixture.componentInstance.activeConditions();
        expect(getNonMekRecordSheetSnapshot.calls.count()).toBe(initialCalls + 1);

        changed.next(null);
        fixture.detectChanges();
        fixture.componentInstance.activeConditions();
        expect(getNonMekRecordSheetSnapshot.calls.count()).toBe(initialCalls + 2);
        fixture.destroy();
    });
});


describe('UnitBlockComponent name wrapping', () => {
    it('moves the whole pilot name below the chassis when the row is too narrow', async () => {
        await TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [{ provide: OptionsService, useValue: { options: signal({ unitDisplayName: 'both' }) } }],
        }).compileComponents();
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentInstance.unit = signal({ name: 'King Crab', chassis: 'King Crab', model: '', role: '', tons: 100 });
        fixture.componentInstance.alias = signal('Pilot Name');
        fixture.detectChanges();
        const line = fixture.nativeElement.querySelector('.unit-name-line') as HTMLElement;
        const chassis = line.querySelector('.chassis') as HTMLElement;
        const pilot = line.querySelector('.unit-alias') as HTMLElement;
        line.style.width = '400px';
        const chassisWidth = chassis.getBoundingClientRect().width;
        const pilotWidth = pilot.getBoundingClientRect().width;
        const lineHeight = chassis.getBoundingClientRect().height;
        expect(Math.abs(pilot.getBoundingClientRect().top - chassis.getBoundingClientRect().top)).toBeLessThan(3);

        line.style.width = Math.ceil(Math.max(chassisWidth, pilotWidth) + 2) + 'px';
        const chassisBounds = chassis.getBoundingClientRect();
        const pilotBounds = pilot.getBoundingClientRect();
        expect(pilotBounds.top).toBeGreaterThanOrEqual(chassisBounds.bottom);
        expect(Math.abs(pilotBounds.left - chassisBounds.left)).toBeLessThan(1);
        expect(chassisBounds.height).toBe(lineHeight);
        expect(pilotBounds.width).toBeCloseTo(pilotWidth, 0);
        fixture.destroy();
    });
});
