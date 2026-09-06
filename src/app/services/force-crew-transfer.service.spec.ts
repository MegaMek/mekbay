// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector } from '@angular/core';

import { ASForce } from '../models/as-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { CBTForce } from '../models/cbt-force.model';
import { CBTForceMember } from '../models/force-member.model';
import type { ForcePerson } from '../models/force-personnel';
import { CBTMekUnit } from '../models/runtime/cbt-mek-unit';
import { createDirectCommandConsoleRuntimeFixture } from '../models/runtime/testing/direct-mek-runtime-fixture';
import { CORE_2026_RULESET } from '../models/cbt-ruleset.model';
import { CBTUnitService } from './cbt-unit.service';
import { OptionsService } from './options.service';
import { LoggerService } from './logger.service';
import type { SerializedCBTForce } from '../models/force-serialization';
import type { SerializedCBTUnitV2 } from '../models/runtime/persistence-v2';
import { encodeForceForStorage } from '../models/runtime/force-storage-codec';
import { decodeRemoteLoadForceEntry } from '../models/remote-load-force-entry.model';
import { createEmptyUnit, createEmptyCBTForceForTest } from '../testing/unit-test-helpers';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import type { DataService } from './data.service';
import { ForceCrewTransferService } from './force-crew-transfer.service';
import { GameSystem } from '../models/common.model';

