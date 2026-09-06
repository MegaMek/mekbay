// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
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

    it('routes a person drop to the atomic owner API and rejects another force', async () => {
        const source = ownerFixture();
        const fixture = TestBed.createComponent(CrewSlotComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('unitId', 'target');
        fixture.componentRef.setInput('positionId', 'pilot');
        fixture.detectChanges();
        const drag = { data: { kind: 'force-person', force: source.force, personId: 'pilot' } as CrewDragData };
        fixture.componentInstance.drop({ item: drag } as CdkDragDrop<unknown, unknown, CrewDragData>);
        await fixture.whenStable();
        expect(source.assign).toHaveBeenCalledOnceWith('pilot', 'target', 'pilot');
        fixture.componentInstance.drop({ item: { data: { ...drag.data, force: ownerFixture().force } } } as CdkDragDrop<unknown, unknown, CrewDragData>);
        expect(source.assign).toHaveBeenCalledTimes(1);
        fixture.destroy();
        expect(TestBed.inject(CrewAssignmentService).connectedDropLists(source.force)).toEqual([]);
    });

    it('renders and connects only occupied reserves, packing them into icon buttons', () => {
        const source = ownerFixture();
        const fixture = TestBed.createComponent(ForceReserveCrewComponent);
        fixture.componentRef.setInput('force', source.force);
        fixture.componentRef.setInput('layout', 'compact');
        fixture.detectChanges();
        const crew = TestBed.inject(CrewAssignmentService);
        expect(fixture.nativeElement.querySelector('section')).toBeNull();
        expect(crew.connectedDropLists(source.force)).toEqual([]);
        source.personnel.update(personnel => ({ ...personnel, assignments: [] }));
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('section')).not.toBeNull();
        expect(crew.connectedDropLists(source.force)).toEqual([fixture.componentInstance.dropId]);
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
        expect(crew.connectedDropLists(source.force)).toEqual([]);
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
