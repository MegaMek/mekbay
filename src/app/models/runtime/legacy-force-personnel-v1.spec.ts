// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ASForce } from '../as-force.model';
import { CBTForce } from '../cbt-force.model';
import { CORE_2026_RULESET } from '../cbt-ruleset.model';
import { GameSystem } from '../common.model';
import type { ASSerializedForce, SerializedCBTForce, SerializedForce } from '../force-serialization';
import type { JsonObject } from '../persisted-unit-state';
import type { DataService } from '../../services/data.service';
import { CBTUnitService } from '../../services/cbt-unit.service';
import { OptionsService } from '../../services/options.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { CBTMekUnit } from './cbt-mek-unit';
import { convertPersistedForceV1, type PersistedForceV1ConversionWarning } from './legacy-force-v1-converter';
import { decodeForceFromStorage, encodeForceForStorage } from './force-storage-codec';
import type { StoredForceV2 } from './force-storage.model';
import type { SerializedCBTUnitV2 } from './persistence-v2';
import { createDirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';

describe('V1 personnel admission through current force storage', () => {
    const scenario = { id: 'megamek', ruleset: CORE_2026_RULESET } as const;

    function legacyForce(type: GameSystem, unit: JsonObject): SerializedForce {
        return {
            version: 1, timestamp: '2026-09-05T00:00:00.000Z', type,
            instanceId: 'force:v1-people', name: 'Personnel',
            groups: [{ id: 'group:v1-people', units: [{ id: 'unit:v1-people', unit: 'Test Mek', ...unit }] }],
        } as unknown as SerializedForce;
    }

    it('imports an AS pilot once and retains the identity and profile after saving and reopening', async () => {
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
        const injector = TestBed.inject(Injector);
        const summary = createEmptyUnit({ name: 'Test Mek', as: { PV: 30 } });
        const data = { getUnitByUuid: () => summary, getFactionById: () => null, getEraById: () => null } as unknown as DataService;
        const source = legacyForce(GameSystem.AS, {
            alias: 'Alex', skill: 2, commander: true,
            abilities: [{ name: 'Custom', cost: 0.5, summary: 'Description' }],
            state: { armor: [1, 2], internal: [0, 1], heat: [1, 0] },
        });
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            scenario, resolveIdentity: () => ({ kind: 'resolved', uuid: summary.uuid }),
            onWarning: warning => warnings.push(warning),
        });
        expect(converted.personnel).toBeUndefined();
        const force = ASForce.deserialize(converted as ASSerializedForce, data, injector);
        const personId = force.units()[0].pilot()!.id;
        const saved = await force.serializeForPersistence();
        const stored = encodeForceForStorage(saved);
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const reloaded = ASForce.deserialize(decoded as ASSerializedForce, data, injector);

        expect(warnings).toEqual([]);
        expect(reloaded.personnel()).toEqual(force.personnel());
        expect(reloaded.units()[0].pilot()!.id).toBe(personId);
        expect(reloaded.units()[0].alias()).toBe('Alex');
        expect(reloaded.units()[0].pilotSkill()).toBe(2);
        expect(reloaded.units()[0].pilot()!.gunnery).toBe(2);
        const storedPerson = (stored as unknown as StoredForceV2).units[0].crew![0]!;
        expect(storedPerson).toEqual(jasmine.objectContaining({ g: 2 }));
        expect('skill' in storedPerson).toBeFalse();
        expect('role' in storedPerson).toBeFalse();
        expect(reloaded.units()[0].commander()).toBeTrue();
        expect(reloaded.units()[0].manualPilotAbilities()).toEqual([{ name: 'Custom', cost: 0.5, summary: 'Description' }]);
        expect(reloaded.units()[0].serialize().state).toEqual(force.units()[0].serialize().state);
        expect(JSON.stringify(stored)).not.toMatch(/"(?:payload|unresolved|recoveryId)"/u);
    });

    it('imports CBT crew once and preserves person identity, skills and wounds after reopening', async () => {
        const fixture = createDirectMekRuntimeFixture(CORE_2026_RULESET, 'unit:v1-people');
        const initialize = { initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' }, scenario };
        const summary = createEmptyUnit({ name: 'Test Mek', uuid: fixture.identity });
        const data = { getUnitByUuid: () => summary, getFactionById: () => null, getEraById: () => null } as unknown as DataService;
        const cbtUnits = {
            restore: async (saved: SerializedCBTUnitV2) => ({
                unit: await CBTMekUnit.restoreFromEntity(saved, fixture.entity, fixture.identity, initialize),
                warnings: [],
            }),
        };
        TestBed.configureTestingModule({ providers: [
            provideZonelessChangeDetection(),
            { provide: CBTUnitService, useValue: cbtUnits },
            { provide: OptionsService, useValue: { options: () => ({ CBTRules: CORE_2026_RULESET, CBTOptionalRules: {} }) } },
        ] });
        const injector = TestBed.inject(Injector);
        const source = legacyForce(GameSystem.CBT, {
            commander: true,
            state: { crew: [{ id: 0, name: 'Alex', gunnerySkill: 3, pilotingSkill: 4, hits: 2, state: 0 }] },
        });
        const warnings: PersistedForceV1ConversionWarning[] = [];
        const converted = await convertPersistedForceV1(source, {
            scenario,
            resolveIdentity: () => ({ kind: 'resolved', uuid: fixture.identity }),
            materializeUnit: request => CBTMekUnit.createFromEntity({ uuid: fixture.identity, instanceId: request.instanceId },
                fixture.entity, fixture.identity, { ...initialize, deployment: request.deployment }),
            onWarning: warning => warnings.push(warning),
        });
        expect(converted.personnel).toBeUndefined();
        const force = await CBTForce.deserialize(converted as SerializedCBTForce, data, injector);
        const assignment = force.personnel().assignments[0];
        const person = force.getAssignedPerson(assignment.unitId, assignment.positionId)!;
        const stored = encodeForceForStorage(await force.serializeForPersistence());
        const decoded = decodeForceFromStorage(JSON.parse(JSON.stringify(stored)));
        const reloaded = await CBTForce.deserialize(decoded as SerializedCBTForce, data, injector);

        expect(warnings).toEqual([]);
        expect(reloaded.personnel()).toEqual(force.personnel());
        expect(reloaded.getAssignedPerson(assignment.unitId, assignment.positionId)!.id).toBe(person.id);
        expect(person).toEqual(jasmine.objectContaining({ name: 'Alex', gunnery: 3, piloting: 4, commander: true }));
        expect(reloaded.getUnitCrewProfile(assignment.unitId)).toEqual(force.getUnitCrewProfile(assignment.unitId));
        const reserialized = await reloaded.serializeForPersistence();
        expect((reserialized.cbt!.units[0].unit as SerializedCBTUnitV2).crew.positions[0].wounds).toBe(2);
        expect(JSON.stringify(stored)).not.toMatch(/"(?:payload|unresolved|recoveryId)"/u);
    });
});