describe('ForceCrewTransferService cross-system conversion', () => {
    const service = new ForceCrewTransferService();

    it('saves current AS PV for projected lists after a pilot skill change', async () => {
        const unit = createAlphaStrikeUnit();
        const before = await unit.force.serializeForPersistence();
        unit.setPilotSkill(2);
        const saved = await unit.force.serializeForPersistence();
        expect(saved.pv).toBe(unit.force.totalBv());
        expect(saved.pv).not.toBe(before.pv);
        expect(decodeRemoteLoadForceEntry(encodeForceForStorage(saved)).pv).toBe(saved.pv);
    });

    it('copies a vacant AS unit without inventing a pilot or accumulating anonymous reserves', async () => {
        const source = createAlphaStrikeUnit();
        source.force.detachUnitCrew(source.id);
        const target = createAlphaStrikeUnit();
        await service.transferSameSystem(source, target, GameSystem.AS);
        expect(target.force.personnel().assignments).toEqual([]);
        expect(target.force.personnel().people).toEqual([]);
        expect(target.alias()).toBeUndefined();
    });

    it('copies unassigned personnel with new identities and preserves their personal facts', () => {
        const source = createAlphaStrikeUnit();
        const reserve = source.force.addUnassignedPerson({ name: 'Reserve', gunnery: 2, abilities: ['ace'],
            health: { wounds: 2, unconscious: false, ejected: false } })!;
        const target = createAlphaStrikeUnit();
        service.copyUnassignedPersonnel(source.force, target.force);
        const copied = target.force.personnel().people.find(person => person.name === 'Reserve')!;
        expect(copied.id).not.toBe(reserve.id);
        expect(copied.abilities).toEqual(['ace']);
        expect(copied.health?.wounds).toBe(2);
        expect(target.force.personnel().assignments.some(assignment => assignment.personId === copied.id)).toBeFalse();
    });

    it('uses a copied CBT reserve rating when that person is assigned to an AS unit', async () => {
        const source = await createClassicUnit([]);
        const reserve = source.force.addUnassignedPerson({ name: 'Reserve', gunnery: 3, piloting: 2 })!;
        const target = createAlphaStrikeUnit();
        service.copyUnassignedPersonnel(source.force, target.force);
        const copied = target.force.personnel().people.find(person => person.name === 'Reserve')!;

        expect(target.force.assignPersonToUnit(copied.id, target.id)).toBeTrue();
        expect(target.pilotSkill()).toBe(3);
        expect(target.pilot()!.piloting).toBe(2);
        expect(copied.id).not.toBe(reserve.id);
        expect(source.force.personnel().assignments).toEqual([]);
        expect(source.force.personnel().people[0]).toBe(reserve);
    });

    it('carries edited ratings across AS and CBT conversions without inactive skill copies', async () => {
        const source = createAlphaStrikeUnit();
        source.setPilotSkill(2);
        const classic = await createClassicUnit();
        await service.transferCrossSystem(source, classic, GameSystem.AS, GameSystem.CBT);
        const profile = classic.force.getUnitCrewProfile(classic.id)!;
        expect(await classic.force.replaceUnitCrewProfile(classic.id, profile.positions.map((position, index) =>
            index === 0 ? { ...position, gunnery: 0 } : position))).not.toBeNull();

        const alpha = createAlphaStrikeUnit();
        await service.transferCrossSystem(classic, alpha, GameSystem.CBT, GameSystem.AS);
        expect(alpha.pilotSkill()).toBe(0);
        alpha.setPilotSkill(8);
        const returned = await createClassicUnit();
        await service.transferCrossSystem(alpha, returned, GameSystem.AS, GameSystem.CBT);

        expect(returned.force.getUnitCrewProfile(returned.id)!.positions.map(position => position.gunnery)).toEqual([8, 8]);
        expect(returned.force.personnel().people.every(person => !('skill' in person))).toBeTrue();
        expect(source.pilotSkill()).toBe(2);
    });

    it('preserves AS personal facts while filling a CBT crew with the established skill conversion', async () => {
        const source = createAlphaStrikeUnit();
        source.force.updatePilotProfile(source, { name: 'Morgan Kell', gunnery: 2, piloting: 1, notes: 'Experienced', commander: true,
            abilities: [{ name: 'Custom', cost: 1.5, summary: 'Ability' }],
            health: { wounds: 2, unconscious: false, ejected: false } });
        const original = source.force.getAssignedPerson(source.id, 'pilot')!;
        const target = await createClassicUnit();
        await service.transferCrossSystem(source, target, GameSystem.AS, GameSystem.CBT);
        const crew = target.force.getUnitCrewProfile(target.id)!.positions;
        expect(crew.length).toBe(2);
        expect(crew.map(position => position.gunnery)).toEqual([2, 2]);
        expect(crew.map(position => position.name)).toEqual(['Morgan Kell', '']);
        const pilot = target.force.getAssignedPerson(target.id, crew[0].positionId)!;
        expect(pilot.id).not.toBe(original.id);
        expect(pilot.gunnery).toBe(2);
        expect(pilot.piloting).toBe(1);
        expect(pilot.notes).toBe('Experienced');
        expect(pilot.abilities).toEqual(original.abilities);
        expect(pilot.commander).toBeTrue();
        expect(target.force.isUnitCommander(target.id)).toBeTrue();
        expect(target.force.getUnitSnapshot(target.id)!.query.crewState(crew[0].positionId).wounds).toBe(2);
        expect(target.force.personnel().people.length).toBe(2);
    });

    it('swaps two occupied stations within one command-console crew without swapping only their labels', async () => {
        const unit = await createClassicUnit([
            { name: 'Pilot', piloting: 1, health: { wounds: 2, unconscious: false, ejected: false } },
            { name: 'Commander', piloting: 7, health: { wounds: 4, unconscious: true, ejected: false } },
        ]);
        const stations = unit.force.getUnitCrewProfile(unit.id)!.positions;
        const first = unit.force.getAssignedPerson(unit.id, stations[0].positionId)!;
        const second = unit.force.getAssignedPerson(unit.id, stations[1].positionId)!;
        expect(await unit.force.assignPersonToUnit(first.id, unit.id, stations[1].positionId)).toBeTrue();
        expect(unit.force.getAssignedPerson(unit.id, stations[0].positionId)!.id).toBe(second.id);
        expect(unit.force.getAssignedPerson(unit.id, stations[1].positionId)!.id).toBe(first.id);
        const query = unit.force.getUnitSnapshot(unit.id)!.query;
        expect(query.crewState(stations[0].positionId).wounds).toBe(4);
        expect(query.crewState(stations[1].positionId).wounds).toBe(2);
        expect(unit.force.getUnitCrewProfile(unit.id)!.positions.map(position => position.piloting)).toEqual([7, 1]);
    });

    it('keeps extra CBT occupants as AS reserves and preserves their skills, abilities, health and identity separation', async () => {
        const source = await createClassicUnit([
            { name: 'Natasha Kerensky', gunnery: 1, piloting: 2, commander: true, abilities: ['ace'] },
            { name: 'Second crew member', gunnery: 3, piloting: 4, abilities: ['marksman'],
                health: { wounds: 2, unconscious: true, ejected: false } },
        ]);
        const before = source.force.personnel();
        const target = createAlphaStrikeUnit();
        await service.transferCrossSystem(source, target, GameSystem.CBT, GameSystem.AS);
        expect(target.alias()).toBe('Natasha Kerensky');
        expect(target.pilotSkill()).toBe(1);
        expect(target.commander()).toBeTrue();
        const pilot = target.force.getAssignedPerson(target.id, 'pilot')!;
        expect(pilot.gunnery).toBe(1);
        expect(pilot.piloting).toBe(2);
        expect(pilot.abilities).toEqual(['ace']);
        const reserve = target.force.personnel().people.find(person => person.name === 'Second crew member')!;
        expect(reserve).toEqual(jasmine.objectContaining({ gunnery: 3, piloting: 4, abilities: ['marksman'] }));
        expect(reserve.health?.wounds).toBe(2);
        expect(reserve.health?.unconscious).toBeTrue();
        expect(target.force.personnel().assignments.some(assignment => assignment.personId === reserve.id)).toBeFalse();
        expect(target.force.personnel().people.every(person => !before.people.some(original => original.id === person.id))).toBeTrue();
        expect(source.force.personnel()).toBe(before);
    });

    it('copies partial CBT crew without anonymous reserves or unit gameplay damage', async () => {
        const source = await createClassicUnit([
            { name: 'Pilot', gunnery: 2, piloting: 3, abilities: ['ace'], health: { wounds: 1, unconscious: false, ejected: false } },
        ]);
        const sourceSnapshot = source.force.getUnitSnapshot(source.id)!;
        const faceId = [...sourceSnapshot.index.armorFaces.keys()][0]!;
        await source.force.dispatchMekUnitCommand(source.id, { type: 'damage-armor', faceId, amount: 1, target: 'committed' });
        const target = await createClassicUnit();
        const originalArmor = target.force.getUnitSnapshot(target.id)!.query.remainingArmor(faceId);
        await service.transferSameSystem(source, target, GameSystem.CBT);
        const crew = target.force.getUnitCrewProfile(target.id)!.positions;
        expect(crew.length).toBe(1);
        const person = target.force.getAssignedPerson(target.id, crew[0].positionId)!;
        expect(person).toEqual(jasmine.objectContaining({ name: 'Pilot', gunnery: 2, piloting: 3, abilities: ['ace'] }));
        expect(target.force.getUnitSnapshot(target.id)!.query.crewState(crew[0].positionId).wounds).toBe(1);
        expect(target.force.getUnitSnapshot(target.id)!.query.remainingArmor(faceId)).toBe(originalArmor);
        expect(target.force.personnel().people.length).toBe(1);
    });

    it('does not allocate people when preparing a detached AS replacement', async () => {
        const source = createAlphaStrikeUnit();
        const target = createAlphaStrikeUnit();
        const candidate = target.force.createCompatibleUnit(target.getSummary());
        const before = target.force.personnel();
        await service.transferSameSystem(source, candidate, GameSystem.AS);
        expect(target.force.personnel()).toBe(before);
    });

});

