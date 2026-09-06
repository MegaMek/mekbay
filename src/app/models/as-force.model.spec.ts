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

    it('skips unavailable catalog units and reports the count after loading', () => {
        const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['showNotice']);
        dialogs.showNotice.and.resolveTo();
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogsService, useValue: dialogs },
            ],
        });
        const saved: ASSerializedForce = {
            version: 2,
            timestamp: '2026-09-01T00:00:00.000Z',
            instanceId: 'force:missing-as-units',
            type: GameSystem.AS,
            name: 'Missing AS units',
            personnel: {
                people: [{ id: 'person:missing-unit', name: 'Alex' }],
                assignments: [{ unitId: 'unit:missing-as-one', positionId: 'pilot', personId: 'person:missing-unit' }],
            },
            groups: [{
                id: 'group:missing-as-units',
                units: [
                    {
                        id: 'unit:missing-as-one',
                        uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1'),
                    },
                    {
                        id: 'unit:missing-as-two',
                        uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2'),
                    },
                ],
            }],
        };
        const data = {
            getUnitByUuid: () => undefined,
            getFactionById: () => undefined,
            getEraById: () => undefined,
        } as unknown as DataService;

        const force = ASForce.deserialize(saved, data, TestBed.inject(Injector));

        expect(force.units()).toEqual([]);
        expect(force.personnel()).toEqual({
            people: [{ id: 'person:missing-unit', name: 'Alex' }],
            assignments: [],
        });
        expect(dialogs.showNotice).toHaveBeenCalledOnceWith(
            '• 2 units were not found in the catalog and were skipped.',
            'Save Loaded with Warnings',
        );
    });
});

