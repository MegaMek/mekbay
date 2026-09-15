// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Force, UnitGroup } from '../../models/force.model';
import type { ForceMember } from '../../models/force-member.model';
import { GameSystem } from '../../models/common.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { ForceDialogsService } from '../../services/force-dialogs.service';
import { ForceFormationService } from '../../services/force-formation.service';
import { ForcePilotEditorService } from '../../services/force-pilot-editor.service';
import { ForceWorkspaceCommandsService } from '../../services/force-workspace-commands.service';
import { GameService } from '../../services/game.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { ForceOverviewDialogComponent } from './force-overview-dialog.component';

describe('ForceOverviewDialogComponent', () => {
  const forceMembers = signal<ForceMember[]>([]);
  const force = {
    gameSystem: GameSystem.CBT,
    note: '',
    readOnly: signal(false),
    groups: signal([]),
    members: forceMembers,
    faction: signal(null),
    era: signal(null),
    personnel: () => ({ people: [], assignments: [] }),
    canEditPersonnel: () => true,
    membersInGroup: () => forceMembers(),
    displayName: () => 'Test Force',
    hasMaxGroups: () => false,
  } as unknown as Force;
  const options = signal({
    forceOverviewViewMode: 'table' as const,
    forceViewerBVPVDisplay: 'both' as const,
    ASUseHex: false,
  });

  beforeEach(async () => {
    forceMembers.set([]);
    force.groups.set([]);
    await TestBed.configureTestingModule({
      imports: [ForceOverviewDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DIALOG_DATA, useValue: { force } },
        { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: LayoutService, useValue: { isTouchInput: () => false } },
        { provide: DataService, useValue: {} },
        { provide: DialogsService, useValue: {} },
        { provide: ForceBuilderService, useValue: {} },
        { provide: ForceDialogsService, useValue: {} },
        { provide: ForceFormationService, useValue: {} },
        { provide: ForcePilotEditorService, useValue: {} },
        { provide: ForceWorkspaceCommandsService, useValue: {} },
        { provide: GameService, useValue: {} },
        { provide: ToastService, useValue: {} },
        {
          provide: OptionsService,
          useValue: {
            options,
            setOption: jasmine.createSpy('setOption').and.resolveTo(),
          },
        },
        { provide: AsAbilityLookupService, useValue: {} },
        { provide: TaggingService, useValue: {} },
      ],
    }).compileComponents();
  });

  it('keeps a usable table viewport when switching from crew rows, including on re-entry', async () => {
    force.groups.set([
      { id: 'group', groupDisplayName: () => 'Test Lance', activeFormation: () => null },
    ] as unknown as UnitGroup[]);
    const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
    const component = fixture.componentInstance;
    component.activeTab.set('units');
    const root = fixture.nativeElement as HTMLElement;
    root.style.cssText = 'position: fixed; inset: 0; width: 1000px; height: 600px;';
    fixture.detectChanges();
    await fixture.whenStable();

    for (let visit = 0; visit < 2; visit++) {
      component.viewMode.set('compact');
      fixture.detectChanges();
      component.viewMode.set('table');
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const viewport = root.querySelector<HTMLElement>('.mb-data-table-viewport')!;
      expect(viewport.clientHeight)
        .withContext('Table body must occupy the available dialog height')
        .toBeGreaterThan(200);
      expect(root.querySelector('.mb-data-table-header')?.textContent).toContain('G/P');
      expect(viewport.textContent).toContain('Test Lance');
    }
  });

  describe('columns and selection', () => {
    beforeEach(() => {
      TestBed.overrideComponent(ForceOverviewDialogComponent, {
        set: {
          template: `
                        <ng-template #tableIconCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableNameCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableYearCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableValueCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableSkillCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableMovementCell let-row>{{ row.kind }}</ng-template>
                        <ng-template #tableSpecialsCell let-row>{{ row.kind }}</ng-template>
                    `,
        },
      });
    });

    it('keeps persisted table mode and builds CBT unit columns', () => {
      const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
      fixture.detectChanges();

      const component = fixture.componentInstance;
      const columns = component.forceTableColumns();
      const bvIndex = columns.findIndex((column) => column.id === 'bv');

      expect(component.gameSystem()).toBe(GameSystem.CBT);
      expect(component.isTableMode()).toBeTrue();
      expect(columns.map((column) => column.id)).toEqual([
        'icon',
        'name',
        'type',
        'subtype',
        'role',
        'bv',
        'skill',
        'tons',
        'year',
        'rules',
        'tech',
        'movement',
        'armor',
        'structure',
        'firepower',
        'damage-per-turn',
        'network',
        'cost',
      ]);
      expect(columns[bvIndex + 1]).toEqual(
        jasmine.objectContaining({
          id: 'skill',
          header: 'G/P',
        }),
      );
    });

    it('toggles individual units and supports select all and clear', () => {
      const first = { id: 'unit-1', getSummary: () => ({}) } as unknown as ForceMember;
      const second = { id: 'unit-2', getSummary: () => ({}) } as unknown as ForceMember;
      forceMembers.set([first, second]);

      const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;

      component.toggleUnitSelection(first);
      expect(component.selectedUnitCount()).toBe(1);
      expect(component.isUnitSelected(first)).toBeTrue();
      expect(component.isUnitSelected(second)).toBeFalse();

      component.toggleUnitSelection(second);
      expect(component.selectedUnitCount()).toBe(2);

      component.toggleUnitSelection(first);
      expect(component.selectedUnitCount()).toBe(1);
      expect(component.isUnitSelected(first)).toBeFalse();

      component.selectAllUnits();
      expect(component.selectedUnitCount()).toBe(2);

      component.clearUnitSelection();
      expect(component.selectedUnitCount()).toBe(0);
    });

    it('selects units through expanded-card and table interaction handlers', () => {
      const forceUnit = { id: 'unit-1', getSummary: () => ({}) } as unknown as ForceMember;
      forceMembers.set([forceUnit]);

      const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const vm = component.units()[0];
      const group = {} as UnitGroup;

      component.onUnitClick(vm, new MouseEvent('click', { ctrlKey: true }));
      expect(component.isUnitSelected(forceUnit)).toBeTrue();

      component.clearUnitSelection();
      component.onForceTableRowClick({
        row: { kind: 'unit', vm, group },
        index: 0,
        event: new MouseEvent('click', { ctrlKey: true }),
      });
      expect(component.isUnitSelected(forceUnit)).toBeTrue();

      component.clearUnitSelection();
      component.onForceTableRowLongPress({
        row: { kind: 'unit', vm, group },
        index: 0,
        event: new PointerEvent('pointerdown'),
      });
      expect(component.isUnitSelected(forceUnit)).toBeTrue();
    });

    it('skips the removal confirmation for Ctrl or Cmd clicks', async () => {
      const forceUnit = { id: 'unit-1', getSummary: () => ({}) } as unknown as ForceMember;
      forceMembers.set([forceUnit]);
      const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
      fixture.detectChanges();
      const removeUnit = jasmine.createSpy('removeUnit').and.resolveTo();
      Object.assign(TestBed.inject(ForceWorkspaceCommandsService), { removeUnit });

      for (const [event, skipConfirmation] of [
        [new MouseEvent('click', { ctrlKey: true }), true],
        [new MouseEvent('click', { metaKey: true }), true],
        [new MouseEvent('click'), false],
      ] as const) {
        removeUnit.calls.reset();
        await fixture.componentInstance.removeUnit(event, forceUnit);
        expect(removeUnit)
          .withContext(`ctrl=${event.ctrlKey} meta=${event.metaKey}`)
          .toHaveBeenCalledWith(forceUnit, skipConfirmation);
      }
    });

    it('clears selection when switching to compact reordering mode', () => {
      const forceUnit = { id: 'unit-1', getSummary: () => ({}) } as unknown as ForceMember;
      forceMembers.set([forceUnit]);

      const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
      fixture.detectChanges();
      const component = fixture.componentInstance;

      component.toggleUnitSelection(forceUnit);
      component.toggleViewMode();

      expect(component.viewMode()).toBe('compact');
      expect(component.selectedUnitCount()).toBe(0);
      expect(component.canDragDrop()).toBeTrue();
    });
  });
});