function createAlphaStrikeUnit(): ASForceUnit {
    const injector = Injector.create({
        providers: [{ provide: AsAbilityLookupService, useValue: {} }],
    });
    const dataService = {} as DataService;
    const force = new ASForce('Test force', dataService, injector);
    return force.addUnit(createEmptyUnit({
        type: 'Mek',
        subtype: 'BattleMek',
        as: { TP: 'BM', PV: 20 },
    }));
}

async function createClassicUnit(profiles?: readonly Omit<ForcePerson, 'id'>[]): Promise<CBTForceMember> {
    const fixture = createDirectCommandConsoleRuntimeFixture();
    const instanceId = 'unit:conversion';
    const initialize = { initializerRevision: 1, profileId: 'pristine', deployment: { id: 'default' },
        scenario: { id: 'megamek', ruleset: CORE_2026_RULESET } };
    const ready = await CBTMekUnit.createFromEntity({ uuid: fixture.identity, instanceId }, fixture.entity, fixture.identity, initialize);
    const unit = ready.serialize();
    const cbt = createEmptyCBTForceForTest('force:conversion');
    const record: SerializedCBTForce = { version: 2, instanceId: cbt.forceId, timestamp: '2026-01-01T00:00:00.000Z',
        name: 'Conversion', type: GameSystem.CBT, cbt: { ...cbt,
            units: [{ instanceId, stateRevision: unit.stateRevision, unit }],
            roster: { schemaVersion: 1, groups: [{ groupId: 'group:conversion', order: 0, members: [{ instanceId, order: 0 }] }] },
        } };
    const data = { getFactionById: () => null, getEraById: () => null,
        getUnitByUuid: () => createEmptyUnit({ uuid: fixture.identity }) } as unknown as DataService;
    const units = { restore: async (saved: SerializedCBTUnitV2) => ({
        unit: await CBTMekUnit.restoreFromEntity(saved, fixture.entity, fixture.identity, initialize), warnings: [],
    }) };
    const injector = { get: (token: unknown) => token === CBTUnitService ? units
        : token === OptionsService ? { options: () => ({ CBTRules: CORE_2026_RULESET, CBTOptionalRules: {} }) }
        : jasmine.createSpyObj<LoggerService>('Logger', ['error', 'warn']) } as unknown as Injector;
    const force = await CBTForce.deserialize(record, data, injector);
    if (profiles) {
        const stations = force.getUnitCrewProfile(instanceId)!.positions;
        if (!await force.replaceCopiedUnitPersonnel(instanceId, profiles.map((profile, index) => ({
            positionId: stations[index].positionId, profile,
        })))) throw new Error('Could not install fixture crew');
    }
    return force.getCBTMember(instanceId)!;
}
