// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ASForce } from '../models/as-force.model';
import { CBTForce } from '../models/cbt-force.model';
import { GameSystem } from '../models/common.model';
import { CBTForceMember, type ForceMember } from '../models/force-member.model';
import type { ForceSlot } from '../models/force-slot.model';
import { createEmptyUnit, createTestMekEntity } from '../testing/unit-test-helpers';
import { AsAbilityLookupService } from './as-ability-lookup.service';
import { DataService } from './data.service';
import { DialogsService } from './dialogs.service';
import { ForceBuilderService } from './force-builder.service';
import { ForceCrewTransferService } from './force-crew-transfer.service';
import { ForceFormationService } from './force-formation.service';
import { ForcePersistenceService } from './force-persistence.service';
import { ForceUnitAdmissionService } from './force-unit-admission.service';
import { ForceWorkspaceCommandsService } from './force-workspace-commands.service';
import { ForceWorkspaceStateService } from './force-workspace-state.service';
import { LayoutService } from './layout.service';
import { LoggerService } from './logger.service';
import { OptionsService } from './options.service';
import { ToastService } from './toast.service';

describe('ForceWorkspaceCommandsService force conversion', () => {
    it('converts an ordinary AS force with default group metadata to CBT', async () => {
        const harness = createHarness();
        const { admission, builder, crewTransfers, dataService, injector, persistence, service, workspace } = harness;
        admission.admit.and.callFake(async request => {
            if (!(request.force instanceof CBTForce)) {
                throw new Error('Expected a CBT conversion target');
            }
            return new CBTForceMember(
                'converted-unit',
                request.force,
                createTestMekEntity(),
            );
        });
        const source = new ASForce('Conversion test', dataService, injector);
        source.loading = true;
        const group = await source.addGroup();
        const formationTarget = await source.addGroup();
        await source.updateGroup(group, { formationTargetGroupId: formationTarget.id });
        const sourceUnit = source.addUnit(createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            as: { TP: 'BM', PV: 20 },
        }), group);
        source.loading = false;
        sourceUnit.setPilotName('Aidan Pryde');
        sourceUnit.setPilotSkill(2);
        sourceUnit.setFormationCommander(true);
        const sourceSlot: ForceSlot = {
            force: source,
            alignment: 'friendly',
            changeSub: null,
        };
        workspace.getForceSlot.and.returnValue(sourceSlot);

        await service.requestCloneForce(source);

        expect(admission.admit).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            force: jasmine.any(CBTForce),
            summary: sourceUnit.getSummary(),
            commander: true,
        }));
        const convertedUnit = await admission.admit.calls.mostRecent().returnValue;
        expect(crewTransfers.transferCrossSystem).toHaveBeenCalledOnceWith(
            sourceUnit,
            convertedUnit,
            GameSystem.AS,
            GameSystem.CBT,
        );
        expect(builder.removeLoadedForce).toHaveBeenCalledOnceWith(source);
        expect(builder.addLoadedForce).toHaveBeenCalledOnceWith(
            jasmine.any(CBTForce),
            'friendly',
            { activate: true },
        );
        const convertedForce = builder.addLoadedForce.calls.mostRecent().args[0];
        expect(convertedForce.groups()[0].formationTargetGroupId())
            .toBe(convertedForce.groups()[1].id);
        expect(persistence.saveForceAndWaitForCloud).toHaveBeenCalledTimes(1);
    });

    it('converts a CBT force to AS and carries commander into admission', async () => {
        const harness = createHarness();
        const { admission, builder, crewTransfers, dataService, injector, persistence, service, workspace } = harness;
        const summary = createEmptyUnit({
            type: 'Mek',
            subtype: 'BattleMek',
            as: { TP: 'BM', PV: 20 },
        });
        dataService.getUnitByUuid.and.returnValue(summary);
        const source = new CBTForce('Conversion test', dataService, injector);
        await source.addGroup();
        const sourceUnit = new CBTForceMember(
            'classic-source',
            source,
            createTestMekEntity({ uuid: summary.uuid }),
        );
        spyOn(source, 'membersInGroup').and.returnValue([sourceUnit]);
        spyOn(source, 'getUnitUuid').and.returnValue(summary.uuid);
        spyOn(source, 'isUnitCommander').and.returnValue(true);
        admission.admit.and.callFake(async request => {
            if (!(request.force instanceof ASForce)) {
                throw new Error('Expected an AS conversion target');
            }
            const targetGroup = request.force.groups().find(candidate => candidate === request.group);
            if (!targetGroup) throw new Error('Expected an owned AS conversion group');
            const created = request.force.addUnit(request.summary, targetGroup);
            created.setFormationCommander(request.commander === true, false);
            return created;
        });
        const sourceSlot: ForceSlot = {
            force: source,
            alignment: 'enemy',
            changeSub: null,
        };
        workspace.getForceSlot.and.returnValue(sourceSlot);

        await service.requestCloneForce(source);

        expect(admission.admit).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            force: jasmine.any(ASForce),
            summary,
            group: jasmine.objectContaining({ force: jasmine.any(ASForce) }),
            commander: true,
        }));
        const convertedUnit = await admission.admit.calls.mostRecent().returnValue;
        expect(crewTransfers.transferCrossSystem).toHaveBeenCalledOnceWith(
            sourceUnit,
            convertedUnit,
            GameSystem.CBT,
            GameSystem.AS,
        );
        expect(builder.removeLoadedForce).toHaveBeenCalledOnceWith(source);
        expect(builder.addLoadedForce).toHaveBeenCalledOnceWith(
            jasmine.any(ASForce),
            'enemy',
            { activate: true },
        );
        expect(persistence.saveForceAndWaitForCloud).toHaveBeenCalledTimes(1);
    });
});

