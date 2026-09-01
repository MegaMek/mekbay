// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TestTankEntity } from '../models/entity/testing/test-entities';
import type { ScenarioRules } from '../models/runtime/unit-state-initializer';
import { asSourceHashCanary } from '../models/source-hash-canary';
import { NativeEntityService } from './native-entity.service';
import { CBTUnitService } from './cbt-unit.service';
import {
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog/unit-catalog.types';

describe('CBTUnitService source hash canary', () => {
    it('restores by UUID, warns without blocking, and adopts the current canary', async () => {
        const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
        const entity = new TestTankEntity();
        entity.uuid.set(uuid);
        entity.chassis.set('Vedette');
        entity.model.set('Medium Tank');
        let currentHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
        const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
        entities.load.and.callFake(async () => ({
            entity,
            source: {
                uuid,
                format: 'blk' as const,
                sourceHash: currentHash,
                file: makeUnitFileName(uuid, 'blk'),
                bytes: new ArrayBuffer(0),
            },
        }));
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                CBTUnitService,
                { provide: NativeEntityService, useValue: entities },
            ],
        });
        const service = TestBed.inject(CBTUnitService);
        const scenario: ScenarioRules = { id: 'megamek', ruleset: 'core-2026' };
        const created = await service.create({
            uuid,
            instanceId: 'unit:source-canary',
            deployment: { id: 'default' },
            scenario,
        });
        const saved = created.serialize();
        expect(saved.sourceHashCanary).toBe(asSourceHashCanary('AAAA'));

        currentHash = asSourceHash(`${'B'.repeat(26)}A`);
        const warn = jasmine.createSpy('warn');
        const restored = await service.restore(saved, scenario, warn);

        expect(restored.instanceId).toBe(saved.instanceId);
        expect(warn).toHaveBeenCalledOnceWith('Vedette Medium Tank');
        expect(restored.serialize().sourceHashCanary).toBe(asSourceHashCanary('BBBB'));
    });
});
