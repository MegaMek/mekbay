// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Overlay } from '@angular/cdk/overlay';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForceUnit } from '../../models/cbt-force-unit.model';
import type { CrewMemberState } from '../../models/crew-member.model';
import type { CrewStateDefinition } from '../../models/rules/unit-type-rules';
import { VEHICLE_CREW_STATE_DISPLAYS } from '../../models/rules/vehicle-rules';
import { OptionsService } from '../../services/options.service';
import { SpriteStorageService } from '../../services/sprite-storage.service';
import { UnitBlockComponent } from './unit-block.component';

describe('UnitBlockComponent', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [UnitBlockComponent],
            providers: [
                provideZonelessChangeDetection(),
                {
                    provide: OptionsService,
                    useValue: { options: () => ({ trackPhaseAndTurn: true, unitDisplayName: 'chassisModel' }) },
                },
                { provide: Overlay, useValue: {} },
                {
                    provide: SpriteStorageService,
                    useValue: { loading: signal(false) },
                },
            ],
        });
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
