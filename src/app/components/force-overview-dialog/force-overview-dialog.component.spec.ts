// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Force } from '../../models/force.model';
import { GameSystem } from '../../models/common.model';
import { AsAbilityLookupService } from '../../services/as-ability-lookup.service';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { LayoutService } from '../../services/layout.service';
import { OptionsService } from '../../services/options.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { ForceOverviewDialogComponent } from './force-overview-dialog.component';

describe('ForceOverviewDialogComponent', () => {
    const force = {
        gameSystem: GameSystem.CLASSIC,
        note: '',
        readOnly: signal(false),
        groups: signal([]),
        units: signal([]),
    } as unknown as Force;
    const options = signal({
        forceOverviewViewMode: 'table' as const,
        forceViewerBVPVDisplay: 'both' as const,
        ASUseHex: false,
    });

    beforeEach(async () => {
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
});