describe('ASForce personnel ownership', () => {
    let injector: Injector;
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e1');
    const summary = createEmptyUnit({ uuid, name: 'Atlas AS7-D' });
    const data = {
        getUnitByUuid: () => summary,
        getFactionById: () => undefined,
        getEraById: () => undefined,
    } as unknown as DataService;

    beforeEach(() => {
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
        injector = TestBed.inject(Injector);
    });

    function savedForce(): ASSerializedForce {
        return {
            version: 2, timestamp: '2026-09-05T00:00:00.000Z', type: GameSystem.AS,
            instanceId: 'force:personnel', name: 'Personnel',
            groups: [{ id: 'group:personnel', units: [{ id: 'unit:personnel', uuid }] }],
        };
    }

    it('creates a pilot once at admission and saves personal facts only with that person', () => {
        const force = new ASForce('Personnel', data, injector);
        const unit = force.addUnit(summary);
        const personId = unit.pilot()!.id;
        unit.setPilotName('Alex');
        unit.setPilotSkill(3);
        unit.setPilotAbilities([{ name: 'Custom', cost: 0.5, summary: 'Description' }]);
        unit.setFormationCommander(true);
        unit.setFormationAbilities(['group-bonus']);

        expect(force.personnel().people).toEqual([{
            id: personId, name: 'Alex', gunnery: 3, commander: true,
            abilities: [{ name: 'Custom', cost: 0.5, summary: 'Description' }],
        }]);
        const serializedUnit = unit.serialize();
        expect(serializedUnit.alias).toBeUndefined();
        expect(serializedUnit.skill).toBeUndefined();
        expect(serializedUnit.abilities).toBeUndefined();
        expect(serializedUnit.commander).toBeUndefined();
        expect(serializedUnit.formationAbilities).toEqual(['group-bonus']);
        expect(force.serialize().personnel).toEqual(force.personnel());
        expect(force.serialize().personnel!.people[0].id).toBe(personId);
    });

    it('imports embedded pilot fields once when the ingress has no personnel snapshot', () => {
        const saved = savedForce();
        Object.assign(saved.groups[0].units[0], { alias: 'Alex', skill: 2, commander: true, abilities: ['hot_dog'] });
        const force = ASForce.deserialize(saved, data, injector);
        const unit = force.units()[0];
        const personId = unit.pilot()!.id;

        expect(unit.alias()).toBe('Alex');
        expect(unit.pilotSkill()).toBe(2);
        expect(unit.manualPilotAbilities()).toEqual(['hot_dog']);
        expect(unit.commander()).toBeTrue();
        const loaded = ASForce.deserialize(force.serialize() as ASSerializedForce, data, injector);
        expect(loaded.units()[0].pilot()!.id).toBe(personId);
        expect(loaded.units()[0].alias()).toBe('Alex');
    });

    it('uses explicit people as authority and preserves vacant and unassigned personnel', () => {
        const saved = savedForce();
        saved.personnel = { people: [{ id: 'person:reserve', name: 'Reserve' }], assignments: [] };
        Object.assign(saved.groups[0].units[0], { alias: 'Ignored', skill: 1, commander: true });
        const force = ASForce.deserialize(saved, data, injector);
        const unit = force.units()[0];

        expect(unit.pilot()).toBeUndefined();
        expect(unit.alias()).toBeUndefined();
        expect(unit.commander()).toBeFalse();
        unit.setPilotName('No implicit person');
        expect(force.serialize().personnel).toEqual(saved.personnel);
    });

    it('keeps the same person when replacing a unit and deletes its occupant on removal while retaining reserves', () => {
        const force = new ASForce('Personnel', data, injector);
        const original = force.addUnit(summary);
        original.setPilotName('Alex');
        original.setPilotSkill(3);
        original.setFormationAbilities(['group-bonus']);
        const personId = original.pilot()!.id;

        const replacement = force.replaceUnit(original, summary)!.newUnit;
        expect(replacement.pilot()!.id).toBe(personId);
        expect(replacement.alias()).toBe('Alex');
        expect(replacement.pilotSkill()).toBe(3);
        expect(replacement.formationAbilities()).toEqual(['group-bonus']);
        expect(force.personnel().people.length).toBe(1);
        const reserve = force.addUnassignedPerson({ name: 'Reserve' })!;
        force.removeUnit(replacement);
        expect(force.personnel().assignments).toEqual([]);
        expect(force.personnel().people).toEqual([reserve]);
    });

    it('swaps occupied pilots and preserves their ratings, notes, and health', () => {
        const force = new ASForce('Personnel', data, injector);
        const first = force.addUnit(summary), second = force.addUnit(summary);
        const firstId = first.pilot()!.id, secondId = second.pilot()!.id;
        expect(force.updatePerson(firstId, { gunnery: 2, piloting: 1, notes: 'First\nSecond', health: { wounds: 2, unconscious: false, ejected: false } })).toBeTrue();
        expect(force.assignPersonToUnit(firstId, second.id)).toBeTrue();
        expect(first.pilot()!.id).toBe(secondId);
        expect(second.pilot()).toEqual(jasmine.objectContaining({ id: firstId, piloting: 1, notes: 'First\nSecond', health: jasmine.objectContaining({ wounds: 2 }) }));
        expect(second.pilotSkill()).toBe(2);
        expect(force.unassignPerson(second.id, 'pilot')).toBeTrue();
        expect(second.getBv()).toBe(0);
        expect(second.getConditions().has('abandoned')).toBeTrue();
        expect(second.getConditions().has('immobile')).toBeTrue();
        expect(force.createPersonForUnit(second.id, 'pilot')).not.toBeNull();
        expect(second.pilot()!.id).not.toBe(firstId);
        expect(force.deletePerson(firstId)).toBeTrue();
        expect(force.personnel().people.some(person => person.id === firstId)).toBeFalse();
    });

    it('creates no pilot for buildings and keeps infantry personnel integrated but editable', () => {
        const force = new ASForce('Personnel', data, injector);
        const building = force.addUnit(createEmptyUnit({ type: 'Building', subtype: 'Building' }));
        const infantry = force.addUnit(createEmptyUnit({ type: 'Infantry', subtype: 'Conventional Infantry' }));
        expect(building.pilot()).toBeUndefined();
        expect(building.crewVacant()).toBeFalse();
        expect(force.getUnitCrewPolicy(building.id).positions).toEqual([]);
        expect(force.createPersonForUnit(building.id, 'pilot')).toBeNull();
        expect(force.getUnitCrewPolicy(infantry.id).kind).toBe('integrated');
        const person = infantry.pilot()!;
        expect(force.updatePerson(person.id, { name: 'Squad', gunnery: 3 })).toBeTrue();
        expect(force.unassignPerson(infantry.id, 'pilot')).toBeFalse();
        expect(force.deletePerson(person.id)).toBeFalse();
        expect(force.assignPersonToUnit(person.id, building.id)).toBeFalse();
    });

    it('restores unit print snapshots without rolling back a later personnel edit', () => {
        const force = new ASForce('Personnel', data, injector);
        const unit = force.addUnit(summary);
        unit.setPilotName('Before');
        const snapshot = unit.serialize();
        unit.setPilotName('After');
        unit.update(snapshot);
        expect(unit.alias()).toBe('After');
    });

    it('assigns and detaches reserves without losing either person or creating defaults', () => {
        const force = new ASForce('Personnel', data, injector);
        const unit = force.addUnit(summary);
        const originalPilot = unit.pilot()!;
        const reserve = force.addUnassignedPerson({ name: 'Alex', gunnery: 2 })!;

        expect(force.assignPersonToUnit(reserve.id, unit.id, 'gunner')).toBeFalse();
        expect(force.assignPersonToUnit(reserve.id, unit.id)).toBeTrue();
        expect(unit.pilot()).toEqual(reserve);
        expect(force.personnel().people).toContain(originalPilot);
        expect(force.assignPersonToUnit(reserve.id, unit.id)).toBeFalse();
        expect(force.detachUnitCrew(unit.id)).toBeTrue();
        expect(force.detachUnitCrew(unit.id)).toBeFalse();
        expect(unit.pilot()).toBeUndefined();
        expect(force.personnel().assignments).toEqual([]);
        expect(force.personnel().people.length).toBe(2);
        expect(force.assignPersonToUnit(originalPilot.id, unit.id)).toBeTrue();
        expect(unit.pilot()!.id).toBe(originalPilot.id);
    });

    it('keeps one assigned commander per group when assigning a reserve commander', () => {
        const force = new ASForce('Personnel', data, injector);
        const oldCommander = force.addUnit(summary);
        oldCommander.setFormationCommander(true);
        const unit = force.addUnit(summary);
        const reserve = force.addUnassignedPerson({ commander: true })!;

        expect(force.assignPersonToUnit(reserve.id, unit.id)).toBeTrue();
        expect(unit.commander()).toBeTrue();
        expect(oldCommander.commander()).toBeFalse();
    });

    it('rejects personnel edits on a read-only owner', () => {
        const original = new ASForce('Personnel', data, injector);
        original.addUnit(summary);
        const reserve = original.addUnassignedPerson({ name: 'Alex' })!;
        const force = ASForce.deserialize({ ...original.serialize(), owned: false } as ASSerializedForce, data, injector);
        const unit = force.units()[0];
        const personnel = force.personnel();

        unit.setPilotName('Blocked');
        expect(force.detachUnitCrew(unit.id)).toBeFalse();
        expect(force.assignPersonToUnit(reserve.id, unit.id)).toBeFalse();
        expect(force.personnel()).toBe(personnel);
    });

    it('does not allocate a person while preparing a detached conversion candidate', () => {
        const force = new ASForce('Personnel', data, injector);
        const candidate = force.createCompatibleUnit(summary);
        expect(candidate.pilot()).toBeUndefined();
        expect(force.personnel()).toEqual({ people: [], assignments: [] });
    });

    it('moves the original person only when a prepared replacement is committed to another force', async () => {
        const source = new ASForce('Source', data, injector);
        const original = source.addUnit(summary);
        original.setPilotName('Alex');
        original.setFormationCommander(true);
        const personId = original.pilot()!.id;
        const target = new ASForce('Target', data, injector);
        const targetCommander = target.addUnit(summary);
        targetCommander.setFormationCommander(true);
        const candidate = target.createCompatibleUnit(summary);
        expect(target.personnel().people.length).toBe(1);

        const moved = source.groups()[0].transferUnitTo(0, target.groups()[0], undefined, candidate);

        expect(moved).toBe(candidate);
        expect(candidate.pilot()!.id).toBe(personId);
        expect(candidate.alias()).toBe('Alex');
        expect(candidate.commander()).toBeFalse();
        expect(targetCommander.commander()).toBeTrue();
        expect(source.personnel()).toEqual({ people: [], assignments: [] });
        expect(target.personnel().people.length).toBe(2);
    });

    it('preserves a vacant pilot station when committing a prepared replacement to another force', async () => {
        const source = new ASForce('Source', data, injector);
        const original = source.addUnit(summary);
        const reserve = original.pilot()!;
        source.detachUnitCrew(original.id);
        const target = new ASForce('Target', data, injector);
        const group = await target.addGroup();
        const candidate = target.createCompatibleUnit(summary);

        expect(source.groups()[0].transferUnitTo(0, group, undefined, candidate)).toBe(candidate);
        expect(candidate.pilot()).toBeUndefined();
        expect(source.personnel().people).toEqual([reserve]);
        expect(target.personnel()).toEqual({ people: [], assignments: [] });
    });

    it('clones people and their assignments with new identities', async () => {
        const force = new ASForce('Personnel', data, injector);
        const unit = force.addUnit(summary);
        unit.setPilotName('Alex');
        const cloned = await force.cloneForPersistence() as ASForce;
        const clonedUnit = cloned.units()[0];
        expect(clonedUnit.id).not.toBe(unit.id);
        expect(clonedUnit.pilot()!.id).not.toBe(unit.pilot()!.id);
        expect(clonedUnit.alias()).toBe('Alex');
        expect(cloned.personnel().assignments[0].unitId).toBe(clonedUnit.id);
    });
});
