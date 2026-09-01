// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DialogsService } from '../services/dialogs.service';
import type { DataService } from '../services/data.service';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { ASForce } from './as-force.model';
import { GameSystem } from './common.model';
import type { ASSerializedForce } from './force-serialization';
import { asSourceHashCanary } from './source-hash-canary';

describe('ASForce source hash canary', () => {
    it('loads normally and names a unit whose source file changed', () => {
        const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showNotice']);
        dialogs.showNotice.and.resolveTo();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogsService, useValue: dialogs },
            ],
        });
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        const summary = createEmptyUnit({
            uuid,
            name: 'Atlas AS7-D',
            hash: 'BBBBBBBBBBBBBBBBBBBBBBBBBBA',
        });
        const data = {
            getUnitByUuid: () => summary,
            getFactionById: () => undefined,
            getEraById: () => undefined,
        } as unknown as DataService;
        const saved: ASSerializedForce = {
            version: 2,
            timestamp: '2026-09-01T00:00:00.000Z',
            instanceId: 'force:source-canary',
            type: GameSystem.AS,
            name: 'Source canary',
            groups: [{
                id: 'group:source-canary',
                units: [{
                    id: 'unit:source-canary',
                    uuid,
                    sourceHashCanary: asSourceHashCanary('AAAA'),
                }],
            }],
        };

        const force = ASForce.deserialize(saved, data, TestBed.inject(Injector));

        expect(force.units().length).toBe(1);
        expect(force.units()[0]!.getSummary()).toBe(summary);
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• Unit "Atlas AS7-D" source file has changed since this force was last used.',
            'Save Loaded with Warnings',
        );
    });
});
