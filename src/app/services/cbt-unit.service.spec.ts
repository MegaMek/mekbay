// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OptionsService } from './options.service';

import { TestTankEntity } from '../models/entity/testing/test-entities';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { EntityMountedEquipment } from '../models/entity/types';
import { MiscEquipment, WeaponEquipment } from '../models/equipment.model';
import { asComponentId } from '../models/entity/entity-identifiers';
import { isCBTMekUnit } from '../models/runtime/cbt-unit';
import { createDirectMekRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import type { ScenarioRules } from '../models/runtime/unit-state-initializer';
import { nativeSourceHashCanary } from '../models/source-hash-canary';
import { CBTUnitService } from './cbt-unit.service';
import { NativeEntityService } from './native-entity.service';
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
        let source = '<name>\nVedette\n</name>\n';
        const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
        entities.load.and.callFake(async () => ({
            entity,
            source: {
                uuid,
                format: 'blk' as const,
                sourceHash: currentHash,
                file: makeUnitFileName(uuid, 'blk'),
                bytes: new TextEncoder().encode(source).buffer,
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
        expect(saved.sourceHashCanary).toBe(await nativeSourceHashCanary(source, 'blk'));

        currentHash = asSourceHash(`${'B'.repeat(26)}A`);
        source = '# changed comment\n<generator>\nNew version\n</generator>\n' + source;
        expect((await service.restore(saved, scenario)).warnings).toEqual([]);
        source += '<armor>\n30\n</armor>\n';
        const restored = await service.restore(saved, scenario);

        expect(restored.unit.instanceId).toBe(saved.instanceId);
        expect(restored.warnings).toEqual([{
            unitName: 'Vedette Medium Tank',
            code: 'SOURCE_REVISION_CHANGED',
            message: 'The source file has changed since this unit state was saved, so its equipment state was reset.',
        }]);
        expect(restored.unit.serialize().sourceHashCanary).toBe(await nativeSourceHashCanary(source, 'blk'));
    });

    it('drops equipment-keyed state once the source has changed and keeps location-keyed state', async () => {
        // A changed file can renumber mount IDs, so a destroyed component must not reappear on other equipment.
        const searchlight = new MiscEquipment({ id: 'TestSearchlight', name: 'Searchlight', type: 'misc', flags: [] });
        const tank = new TestTankEntity(createTestEquipmentRegistry({ [searchlight.id]: searchlight }));
        tank.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'));
        tank.setTonnage(20);
        tank.setEquipment([new EntityMountedEquipment({
            mountId: 'm1', equipmentId: searchlight.id, equipment: searchlight, allocation: { kind: 'location', location: 'Front' },
            rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
        })]);
        const mek = createDirectMekRuntimeFixture();
        const weapon = [...mek.index.components.values()].find(component => component.kind === 'equipment'
            && component.mount.equipment instanceof WeaponEquipment)!.id;
        const weaponSlot = [...mek.index.slots.values()].find(slot => slot.componentIds.includes(weapon))!.id;
        for (const [entity, format, componentId] of [[tank, 'blk', 'm1'], [mek.entity, 'mtf', weapon]] as const) {
            let source = format === 'blk' ? '<name>\nVedette\n</name>\n' : 'chassis:Test Mek\nMass:50\n';
            const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
            entities.load.and.callFake(async () => ({
                entity,
                source: {
                    uuid: entity.uuid(), format, sourceHash: asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA'),
                    file: makeUnitFileName(entity.uuid(), format), bytes: new TextEncoder().encode(source).buffer,
                },
            }));
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [
                provideZonelessChangeDetection(), CBTUnitService, { provide: NativeEntityService, useValue: entities },
                { provide: OptionsService, useValue: { options: () => ({ displayUnitNameFormat: 'innerSphereClan' }) } },
            ] });
            const service = TestBed.inject(CBTUnitService);
            const scenario: ScenarioRules = { id: 'megamek', ruleset: 'core-2026' };
            const created = await service.create({ uuid: entity.uuid(), instanceId: `unit:${format}-reset`, deployment: { id: 'default' }, scenario });
            const locationId = [...created.getIndex().locations.keys()][0]!;
            expect(created.dispatch({ type: 'damage-internal', locationId, amount: 1, target: 'committed' }).accepted).toBeTrue();
            expect(created.dispatch({ type: 'set-component-status', componentId: asComponentId(componentId), status: 'destroyed',
                target: 'committed' }).accepted).toBeTrue();
            // A pending critical hit's rolled dice pick a slot; the hits it still owes belong to the location.
            const owed = Object.freeze({ type: 'critical-hit' as const, eventId: 'critical:owed', locationId,
                target: 'committed' as const, remainingHits: 2, caseIIDiscards: [false, false] });
            if (format === 'mtf' && isCBTMekUnit(created)) {
                expect(created.dispatch({ type: 'hit-critical', slotId: weaponSlot, hits: 1, target: 'committed' }).accepted).toBeTrue();
                // A gyro hit's pilot check names its slot; a kick's names no equipment.
                const gyro = [...mek.index.slots.values()].find(slot => slot.componentIds.some(id => {
                    const component = mek.index.components.get(id);
                    return component?.kind === 'system' && component.systemType === 'Gyro';
                }))!;
                expect(created.dispatch({ type: 'hit-critical', slotId: gyro.id, hits: 1, target: 'committed' }).accepted).toBeTrue();
                expect(created.dispatch({ type: 'record-mek-physical-attack-checks', attackId: 'attack:kick',
                    checks: ['kicked'] }).accepted).toBeTrue();
                expect(created.query().mekPilotChecks().map(check => check.source.triggerKind).sort())
                    .toEqual(['gyro-hit', 'kicked']);
                expect(created.dispatch({ type: 'replace-turn-state', turn: { ...created.snapshot().turn,
                    pendingCriticalEvents: [{ ...owed, roll: [3, 4] }] } }).accepted).toBeTrue();
            }
            const saved = created.serialize();
            expect(saved.componentState?.length).toBe(1);
            expect(saved.locationState?.length).toBe(1);

            // An unchanged source drops nothing.
            const unchanged = await service.restore(saved, scenario);
            expect(unchanged.warnings).toEqual([]);
            expect(unchanged.unit.serialize()).toEqual(saved);

            source += format === 'blk' ? '<armor>\n30\n</armor>\n' : 'armor:Standard(Inner Sphere)\n';
            const restored = await service.restore(saved, scenario);
            const reset = restored.unit.serialize();
            expect(reset.componentState).toBeUndefined();
            if (format === 'mtf') expect((reset as typeof saved & { slotState?: unknown }).slotState).toBeUndefined();
            expect(reset.locationState).toEqual(saved.locationState);
            if (format === 'mtf' && isCBTMekUnit(restored.unit)) {
                expect(restored.unit.query().mekPilotChecks().map(check => check.source.triggerKind))
                    .toEqual(['kicked']);
                expect(restored.unit.snapshot().turn.pendingCriticalEvents).toEqual([owed]);
            }
            expect(restored.warnings.map(warning => warning.message)).toEqual([
                'The source file has changed since this unit state was saved, so its equipment state was reset.',
            ]);
        }
    });

    it('drops a pending autocannon hit once the source has changed, so it never moves to another gun', async () => {
        const autocannon = new WeaponEquipment({ id: 'TestSourceAC5', name: 'AC/5', type: 'weapon',
            flags: ['F_AC', 'F_BALLISTIC', 'F_DIRECT_FIRE'], weapon: { ammoType: 'AC', rackSize: 5, damage: 5, ranges: [3, 6, 12, 18] } });
        const tank = new TestTankEntity(createTestEquipmentRegistry({ [autocannon.id]: autocannon }));
        tank.uuid.set(asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e4'));
        tank.setTonnage(20);
        tank.setEquipment([new EntityMountedEquipment({
            mountId: 'm1', equipmentId: autocannon.id, equipment: autocannon, allocation: { kind: 'location', location: 'Front' },
            rearMounted: false, turretMounted: false, omniPodMounted: false, armored: false,
        })]);
        let source = '<name>\nVedette\n</name>\n';
        const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
        entities.load.and.callFake(async () => ({
            entity: tank,
            source: {
                uuid: tank.uuid(), format: 'blk', sourceHash: asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA'),
                file: makeUnitFileName(tank.uuid(), 'blk'), bytes: new TextEncoder().encode(source).buffer,
            },
        }));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(), CBTUnitService, { provide: NativeEntityService, useValue: entities },
            { provide: OptionsService, useValue: { options: () => ({ displayUnitNameFormat: 'innerSphereClan' }) } },
        ] });
        const service = TestBed.inject(CBTUnitService);
        const scenario: ScenarioRules = { id: 'megamek', ruleset: 'core-2026' };
        const created = await service.create({ uuid: tank.uuid(), instanceId: 'unit:ac-reset', deployment: { id: 'default' }, scenario });
        expect(created.dispatch({ type: 'hit-components', componentIds: [asComponentId('m1')], target: 'pending' })
            .changed).toBeTrue();
        const saved = created.serialize();
        expect((await service.restore(saved, scenario)).unit.serialize()).toEqual(saved);
        source += '<armor>\n30\n</armor>\n';
        expect((await service.restore(saved, scenario)).unit.serialize().pendingCombat).toBeUndefined();
    });

    it('returns the common source warning alongside Mek codec warnings', async () => {
        const fixture = createDirectMekRuntimeFixture();
        let currentHash = asSourceHash('AAAAAAAAAAAAAAAAAAAAAAAAAAA');
        let source = 'chassis:Test Mek\nMass:50\n';
        const entities = jasmine.createSpyObj<NativeEntityService>('NativeEntityService', ['load']);
        entities.load.and.callFake(async () => ({
            entity: fixture.entity,
            source: {
                uuid: fixture.identity,
                format: 'mtf' as const,
                sourceHash: currentHash,
                file: makeUnitFileName(fixture.identity, 'mtf'),
                bytes: new TextEncoder().encode(source).buffer,
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
        source = source.replace('50', '55');

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
                message: 'The source file has changed since this unit state was saved, so its equipment state was reset.',
            },
        ]);
        expect(restored.unit.serialize().sourceHashCanary).toBe(await nativeSourceHashCanary(source, 'mtf'));
        expect('ruleset' in restored.unit.serialize().baselineRefAtSave).toBeFalse();
        expect(isCBTMekUnit(restored.unit)).toBeTrue();
        if (isCBTMekUnit(restored.unit)) {
            expect(restored.unit.ruleset()).toBe('total-warfare');
        }
    });
});
