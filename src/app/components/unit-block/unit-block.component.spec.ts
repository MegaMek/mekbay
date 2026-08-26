// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import type { CBTForce } from '../../models/cbt-force.model';
import { GameSystem } from '../../models/common.model';
import { CBTForceMember } from '../../models/force-member.model';
import type { ForceUnit } from '../../models/force-unit.model';
import { asUnitInstanceId } from '../../models/runtime/runtime-state';
import { createUnitTagEcmCapabilitySummary } from '../../models/unit-capability-summary.model';
import type { UnitSummary } from '../../models/unit-summary.model';
import { OptionsService } from '../../services/options.service';
import { UnitBlockComponent } from './unit-block.component';

describe('UnitBlockComponent capability badges', () => {
    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options: signal({}) } },
            ],
        }).compileComponents();
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

    it('includes computed and transient V2 conditions in the unit-card badges', () => {
        const changed = new Subject<void>();
        const force = {
            changed,
            getMekRecordSheetSnapshot: () => ({
                conditions: ['prone'],
                crippled: true,
                crew: [{ effectiveState: 'unconscious' }],
                locations: [{ conditions: [{ condition: 'narc', committed: 0, preview: 1 }] }],
            }),
            getMekTurnPanelSnapshot: () => ({
                conditions: ['prone', 'immobile'],
                turn: { spotting: true },
            }),
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            asUnitInstanceId('unit:condition-card'),
            force,
            { entityType: 'Mek' } as UnitSummary,
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
            asUnitInstanceId('unit:vehicle-condition-card'),
            force,
            { entityType: 'Tank' } as UnitSummary,
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
            gameSystem: GameSystem.CLASSIC,
            readOnly: () => false,
            getUnitDestroyed: () => false,
            getUnitCrewAssignment: () => ({ positions: [] }),
            getUnitAdjustedBattleValue: () => 0,
            getUnitCurrentBaseBattleValue: () => 0,
            getUnitPristineBattleValue: () => 0,
            getUnitTagBattleValue: () => 0,
            getUnitC3BattleValue: () => 0,
            getC3State: () => 'none',
            isUnitCommander: () => false,
            getUnitConditions: () => [],
            getNonMekRecordSheetSnapshot,
        } as unknown as CBTForce;
        const member = new CBTForceMember(
            asUnitInstanceId('unit:scoped-card'),
            force,
            { entityType: 'Tank' } as UnitSummary,
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
