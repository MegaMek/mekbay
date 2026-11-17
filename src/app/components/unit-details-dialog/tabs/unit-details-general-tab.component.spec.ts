// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    UnitDetailsGeneralTabComponent,
    getRulesRefBadgeGroups,
    getRulesRefBuckets,
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
import { NativeEntityService } from '../../../services/native-entity.service';
import { GameService } from '../../../services/game.service';
import { CustomUnitsService } from '../../../services/custom-units.service';
import { PlayerNamesService } from '../../../services/player-names.service';

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
                providers: [UnitNameService, DataService, DialogsService, LayoutService, OptionsService, GameService, NativeEntityService, CustomUnitsService, PlayerNamesService]
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
                [{ books: ['BMM', 'Core'], isBase: true }],
                [
                    { books: ['TM', 'TW'], isBase: true },
                    { books: ['TO:AUE'], isBase: false },
                ],
            ]);
        });

        it('sorts alternatives by book count and badges by type then name', () => {
            expect(getRulesRefBadgeGroups([
                ['ZZ', 'TW', 'AA'],
                ['IO:AE'],
            ])).toEqual([
                [{ books: ['IO:AE'], isBase: false }],
                [
                    { books: ['TW'], isBase: true },
                    { books: ['AA'], isBase: false },
                    { books: ['ZZ'], isBase: false },
                ],
            ]);
        });

        it('keeps base books joined by plus when the same bucket requires them together', () => {
            expect(getRulesRefBadgeGroups([['TW', 'TO:AUE', 'TM']])).toEqual([[
                { books: ['TM'], isBase: true },
                { books: ['TW'], isBase: true },
                { books: ['TO:AUE'], isBase: false },
            ]]);
        });

        it('factors shared base books before merging the remaining alternatives', () => {
            expect(getRulesRefBadgeGroups([
                ['BMM', 'TM', 'IO:AE'],
                ['BMM', 'TW', 'IO:AE'],
            ])).toEqual([[
                { books: ['BMM'], isBase: true },
                { books: ['TM', 'TW'], isBase: true },
                { books: ['IO:AE'], isBase: false },
            ]]);
        });
    });
});