describe('ForceWorkspaceCommandsService unit cloning', () => {
    it('passes the force-held custom source to the clone instead of requiring an installed design', async () => {
        const { admission, dataService, injector, service } = createHarness();
        const force = new CBTForce('Custom clone', dataService, injector), group = await force.addGroup();
        const entity = createTestMekEntity(), source = new CBTForceMember('source', force, entity);
        const clone = new CBTForceMember('clone', force, entity);
        const text = 'uuid:' + entity.uuid() + '\nchassis:Saved custom\n';
        spyOn(force, 'getUnitUuid').and.returnValue(entity.uuid());
        spyOn(force, 'getRosterGroupId').and.returnValue(group.id);
        spyOn(force, 'membersInGroup').and.returnValue([source]);
        spyOn(force, 'getUnitSnapshot').and.returnValue({ nativeSource: { isCustom: true, format: 'mtf', bytes: new TextEncoder().encode(text).buffer } } as any);
        admission.admitCBT.and.resolveTo(clone);
        expect(await service.cloneUnit(source)).toBe(clone);
        expect(admission.admitCBT).toHaveBeenCalledOnceWith(jasmine.objectContaining({ customSource: { format: 'mtf', source: text } }));
    });

    it('routes a unit-block CBT clone through canonical unit admission', async () => {
        const harness = createHarness();
        const { admission, dataService, injector, service, workspace } = harness;
        const force = new CBTForce('Clone test', dataService, injector);
        const group = await force.addGroup();
        const entity = createTestMekEntity();
        const source = new CBTForceMember('source-unit', force, entity);
        const clone = new CBTForceMember('cloned-unit', force, entity);
        spyOn(force, 'getUnitUuid').and.returnValue(entity.uuid());
        spyOn(force, 'getRosterGroupId').and.returnValue(group.id);
        spyOn(force, 'membersInGroup').and.returnValue([source]);
        admission.admitCBT.and.resolveTo(clone);

        const result = await service.cloneUnit(source);

        expect(result).toBe(clone);
        expect(admission.admitCBT).toHaveBeenCalledOnceWith({
            force,
            uuid: entity.uuid(),
            rosterGroupId: group.id,
            rosterMemberIndex: 1,
        });
        expect(workspace.selectUnit).toHaveBeenCalledOnceWith(clone);
    });
});

