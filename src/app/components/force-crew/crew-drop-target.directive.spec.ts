// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkDropList } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import { CrewAssignmentService } from '../../services/crew-assignment.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { CrewDropTargetDirective } from './crew-drop-target.directive';

@Component({
    imports: [CrewDropTargetDirective],
    template: '<div [crewDropForce]="force" [crewDropUnit]="unitId()"></div>',
})
class CrewDropTargetHost {
    readonly editable = signal(false);
    readonly unitId = signal<string | undefined>('unit');
    readonly force = { canEditPersonnel: this.editable } as unknown as Force;
}

describe('Crew drop target eligibility', () => {
    it('registers only eligible targets and reacts to crew vacancy and ownership changes', async () => {
        const vacancy = signal<string | undefined>('pilot');
        const loadedForces = signal([{}, {}]);
        const unregister = jasmine.createSpy('unregister');
        const registerDropList = jasmine.createSpy('registerDropList').and.returnValue(unregister);
        const connectedDropLists = jasmine.createSpy('connectedDropLists').and.returnValue(['reserve-list']);
        TestBed.configureTestingModule({
            imports: [CrewDropTargetHost],
            providers: [{ provide: CrewAssignmentService, useValue: {
                registerDropList, connectedDropLists, firstVacantPosition: () => vacancy(),
            } }, { provide: ForceWorkspaceStateService, useValue: { loadedForces } }],
        });
        const fixture = TestBed.createComponent(CrewDropTargetHost);
        await fixture.whenStable();
        const list = fixture.debugElement.query(By.directive(CrewDropTargetDirective)).injector.get(CdkDropList);
        expect(list.disabled).toBeTrue();
        expect(registerDropList).not.toHaveBeenCalled();
        expect(connectedDropLists).not.toHaveBeenCalled();

        fixture.componentInstance.editable.set(true);
        await fixture.whenStable();
        expect(list.disabled).toBeFalse();
        expect(list.connectedTo).toEqual(['reserve-list']);
        expect(registerDropList).toHaveBeenCalledOnceWith(fixture.componentInstance.force, list.id);

        // A single force still needs to assign its reserves to vacant unit stations.
        loadedForces.set([{}]);
        await fixture.whenStable();
        expect(list.disabled).toBeFalse();
        expect(registerDropList).toHaveBeenCalledTimes(1);
        expect(unregister).not.toHaveBeenCalled();
        loadedForces.set([{}, {}]);

        vacancy.set(undefined);
        await fixture.whenStable();
        expect(list.disabled).toBeTrue();
        expect(list.connectedTo).toEqual([]);
        expect(unregister).toHaveBeenCalledTimes(1);

        vacancy.set('pilot');
        await fixture.whenStable();
        expect(list.disabled).toBeFalse();
        expect(registerDropList).toHaveBeenCalledTimes(2);

        fixture.componentInstance.editable.set(false);
        await fixture.whenStable();
        expect(list.disabled).toBeTrue();
        expect(unregister).toHaveBeenCalledTimes(2);

        // Force headers accept reserves even when no unit station is vacant.
        vacancy.set(undefined);
        fixture.componentInstance.unitId.set(undefined);
        fixture.componentInstance.editable.set(true);
        await fixture.whenStable();
        expect(list.disabled).toBeFalse();
        expect(registerDropList).toHaveBeenCalledTimes(3);
        loadedForces.set([{}]);
        await fixture.whenStable();
        expect(list.disabled).toBeTrue();
        expect(list.connectedTo).toEqual([]);
        expect(unregister).toHaveBeenCalledTimes(3);
        loadedForces.set([{}, {}]);
        await fixture.whenStable();
        expect(list.disabled).toBeFalse();
        expect(registerDropList).toHaveBeenCalledTimes(4);
        fixture.destroy();
        expect(unregister).toHaveBeenCalledTimes(4);
    });
});
