// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { GameSystem } from '../models/common.model';
import type { Force } from '../models/force.model';
import type { ForcePersonnelSnapshot } from '../models/force-personnel';
import type { UnitCrewPolicy } from '../models/unit-crew-policy';
import { ProtoMekEntity } from '../models/entity/entities/protomek/protomek-entity';
import { createTestEquipmentRegistry } from '../models/entity/testing/test-equipment-registry';
import { TestBipedMekEntity } from '../models/entity/testing/test-entities';
import type { EditPilotDialogData, EditPilotResult } from '../components/edit-pilot-dialog/edit-pilot-dialog.component';
import { DialogsService } from './dialogs.service';
import { ToastService } from './toast.service';
import { ForcePilotEditorService } from './force-pilot-editor.service';

function ownerFixture(system: GameSystem) {
    const personnel = signal<ForcePersonnelSnapshot>({ people: [{ id: 'person', name: 'Alex', gunnery: 3, piloting: 2, notes: 'Existing notes' }], assignments: [] });
    const policy = signal<UnitCrewPolicy>({ kind: 'swappable', canEdit: true, positions: [{ positionId: 'crew:0', label: 'Pilot' }] });
    const update = jasmine.createSpy('updatePerson').and.resolveTo(true);
    const unassign = jasmine.createSpy('unassignPerson').and.resolveTo(true);
    const remove = jasmine.createSpy('deletePerson').and.resolveTo(true);
    const owner = {
        gameSystem: system, personnel, units: () => [], members: () => [],
        faction: () => null, era: () => null, canEditPersonnel: () => policy().canEdit,
        getUnitCrewPolicy: () => policy(), updatePerson: update, unassignPerson: unassign, deletePerson: remove,
    };
    return { force: owner as unknown as Force, owner, personnel, policy, update, unassign, remove };
}