describe('ForceWorkspaceCommandsService last-unit removal', () => {
    for (const withReserve of [false, true]) {
        it(`removes the last AS unit ${withReserve ? 'without deleting its reserves or force' : 'and deletes the empty force'}`, async () => {
            const { builder, dataService, injector, persistence, service, workspace } = createHarness();
            const force = new ASForce('Removal test', dataService, injector);
            const member = force.addUnit(createEmptyUnit(), await force.addGroup());
            const reserve = withReserve ? force.addUnassignedPerson({ name: 'Reserve', gunnery: 2, notes: 'Keep me' }) : null;
            workspace.selectedUnit.set(member);

            await service.removeUnit(member, true);

            if (reserve) {
                expect(builder.deleteAndRemoveForce).not.toHaveBeenCalled();
                expect(force.members()).toEqual([]);
                expect(force.personnel()).toEqual({ people: [reserve], assignments: [] });
                expect(force.canEditPersonnel()).toBeTrue();
                expect(workspace.selectedUnit()).toBeNull();
                expect(persistence.deleteCanvasDataOfUnit).toHaveBeenCalledOnceWith(member);
                const saved = await force.serializeForPersistence();
                expect(saved.personnel).toEqual(force.personnel());
            } else {
                expect(builder.deleteAndRemoveForce).toHaveBeenCalledOnceWith(force);
            }
        });

        it(`removes the last CBT unit ${withReserve ? 'without deleting its reserves or force' : 'and deletes the empty force'}`, async () => {
            const { builder, dataService, injector, service, workspace } = createHarness();
            const force = new CBTForce('Removal test', dataService, injector);
            const group = await force.addGroup();
            const member = new CBTForceMember('last-unit', force, createTestMekEntity());
            const members = signal([member]);
            spyOn(force, 'getCBTMembers').and.callFake(members);
            spyOn(force, 'getCBTMember').and.returnValue(member);
            spyOn(force, 'getRosterGroupId').and.returnValue(group.id);
            const remove = spyOn(force, 'removeCBTMember').and.callFake(async () => {
                members.set([]);
                return { accepted: true, changed: true, forceRevision: 1 };
            });
            const reserve = withReserve ? force.addUnassignedPerson({ name: 'Reserve', gunnery: 2, notes: 'Keep me' }) : null;
            workspace.selectedUnit.set(member);

            await service.removeUnit(member, true);

            if (reserve) {
                expect(builder.deleteAndRemoveForce).not.toHaveBeenCalled();
                expect(remove).toHaveBeenCalledOnceWith(member.id);
                expect(force.members()).toEqual([]);
                expect(force.personnel()).toEqual({ people: [reserve], assignments: [] });
                expect(force.canEditPersonnel()).toBeTrue();
                expect(workspace.selectedUnit()).toBeNull();
            } else {
                expect(builder.deleteAndRemoveForce).toHaveBeenCalledOnceWith(force);
                expect(remove).not.toHaveBeenCalled();
            }
        });
    }
});

function createHarness() {
    const dataService = jasmine.createSpyObj<DataService>('DataService', ['getUnitByUuid']);
    const builder = jasmine.createSpyObj<ForceBuilderService>(
        'ForceBuilderService',
        ['removeLoadedForce', 'addLoadedForce', 'deleteAndRemoveForce'],
    );
    builder.removeLoadedForce.and.resolveTo(true);
    builder.addLoadedForce.and.returnValue(true);
    builder.deleteAndRemoveForce.and.resolveTo();
    const workspace = jasmine.createSpyObj<ForceWorkspaceStateService>(
        'ForceWorkspaceStateService',
        ['getForceSlot', 'selectUnit'],
        { selectedUnit: signal<ForceMember | null>(null) },
    );
    workspace.selectUnit.and.callFake(member => workspace.selectedUnit.set(member));
    const dialogs = jasmine.createSpyObj<DialogsService>('DialogsService', ['createDialog']);
    dialogs.createDialog.and.returnValue({ closed: of('convert') } as never);
    const persistence = jasmine.createSpyObj<ForcePersistenceService>(
        'ForcePersistenceService',
        ['saveForceAndWaitForCloud', 'deleteCanvasDataOfUnit'],
    );
    persistence.saveForceAndWaitForCloud.and.resolveTo();
    const admission = jasmine.createSpyObj<ForceUnitAdmissionService>(
        'ForceUnitAdmissionService',
        ['admit', 'admitCBT'],
    );
    const crewTransfers = jasmine.createSpyObj<ForceCrewTransferService>(
        'ForceCrewTransferService',
        ['transferCrossSystem', 'copyUnassignedPersonnel'],
    );
    crewTransfers.transferCrossSystem.and.resolveTo();
    const formations = jasmine.createSpyObj<ForceFormationService>(
        'ForceFormationService',
        ['assignFormationIfNeeded', 'generateFactionAndForceNameIfNeeded'],
    );
    formations.assignFormationIfNeeded.and.resolveTo();

    TestBed.configureTestingModule({
        providers: [
            ForceWorkspaceCommandsService,
            { provide: DataService, useValue: dataService },
            { provide: ForceBuilderService, useValue: builder },
            { provide: ForceWorkspaceStateService, useValue: workspace },
            { provide: DialogsService, useValue: dialogs },
            { provide: ForcePersistenceService, useValue: persistence },
            { provide: ForceUnitAdmissionService, useValue: admission },
            { provide: ForceCrewTransferService, useValue: crewTransfers },
            { provide: ForceFormationService, useValue: formations },
            { provide: LayoutService, useValue: {} },
            { provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'error']) },
            { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['showToast']) },
            { provide: AsAbilityLookupService, useValue: {} },
            {
                provide: OptionsService,
                useValue: {
                    options: () => ({
                        CBTRules: 'core-2026',
                        CBTOptionalRules: { forcedWithdrawal: true, sprinting: false },
                    }),
                },
            },
        ],
    });
    return {
        admission,
        builder,
        crewTransfers,
        dataService,
        injector: TestBed.inject(Injector),
        persistence,
        service: TestBed.inject(ForceWorkspaceCommandsService),
        workspace,
    };
}
