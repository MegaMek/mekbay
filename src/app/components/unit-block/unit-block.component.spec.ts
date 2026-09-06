// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CrewMemberState } from '../../models/crew-member.model';
import type { ForceViewerBVPVDisplay } from '../../models/options.model';
import type { CrewStateDefinition } from '../../models/rules/unit-type-rules';
import { VEHICLE_CREW_STATE_DISPLAYS } from '../../models/rules/vehicle-rules';
import { OptionsService } from '../../services/options.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { UnitBlockComponent } from './unit-block.component';

describe('UnitBlockComponent', () => {
    const options = signal({
        trackPhaseAndTurn: true,
        unitDisplayName: 'chassisModel',
        forceViewerBVPVDisplay: 'both' as ForceViewerBVPVDisplay,
    });

    beforeEach(() => {
        options.update(current => ({ ...current, forceViewerBVPVDisplay: 'both' }));
        TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: OptionsService,
                    useValue: { options },
                },
                { provide: Overlay, useValue: {} },
                {
                    provide: SpriteStorageService,
                    useValue: { loading: signal(false) },
                },
            ],
        });
    });

    it('displays rounded pre-skill BV and collapses matching adjusted and base values', () => {
        const adjustedBv = signal(2_251);
        const forceUnit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        Object.assign(forceUnit, {
            getBv: adjustedBv,
            getPreSkillBv: signal(2_250.6),
            baseAdjustedBv: signal(2_251),
        });
        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.displayedBvPv()).toBe('2,251');

        adjustedBv.set(2_971);
        expect(fixture.componentInstance.displayedBvPv()).toBe('2,971 (2,251)');

        options.update(current => ({ ...current, forceViewerBVPVDisplay: 'base' }));
        expect(fixture.componentInstance.displayedBvPv()).toBe('2,251');

        options.update(current => ({ ...current, forceViewerBVPVDisplay: 'adjusted' }));
        expect(fixture.componentInstance.displayedBvPv()).toBe('2,971');
    });

    it('tracks phase-dirty state independently from assigned movement', () => {
        const dirtyPhase = signal(false);
        const moveMode = signal<'walk' | null>(null);
        const defenderModifier = signal(4);
        const forceUnit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        Object.assign(forceUnit, {
            turnState: () => ({
                dirtyPhase,
                moveMode,
                getTotalTargetModifierAsDefender: () => ({ modifier: defenderModifier() }),
            }),
        });

        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.dirty()).toBeFalse();
        expect(fixture.componentInstance.movementIndicator()).toBeNull();

        moveMode.set('walk');
        expect(fixture.componentInstance.dirty()).toBeFalse();
        expect(fixture.componentInstance.movementIndicator()).toEqual({ color: 'walk', letter: 'W4' });

        defenderModifier.set(2);
        expect(fixture.componentInstance.movementIndicator()).toEqual({ color: 'walk', letter: 'W2' });

        dirtyPhase.set(true);
        moveMode.set(null);
        expect(fixture.componentInstance.dirty()).toBeTrue();
        expect(fixture.componentInstance.movementIndicator()).toBeNull();
    });

    it('includes crew state and one aggregated NARC badge alongside unit conditions', () => {
        const forceUnit = Object.create(CBTForceUnit.prototype) as CBTForceUnit;
        const crewStates: CrewMemberState[] = ['stunned', 'stunned'];
        Object.assign(forceUnit, {
            getConditions: () => new Map([['jammed', undefined]]),
            getCrewMembers: () => crewStates.map(state => ({ getState: () => state })),
            getLocationCondition: (location: string, condition: string) =>
                condition === 'narc' && (location === 'LT' || location === 'RT'),
        });
        Object.defineProperty(forceUnit, 'getLocations', {
            value: () => ({ LT: {}, CT: {}, RT: {} }),
        });
        Object.defineProperty(forceUnit, 'rules', {
            value: {
                crewStateDefinition: (state: CrewMemberState): CrewStateDefinition | undefined =>
                    VEHICLE_CREW_STATE_DISPLAYS.find(definition => definition.key === state),
                locationConditionControls: [{ key: 'narc', label: 'NARC', color: '#f00', counted: true }],
            },
        });

        const fixture = TestBed.createComponent(UnitBlockComponent);
        fixture.componentRef.setInput('forceUnit', forceUnit);

        expect(fixture.componentInstance.activeConditions()).toEqual([
            { key: 'jammed', label: 'JAMMED', color: '#ff6be6' },
            { key: 'crew-stunned', label: 'STUNNED', color: '#ff5ce6' },
            { key: 'location-narc', label: 'NARC', color: '#f00' },
        ]);
    });

});
