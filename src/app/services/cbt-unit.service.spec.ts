// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { OptionsService } from './options.service';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TestTankEntity } from '../models/entity/testing/test-entities';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { ScenarioRules } from '../models/runtime/unit-state-initializer';
import { asSourceHashCanary } from '../models/source-hash-canary';
import { NativeEntityService } from './native-entity.service';
import { CBTUnitService } from './cbt-unit.service';
import { isCBTMekUnit } from '../models/runtime/cbt-unit';
import {
    asSourceHash,
    asUnitUuid,
    makeUnitFileName,
} from './unit-catalog/unit-catalog.types';

describe('CBTUnitService restore warnings', () => {
    beforeEach(() => TestBed.configureTestingModule({
        providers: [{ provide: OptionsService, useValue: { options: () => ({ displayUnitNameFormat: 'innerSphereClan' }) } }],
    }));
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
        const restored = await service.restore(saved, scenario);

        expect(restored.unit.instanceId).toBe(saved.instanceId);
        expect(restored.warnings).toEqual([{
            unitName: 'Vedette Medium Tank',
            code: 'SOURCE_REVISION_CHANGED',
            message: 'The source file has changed since this unit state was saved.',
        }]);
        expect(restored.unit.serialize().sourceHashCanary).toBe(asSourceHashCanary('BBBB'));
    });

    it('returns the common source warning alongside Mek codec warnings', async () => {
        const fixture = createDirectMekRuntimeFixture();
        let currentHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
        const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
        entities.load.and.callFake(async () => ({
            entity: fixture.entity,
            source: {
                uuid: fixture.identity,
                format: 'mtf' as const,
                sourceHash: currentHash,
                file: makeUnitFileName(fixture.identity, 'mtf'),
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
        const savedScenario: ScenarioRules = { id: 'megamek', ruleset: 'core-2026' };
        const created = await service.create({
            uuid: fixture.identity,
            instanceId: 'unit:mek-restore-warnings',
            deployment: { id: 'default' },
            scenario: savedScenario,
        });
        const saved = created.serialize();
        currentHash = asSourceHash(`${'B'.repeat(26)}A`);

        const restored = await service.restore(
            saved,
            { id: 'megamek', ruleset: 'total-warfare' },
        );

        const unitName = fixture.entity.displayName();
        expect(restored.unit.instanceId).toBe(saved.instanceId);
        expect(restored.warnings).toEqual([
            {
                unitName,
                code: 'SOURCE_REVISION_CHANGED',
                message: 'The source file has changed since this unit state was saved.',
            },
        ]);
        expect(restored.unit.serialize().sourceHashCanary).toBe(asSourceHashCanary('BBBB'));
        expect('ruleset' in restored.unit.serialize().baselineRefAtSave).toBeFalse();
        expect(isCBTMekUnit(restored.unit)).toBeTrue();
        if (isCBTMekUnit(restored.unit)) {
            expect(restored.unit.getInstance().ruleset()).toBe('total-warfare');
        }
    });
});
