// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CdkDrag, CdkDragHandle, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import type { Force } from '../../models/force.model';
import type { ForcePersonnelSnapshot } from '../../models/force-personnel';
import type { UnitCrewPolicy } from '../../models/unit-crew-policy';
import { GameSystem } from '../../models/common.model';
import { ProtoMekEntity } from '../../models/entity/entities/protomek/protomek-entity';
import { createTestEquipmentRegistry } from '../../models/entity/testing/test-equipment-registry';
import { CrewAssignmentService, type CrewDragData } from '../../services/crew-assignment.service';
import { ForcePilotEditorService } from '../../services/force-pilot-editor.service';
import { ToastService } from '../../services/toast.service';
import { OverlayManagerService } from '../../services/overlay-manager.service';
import { ForceUnitCrewComponent } from './force-unit-crew.component';
import { ForceReserveCrewComponent } from './force-reserve-crew.component';
import { CrewSlotComponent } from './crew-slot.component';
import { PilotSelectorPanelComponent, type PilotSelection } from './pilot-selector.component';
import { CrewDropTargetDirective } from './crew-drop-target.directive';

@Component({
    imports: [CdkDrag, CdkDropList, ForceReserveCrewComponent, CrewDropTargetDirective],
    template: `<div cdkDropList><div cdkDrag>
        <div class="unit-target" [crewDropForce]="target.force" crewDropUnit="unit"></div>
        <div class="force-target" [crewDropForce]="target.force"></div>
        <force-reserve-crew [force]="source.force" [layout]="layout()" />
        <force-reserve-crew [force]="target.force" />
    </div></div>`,
})
class CrewDropHost {
    readonly layout = signal<'rows' | 'cards'>('rows');
    readonly source = ownerFixture();
    readonly target = ownerFixture();
}

function ownerFixture() {
    const personnel = signal<ForcePersonnelSnapshot>({ people: [{ id: 'pilot', name: 'Alex', gunnery: 3, piloting: 2, notes: 'PRIVATE NOTES' }],
        assignments: [{ unitId: 'unit', positionId: 'pilot', personId: 'pilot' }] });
    const policy = signal<UnitCrewPolicy>({ kind: 'swappable', canEdit: true, positions: [{ positionId: 'pilot', label: 'Pilot' }] });
    const assign = jasmine.createSpy('assignPersonToUnit').and.resolveTo(true);
    const unassign = jasmine.createSpy('unassignPerson').and.resolveTo(true);
    const remove = jasmine.createSpy('deletePerson').and.resolveTo(true);
    const owner = {
        gameSystem: GameSystem.AS, personnel, members: () => [], canEditPersonnel: () => policy().canEdit,
        getUnitCrewPolicy: () => policy(),
        getAssignedPerson: (unitId: string, positionId: string) => {
            const assignment = personnel().assignments.find(row => row.unitId === unitId && row.positionId === positionId);
            return personnel().people.find(person => person.id === assignment?.personId);
        },
        assignPersonToUnit: assign, unassignPerson: unassign, deletePerson: remove,
        createPersonForUnit: jasmine.createSpy('createPersonForUnit').and.resolveTo({ id: 'created' }),
        addUnassignedPerson: jasmine.createSpy('addUnassignedPerson').and.returnValue({ id: 'created' }),
        transferReservePersonTo: jasmine.createSpy('transferReservePersonTo').and.returnValue(true),
        reorderReservePerson: jasmine.createSpy('reorderReservePerson').and.returnValue(true),
    };
    return { force: owner as unknown as Force, owner, personnel, policy, assign, unassign, remove };
}

