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
        gameSystem: GameSystem.CLASSIC,
        note: '',
        readOnly: signal(false),
        groups: signal([]),
        members: forceMembers,
        faction: signal(null),
        era: signal(null),
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
        await TestBed.configureTestingModule({
            imports: [ForceOverviewDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DIALOG_DATA, useValue: { force } },
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                { provide: LayoutService, useValue: {} },
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
        })
            .overrideComponent(ForceOverviewDialogComponent, {
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
            })
            .compileComponents();
    });

    it('keeps persisted table mode and builds Classic unit columns', () => {
        const fixture = TestBed.createComponent(ForceOverviewDialogComponent);
        fixture.detectChanges();

        const component = fixture.componentInstance;
        const columns = component.forceTableColumns();
        const bvIndex = columns.findIndex(column => column.id === 'bv');

        expect(component.gameSystem()).toBe(GameSystem.CLASSIC);
        expect(component.isTableMode()).toBeTrue();
        expect(columns.map(column => column.id)).toEqual([
            'icon', 'name', 'type', 'subtype', 'role', 'bv', 'skill', 'tons', 'year',
            'rules', 'tech', 'movement', 'armor', 'structure', 'firepower',
            'damage-per-turn', 'network', 'cost',
        ]);
        expect(columns[bvIndex + 1]).toEqual(jasmine.objectContaining({
            id: 'skill',
            header: 'G/P',
        }));
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