describe('ForcePilotEditorService personnel editing', () => {
    let dialogs: jasmine.SpyObj<DialogsService>;
    let editor: ForcePilotEditorService;
    beforeEach(() => {
        dialogs = jasmine.createSpyObj('DialogsService', ['createDialog']);
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: DialogsService, useValue: dialogs },
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
        ] });
        editor = TestBed.inject(ForcePilotEditorService);
    });

    it('saves AS reserve notes, shared rating, abilities and commander to the existing person', async () => {
        const source = ownerFixture(GameSystem.AS);
        dialogs.createDialog.and.returnValue({ closed: of({ name: 'Alexandra', notes: 'New notes', portrait: 'Doctor_F_1', skill: 2,
            abilities: ['marksman'], formationAbilities: [], commander: true }) } as never);
        await editor.editPerson(source.force, 'person');
        const data = dialogs.createDialog.calls.mostRecent().args[1]!.data as Record<string, unknown>;
        expect(data['notes']).toBe('Existing notes');
        expect(data['personnelActions']).toEqual({ canUnassign: false, canDelete: true });
        expect(source.update).toHaveBeenCalledOnceWith('person', { name: 'Alexandra', notes: 'New notes', portrait: 'Doctor_F_1', gunnery: 2,
            abilities: ['marksman'], commander: true });
    });

    it('edits a ProtoMek pilot raw rating and explains the entity override without overwriting it', async () => {
        const source = ownerFixture(GameSystem.CBT);
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'unit', positionId: 'crew:0', personId: 'person' }] }));
        source.owner.members = () => [{ kind: 'cbt', id: 'unit', entity: new ProtoMekEntity(createTestEquipmentRegistry()),
            currentBaseBattleValue: () => 500, tagBattleValue: () => 0, c3BattleValue: () => 0 }] as never[];
        dialogs.createDialog.and.returnValue({ closed: of({ crew: [{ id: 'crew:0', name: 'Alex', gunnery: 3, piloting: 1 }], commander: false }) } as never);
        await editor.editPerson(source.force, 'person');
        const data = dialogs.createDialog.calls.mostRecent().args[1]!.data as { fixedPiloting: number; crew: { piloting: number; notes: string }[] };
        expect(data.fixedPiloting).toBe(5);
        expect(data.crew[0].piloting).toBe(2);
        expect(data.crew[0].notes).toBe('Existing notes');
        expect(source.update).toHaveBeenCalledOnceWith('person', { name: 'Alex', notes: undefined, portrait: undefined, gunnery: 3, piloting: 1, commander: undefined });
    });

    it('passes current unit BV with fractional TAG and C3 costs and entity skill facts into the pilot preview', async () => {
        const source = ownerFixture(GameSystem.CBT);
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'unit', positionId: 'crew:0', personId: 'person' }] }));
        const entity = new TestBipedMekEntity();
        spyOn(entity, 'battleValue').and.returnValue(2000);
        source.owner.members = () => [{ kind: 'cbt', id: 'unit', entity,
            currentBaseBattleValue: () => 1000, tagBattleValue: () => 100.25, c3BattleValue: () => 225.5 }] as never[];
        dialogs.createDialog.and.returnValue({ closed: of(null) } as never);

        await editor.editPerson(source.force, 'person');

        const data = dialogs.createDialog.calls.mostRecent().args[1]!.data as EditPilotDialogData;
        expect(data.preSkillBv).toBe(1325.75);
        expect(data.skillFacts).toEqual({ unitType: 'Mek', unitSubtype: 'BattleMek', canAntiMech: false });
        expect(source.update).not.toHaveBeenCalled();
    });

    it('keeps a reserve editable without inventing a unit BV preview', async () => {
        const source = ownerFixture(GameSystem.CBT);
        dialogs.createDialog.and.returnValue({ closed: of({ crew: [{ id: 'reserve', name: 'Alex', gunnery: 3, piloting: 2 }], commander: true }) } as never);

        await editor.editPerson(source.force, 'person');

        const data = dialogs.createDialog.calls.mostRecent().args[1]!.data as EditPilotDialogData;
        expect(data.preSkillBv).toBeUndefined();
        expect(data.skillFacts).toBeUndefined();
        expect(data.personnelActions).toEqual({ canUnassign: false, canDelete: true });
        expect(source.update).toHaveBeenCalledOnceWith('person', { name: 'Alex', notes: undefined, portrait: undefined,
            gunnery: 3, piloting: 2, commander: true });
    });

    it('unassigns the same person from their current station after a move while the dialog is open', async () => {
        const source = ownerFixture(GameSystem.CBT);
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'before', positionId: 'crew:0', personId: 'person' }] }));
        const closed = new Subject<EditPilotResult>();
        dialogs.createDialog.and.returnValue({ closed } as never);
        const editing = editor.editPerson(source.force, 'person');
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'after', positionId: 'crew:1', personId: 'person' }] }));
        closed.next({ action: 'unassign', crew: [], commander: false });
        await editing;
        expect(source.unassign).toHaveBeenCalledOnceWith('after', 'crew:1');
        expect(source.update).not.toHaveBeenCalled();
    });

    it('uses core policy to omit integrated assignment actions and prevent read-only editing', async () => {
        const source = ownerFixture(GameSystem.CBT);
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'unit', positionId: 'crew:0', personId: 'person' }] }));
        source.policy.update(policy => ({ ...policy, kind: 'integrated' }));
        dialogs.createDialog.and.returnValue({ closed: of(null) } as never);
        await editor.editPerson(source.force, 'person');
        const data = dialogs.createDialog.calls.mostRecent().args[1]!.data as { personnelActions: unknown };
        expect(data.personnelActions).toEqual({ canUnassign: false, canDelete: false });
        source.policy.update(policy => ({ ...policy, canEdit: false }));
        await editor.editPerson(source.force, 'person');
        expect(dialogs.createDialog).toHaveBeenCalledTimes(1);
    });
});
