// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    UnitDetailsGeneralTabComponent,
    getRulesRefBadgeGroups,
    getRulesRefBuckets,
    shouldShowAdjustedPilotSkills
} from './unit-details-general-tab.component';
import { TestBed } from '@angular/core/testing';
import { CBTForceMember } from '../../../models/force-member.model';
import type { CBTForce } from '../../../models/cbt-force.model';
import type { UnitSummary } from '../../../models/unit-summary.model';
import { createDirectMekRuntimeFixture } from '../../../models/runtime/testing/direct-mek-runtime-fixture';
import { buildUnitComponentMetadata } from '../../../utils/unit-component-metadata-builder';
import { UnitNameService } from '../../../services/unit-name.service';
import { DataService } from '../../../services/data.service';
import { DialogsService } from '../../../services/dialogs.service';
import { LayoutService } from '../../../services/layout.service';
import { OptionsService } from '../../../services/options.service';
import { GameService } from '../../../services/game.service';

describe('UnitDetailsGeneralTabComponent', () => {
    describe('equipment condition', () => {
        it('always shows current ammo and damage for a force member, and pristine catalog components otherwise', () => {
            const { instance, entity, index, equipmentComponent } = createDirectMekRuntimeFixture();
            const force = {
                getMekRecordSheetSnapshot: () => instance.captureRuntime(),
                getUnitSnapshot: () => ({
                    ...instance.captureRuntime(), entity, ruleset: instance.ruleset(),
                }),
            } as unknown as CBTForce;
            const member = new CBTForceMember(instance.instanceId, force, entity);
            TestBed.configureTestingModule({
                providers: [UnitNameService, DataService, DialogsService, LayoutService, OptionsService, GameService]
                    .map(provide => ({ provide, useValue: {} })),
            });
            TestBed.overrideComponent(UnitDetailsGeneralTabComponent, { set: { template: '', imports: [] } });
            const fixture = TestBed.createComponent(UnitDetailsGeneralTabComponent);
            const tab = fixture.componentInstance;
            const summary = { comp: buildUnitComponentMetadata(entity) } as UnitSummary;
            fixture.componentRef.setInput('unit', summary);
            expect(tab.conditionComponents()).toBe(summary.comp);
            fixture.componentRef.setInput('forceMember', member);

            const ammo = equipmentComponent('Test Ammo');
            instance.dispatch({ type: 'configure-ammo-source', componentId: ammo.id, munitionKey: 'Test Ammo', remaining: 3 });
            member.bindRuntime(instance, instance.revision());
            expect(tab.conditionComponents().find(component => component.id === 'Test Ammo')?.q2).toBe(3);

            const face = [...index.armorFaces.values()].find(face => face.maximumPoints > 0)!;
            instance.dispatch({ type: 'damage-armor', faceId: face.id, amount: 1, target: 'pending' });
            member.bindRuntime(instance, instance.revision());
            expect(tab.conditionComponents().some(component => component.destroyed)).toBeFalse();

            const laser = equipmentComponent('ISMediumLaser');
            instance.dispatch({ type: 'set-component-status', componentId: laser.id, status: 'destroyed', target: 'pending' });
            member.bindRuntime(instance, instance.revision());
            expect(tab.conditionComponents().some(component => component.id === 'ISMediumLaser' && component.destroyed)).toBeTrue();

            instance.dispatch({ type: 'set-component-status', componentId: laser.id, status: 'available', target: 'pending' });
            instance.dispatch({ type: 'repair-armor', faceId: face.id, amount: 1, target: 'pending' });
            member.bindRuntime(instance, instance.revision());
            expect(tab.conditionComponents().some(component => component.destroyed)).toBeFalse();
            fixture.componentRef.setInput('forceMember', new CBTForceMember('other', force, entity));
            expect(tab.conditionComponents().find(component => component.id === 'Test Ammo')?.q2).toBe(3);
            fixture.componentRef.setInput('forceMember', undefined);
            expect(tab.conditionComponents()).toBe(summary.comp);
        });
    });

    describe('getRulesRefBuckets', () => {
        it('preserves alternative buckets and their book order', () => {
            expect(getRulesRefBuckets([['Core'], ['TW', 'IO:AUE']]))
                .toEqual([['Core'], ['TW', 'IO:AUE']]);
        });

        it('removes duplicate and empty references and buckets', () => {
            expect(getRulesRefBuckets([['Core', 'Core', ''], [], ['TW']]))
                .toEqual([['Core'], ['TW']]);
        });

        it('accepts the previous flat data form as one bucket', () => {
            expect(getRulesRefBuckets(['Core', 'IO:AUE']))
                .toEqual([['Core', 'IO:AUE']]);
        });
    });

    describe('getRulesRefBadgeGroups', () => {
        it('groups base alternatives with identical non-base requirements', () => {
            expect(getRulesRefBadgeGroups([
                ['TO:AUE', 'TW'],
                ['Core'],
                ['BMM'],
                ['TM', 'TO:AUE'],
            ])).toEqual([
                [{ label: 'BMM/Core', isBase: true }],
                [
                    { label: 'TM/TW', isBase: true },
                    { label: 'TO:AUE', isBase: false },
                ],
            ]);
        });

        it('sorts alternatives by book count and badges by type then name', () => {
            expect(getRulesRefBadgeGroups([
                ['ZZ', 'TW', 'AA'],
                ['IO:AE'],
            ])).toEqual([
                [{ label: 'IO:AE', isBase: false }],
                [
                    { label: 'TW', isBase: true },
                    { label: 'AA', isBase: false },
                    { label: 'ZZ', isBase: false },
                ],
            ]);
        });

        it('keeps base books joined by plus when the same bucket requires them together', () => {
            expect(getRulesRefBadgeGroups([['TW', 'TO:AUE', 'TM']])).toEqual([[
                { label: 'TM', isBase: true },
                { label: 'TW', isBase: true },
                { label: 'TO:AUE', isBase: false },
            ]]);
        });

        it('factors shared base books before merging the remaining alternatives', () => {
            expect(getRulesRefBadgeGroups([
                ['BMM', 'TM', 'IO:AE'],
                ['BMM', 'TW', 'IO:AE'],
            ])).toEqual([[
                { label: 'BMM', isBase: true },
                { label: 'TM/TW', isBase: true },
                { label: 'IO:AE', isBase: false },
            ]]);
        });
    });

    describe('shouldShowAdjustedPilotSkills', () => {
        it('shows skills when adjusted BV differs from base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, 4)).toBeTrue();
        });

        it('hides skills when adjusted BV equals base BV', () => {
            expect(shouldShowAdjustedPilotSkills(1000, 1000, 4, 5)).toBeFalse();
        });

        it('hides skills when BV or skill data is unavailable or invalid', () => {
            expect(shouldShowAdjustedPilotSkills(null, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(Number.NaN, 1000, 3, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, undefined, 4)).toBeFalse();
            expect(shouldShowAdjustedPilotSkills(1200, 1000, 3, undefined)).toBeFalse();
        });
    });
});