describe('shared force crew controls', () => {
    const editor = { editPerson: jasmine.createSpy('editPerson').and.resolveTo() };
    beforeEach(() => {
        editor.editPerson.calls.reset();
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(),
            { provide: ForcePilotEditorService, useValue: editor },
            { provide: ToastService, useValue: { showToast: jasmine.createSpy('showToast') } },
            { provide: OverlayManagerService, useValue: { closeManagedOverlay() {} } },
        ] });
    });

    it('retains all station controls when no people remain and follows integrated/read-only policy', () => {
        const source = ownerFixture();
        source.personnel.set({ people: [], assignments: [] });
        source.policy.set({ kind: 'swappable', canEdit: true, positions: [{ positionId: 'pilot', label: 'Pilot' }, { positionId: 'gunner', label: 'Gunner' }] });
        const fixture = TestBed.createComponent(ForceUnitCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'unit');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelectorAll('pilot-selector button').length).toBe(2);
        expect([...fixture.nativeElement.querySelectorAll('pilot-selector button')].every((button: any) => !button.disabled)).toBeTrue();
        source.policy.update(policy => ({ ...policy, kind: 'integrated' }));
        fixture.detectChanges();
        expect([...fixture.nativeElement.querySelectorAll('pilot-selector button')].every((button: any) => button.disabled)).toBeTrue();
        source.policy.update(policy => ({ ...policy, kind: 'swappable', canEdit: false }));
        fixture.detectChanges();
        expect([...fixture.nativeElement.querySelectorAll('pilot-selector button')].every((button: any) => button.disabled)).toBeTrue();
    });

    it('shows every named station with occupants slotted into place and labeled vacancies', () => {
        const source = ownerFixture();
        source.policy.update(policy => ({ ...policy, positions: [
            { positionId: 'pilot', label: 'Pilot' }, { positionId: 'gunner', label: 'Gunner' },
            { positionId: 'officer', label: 'Tech Officer' },
        ] }));
        const fixture = TestBed.createComponent(ForceUnitCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'unit');
        fixture.componentRef.setInput('layout', 'slots');
        fixture.detectChanges();
        const slots = fixture.debugElement.queryAll(By.directive(CrewSlotComponent));
        expect(slots.length).toBe(3);
        expect(slots.map(slot => slot.nativeElement.querySelector('.slot-label').textContent)).toEqual(['Pilot', 'Gunner', 'Tech Officer']);
        expect(slots[0].nativeElement.textContent).toContain('Alex');
        expect(slots[1].nativeElement.textContent).toContain('No Gunner');
        expect(slots[2].nativeElement.textContent).toContain('No Tech Officer');
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        fixture.detectChanges();
        expect(fixture.debugElement.queryAll(By.directive(CrewSlotComponent)).length).toBe(3);
        expect(slots[0].nativeElement.textContent).toContain('No Pilot');
        expect(fixture.nativeElement.querySelector('crew-card')).toBeNull();
    });

    it('drags directly from a crew card without starting its parent unit drag or editing the crew', async () => {
        const fixture = TestBed.createComponent(CrewDropHost);
        fixture.componentInstance.source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        fixture.detectChanges();
        await fixture.whenStable();
        const drags = fixture.debugElement.queryAll(By.directive(CdkDrag));
        const parentStarted = jasmine.createSpy('parent drag');
        const crewStarted = jasmine.createSpy('crew drag');
        drags[0].injector.get(CdkDrag).started.subscribe(parentStarted);
        drags[1].injector.get(CdkDrag).started.subscribe(crewStarted);
        expect(fixture.debugElement.query(By.directive(CdkDragHandle))).toBeNull();
        const button = fixture.nativeElement.querySelector('.crew-main') as HTMLButtonElement;
        const rect = button.getBoundingClientRect();
        const point = { clientX: rect.left + 16, clientY: rect.top + 16, buttons: 1,
            button: 0, detail: 1, view: window, bubbles: true, cancelable: true };
        button.dispatchEvent(new MouseEvent('mousedown', point));
        document.dispatchEvent(new MouseEvent('mousemove', { ...point, clientY: point.clientY + 20 }));
        expect(crewStarted).toHaveBeenCalledTimes(1);
        expect(parentStarted).not.toHaveBeenCalled();
        document.dispatchEvent(new MouseEvent('mouseup', { ...point, clientY: point.clientY + 20, buttons: 0 }));
        await fixture.whenStable();
        expect(editor.editPerson).not.toHaveBeenCalled();
        fixture.destroy();
    });

    it('waits for a touch hold before starting a crew drag', async () => {
        const fixture = TestBed.createComponent(ForceUnitCrewComponent);
        const source = ownerFixture();
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'unit');
        fixture.detectChanges();
        await fixture.whenStable();
        const drag = fixture.debugElement.query(By.directive(CdkDrag)).injector.get(CdkDrag);
        const started = jasmine.createSpy('touch drag');
        drag.started.subscribe(started);
        const button = fixture.nativeElement.querySelector('.crew-main') as HTMLButtonElement;
        const rect = button.getBoundingClientRect();
        const touch = (type: string, offset = 0) => {
            const point = new Touch({ identifier: 1, target: button, clientX: rect.left + 16,
                clientY: rect.top + 16 + offset, pageX: rect.left + 16, pageY: rect.top + 16 + offset });
            button.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                touches: type === 'touchend' ? [] : [point], targetTouches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
        };
        touch('touchstart');
        touch('touchmove', 20);
        expect(started).not.toHaveBeenCalled();
        touch('touchend', 20);
        touch('touchstart');
        await new Promise(resolve => setTimeout(resolve, 220));
        touch('touchmove', 20);
        expect(started).toHaveBeenCalledTimes(1);
        touch('touchend', 20);
        await fixture.whenStable();
        fixture.destroy();
    });

    it('routes an on-target person drop to the owner API and rejects assigned crew from another force', async () => {
        const source = ownerFixture();
        const fixture = TestBed.createComponent(CrewSlotComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'target');
        fixture.componentRef.setInput('positionId', 'pilot');
        fixture.detectChanges();
        const drag = { data: { kind: 'force-person', force: source.force, personId: 'pilot' } as CrewDragData };
        fixture.componentInstance.drop({ item: drag, isPointerOverContainer: false } as CdkDragDrop<unknown, unknown, CrewDragData>);
        expect(source.assign).not.toHaveBeenCalled();
        fixture.componentInstance.drop({ item: drag, isPointerOverContainer: true } as CdkDragDrop<unknown, unknown, CrewDragData>);
        await fixture.whenStable();
        expect(source.assign).toHaveBeenCalledOnceWith('pilot', 'target', 'pilot');
        fixture.componentInstance.drop({ item: { data: { ...drag.data, force: ownerFixture().force } }, isPointerOverContainer: true } as CdkDragDrop<unknown, unknown, CrewDragData>);
        expect(source.assign).toHaveBeenCalledTimes(1);
        fixture.destroy();
        expect(TestBed.inject(CrewAssignmentService).connectedDropLists()).toEqual([]);
    });

    it('hides empty reserves and registers the list only while reserves are present', () => {
        const source = ownerFixture();
        const fixture = TestBed.createComponent(ForceReserveCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('layout', 'compact');
        fixture.detectChanges();
        const crew = TestBed.inject(CrewAssignmentService);
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
        expect(crew.connectedDropLists()).toEqual([]);
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('section')).not.toBeNull();
        expect(crew.connectedDropLists()).toEqual([fixture.componentInstance.dropId]);
        expect(fixture.nativeElement.querySelector('.crew-card.compact')).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.crew-actions')).toBeNull();
        const button = fixture.nativeElement.querySelector('.crew-main') as HTMLButtonElement;
        expect(button.title).toContain('Alex · Skill 3');
        button.click();
        expect(editor.editPerson).toHaveBeenCalledOnceWith(source.force, 'pilot');
        expect(fixture.nativeElement.textContent).not.toContain('PRIVATE NOTES');
        source.personnel.update(personnel => ({ ...personnel, assignments: [{ unitId: 'unit', positionId: 'pilot', personId: 'pilot' }] }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
        expect(crew.connectedDropLists()).toEqual([]);
        source.policy.update(policy => ({ ...policy, canEdit: false }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
        expect(crew.connectedDropLists()).toEqual([]);
    });

    it('connects nested reserve drags to their own list, other forces, and vacant unit rows', async () => {
        const fixture = TestBed.createComponent(CrewDropHost);
        const host = fixture.componentInstance;
        host.source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        host.target.personnel.update(personnel => ({ ...personnel, people: [], assignments: [] }));
        fixture.detectChanges();
        await fixture.whenStable();
        const reserveLists = fixture.debugElement.queryAll(By.directive(ForceReserveCrewComponent));
        const list = reserveLists[0].query(By.directive(CdkDropList)).injector.get(CdkDropList);
        const drag = reserveLists[0].query(By.directive(CdkDrag)).injector.get(CdkDrag);
        const unitList = fixture.debugElement.query(By.css('.unit-target')).injector.get(CdkDropList);
        const targetList = fixture.debugElement.query(By.css('.force-target')).injector.get(CdkDropList);
        expect(drag.dropContainer).toBe(list);
        expect(drag.getRootElement().tagName).toBe('CREW-CARD');
        expect(list.getSortedItems()).toEqual([drag]);
        expect(list.sortingDisabled).toBeFalse();
        expect(list.orientation).toBe('vertical');
        host.layout.set('cards');
        fixture.detectChanges();
        expect(list.orientation).toBe('mixed');
        expect(list.connectedTo).toContain(unitList.id);
        expect(list.connectedTo).toContain(targetList.id);
        expect(reserveLists[1].query(By.directive(CdkDropList))).toBeNull();
        expect(targetList.enterPredicate(drag, targetList)).toBeTrue();
        expect(unitList.enterPredicate(drag, unitList)).toBeTrue();
        unitList.dropped.emit({ item: drag, isPointerOverContainer: true } as CdkDragDrop<unknown, unknown, CrewDragData>);
        await fixture.whenStable();
        expect(host.source.owner.transferReservePersonTo).toHaveBeenCalledOnceWith(host.target.force, 'pilot');
        expect(host.target.assign).toHaveBeenCalledOnceWith('pilot', 'unit', 'pilot');
        targetList.dropped.emit({ item: drag, isPointerOverContainer: true } as CdkDragDrop<unknown, unknown, CrewDragData>);
        await fixture.whenStable();
        expect(host.source.owner.transferReservePersonTo).toHaveBeenCalledTimes(2);
        expect(host.target.owner.reorderReservePerson).toHaveBeenCalledOnceWith('pilot', 0);
        host.target.policy.update(policy => ({ ...policy, canEdit: false }));
        fixture.detectChanges();
        expect(unitList.enterPredicate(drag, unitList)).toBeFalse();
        fixture.destroy();
        expect(TestBed.inject(CrewAssignmentService).connectedDropLists()).toEqual([]);
    });

    it('sorts a dropped reserve by its new index and ignores releases outside the list', async () => {
        const source = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        const fixture = TestBed.createComponent(ForceReserveCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.detectChanges();
        const event = { item: { data: { kind: 'force-person', force: source.force, personId: 'pilot' } },
            currentIndex: 2, isPointerOverContainer: true } as CdkDragDrop<unknown, unknown, CrewDragData>;
        fixture.componentInstance.drop(event);
        await fixture.whenStable();
        expect(source.owner.reorderReservePerson).toHaveBeenCalledOnceWith('pilot', 2);
        expect(source.unassign).not.toHaveBeenCalled();
        fixture.componentInstance.drop({ ...event, isPointerOverContainer: false });
        expect(source.owner.reorderReservePerson).toHaveBeenCalledTimes(1);
    });

    it('assigns the first vacant station and leaves a full or integrated unit untouched', async () => {
        const source = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, people: [...personnel.people, { id: 'reserve' }] }));
        source.policy.update(policy => ({ ...policy, positions: [{ positionId: 'pilot', label: 'Pilot' },
            { positionId: 'gunner', label: 'Gunner' }, { positionId: 'commander', label: 'Commander' }] }));
        const crew = TestBed.inject(CrewAssignmentService);
        const data: CrewDragData = { kind: 'force-person', force: source.force, personId: 'reserve' };
        await crew.dropOnUnit(source.force, data, 'unit');
        expect(source.assign).toHaveBeenCalledOnceWith('reserve', 'unit', 'gunner');
        source.policy.update(policy => ({ ...policy, positions: [policy.positions[0]] }));
        await crew.dropOnUnit(source.force, data, 'unit');
        source.policy.update(policy => ({ ...policy, kind: 'integrated' }));
        await crew.dropOnUnit(source.force, data, 'unit');
        expect(source.assign).toHaveBeenCalledTimes(1);
    });

    it('returns a transferred reserve to its source when target assignment fails', async () => {
        const source = ownerFixture();
        const target = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        target.personnel.set({ people: [], assignments: [] });
        target.assign.and.resolveTo(false);
        await TestBed.inject(CrewAssignmentService).dropOnUnit(target.force,
            { kind: 'force-person', force: source.force, personId: 'pilot' }, 'unit');
        expect(source.owner.transferReservePersonTo).toHaveBeenCalledOnceWith(target.force, 'pilot');
        expect(target.owner.transferReservePersonTo).toHaveBeenCalledOnceWith(source.force, 'pilot');
    });

    it('shows the entity-effective Piloting while retaining the personal rating in the tooltip', () => {
        const source = ownerFixture();
        source.owner.gameSystem = GameSystem.CBT;
        const entity = new ProtoMekEntity(createTestEquipmentRegistry());
        source.owner.members = () => [{ kind: 'cbt', id: 'unit', entity }] as never[];
        const fixture = TestBed.createComponent(ForceUnitCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'unit');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.crew-skills').textContent).toContain('/ P 5');
        expect(fixture.nativeElement.querySelector('.crew-main').title).toContain('personal Piloting 2');
        expect(source.personnel().people[0].piloting).toBe(2);
    });

    it('offers standard creation first, then reserves, with deletion and no notes', () => {
        const source = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        const fixture = TestBed.createComponent(PilotSelectorPanelComponent);
        fixture.componentRef.setInput('force', source.force);
        const selections: PilotSelection[] = [];
        fixture.componentInstance.selected.subscribe(selection => selections.push(selection));
        fixture.detectChanges();
        const options = fixture.nativeElement.querySelectorAll('button[role=option]') as NodeListOf<HTMLButtonElement>;
        expect(options[0].textContent).toContain('Create standard pilot');
        expect(options[1].textContent).toContain('Alex');
        options[0].click();
        (fixture.nativeElement.querySelector('.delete') as HTMLButtonElement).click();
        expect(selections).toEqual([{ kind: 'create' }, { kind: 'delete', personId: 'pilot' }]);
        expect(fixture.nativeElement.textContent).not.toContain('PRIVATE NOTES');
    });

    it('assigns the highlighted person after arrow navigation from a tab-focused option', () => {
        const source = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        const fixture = TestBed.createComponent(PilotSelectorPanelComponent);
        fixture.componentRef.setInput('force', source.force);
        const selections: PilotSelection[] = [];
        fixture.componentInstance.selected.subscribe(selection => selections.push(selection));
        fixture.detectChanges();
        const firstOption = fixture.nativeElement.querySelector('button[role=option]') as HTMLButtonElement;
        const search = fixture.nativeElement.querySelector('input') as HTMLInputElement;
        firstOption.focus();
        const arrow = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
        firstOption.dispatchEvent(arrow);
        fixture.detectChanges();
        expect(arrow.defaultPrevented).toBeTrue();
        expect(document.activeElement).toBe(search);
        expect(search.getAttribute('aria-activedescendant')).toBe(fixture.componentInstance.optionId(1));
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(selections).toEqual([{ kind: 'assign', personId: 'pilot' }]);
    });

    it('preserves caret and text-selection keys in the reserve search field', () => {
        const source = ownerFixture();
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        const fixture = TestBed.createComponent(PilotSelectorPanelComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.detectChanges();
        const search = fixture.nativeElement.querySelector('input') as HTMLInputElement;
        fixture.componentInstance.activeIndex.set(1);
        for (const key of ['Home', 'End']) {
            const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
            search.dispatchEvent(event);
            expect(event.defaultPrevented).toBeFalse();
        }
        const selection = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
        search.dispatchEvent(selection);
        expect(selection.defaultPrevented).toBeFalse();
        expect(fixture.componentInstance.activeIndex()).toBe(1);
    });

    it('stops a crew edit click from opening its parent unit row', () => {
        const source = ownerFixture();
        const fixture = TestBed.createComponent(ForceUnitCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'unit');
        fixture.detectChanges();
        const rowClick = jasmine.createSpy('parent row click');
        fixture.nativeElement.addEventListener('click', rowClick);
        (fixture.nativeElement.querySelector('.crew-main') as HTMLButtonElement).click();
        expect(rowClick).not.toHaveBeenCalled();
        expect(editor.editPerson).toHaveBeenCalledOnceWith(source.force, 'pilot');
        expect(fixture.debugElement.query(By.directive(CrewSlotComponent))).not.toBeNull();
    });
});
