// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { TestBed } from '@angular/core/testing';
import type { UnitSummary } from '../../models/unit-summary.model';
import { DataService } from '../../services/data.service';
import { DialogsService } from '../../services/dialogs.service';
import { GameService } from '../../services/game.service';
import { TagsService } from '../../services/tags.service';
import { TaggingService } from '../../services/tagging.service';
import { ToastService } from '../../services/toast.service';
import { UserStateService } from '../../services/userState.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { CollectionDialogComponent } from './collection-dialog.component';

describe('CollectionDialogComponent', () => {
    let units: UnitSummary[];

    beforeEach(async () => {
        units = [];

        await TestBed.configureTestingModule({
            imports: [CollectionDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: DataService,
                    useValue: {
                        getUnits: () => units,
                        tagsVersion: signal(0),
                    },
                },
                { provide: DialogsService, useValue: {} },
                { provide: GameService, useValue: {} },
                { provide: TagsService, useValue: { version: signal(0) } },
                { provide: TaggingService, useValue: {} },
                { provide: ToastService, useValue: {} },
                { provide: UserStateService, useValue: {} },
            ],
        }).compileComponents();
    });

    function selectOrganization(component: CollectionDialogComponent, organizationUnits: UnitSummary[]): void {
        const counts = new Map<string, number>();
        for (const unit of organizationUnits) {
            counts.set(`name:${unit.name}`, 1);
            counts.set(`chassis:${TagsService.getChassisTagKey(unit)}`, 1);
        }

        component.selectedOrganizationId.set('test-organization');
        component.organizationUnitCounts.set(counts);
    }

    it('places untagged TO&E units after tagged entries with a separator', () => {
        const nameTagged = createEmptyUnit({
            name: 'Alpha A-1',
            chassis: 'Alpha',
            model: 'A-1',
            _nameTags: [{ tag: 'Owned', quantity: 1 }],
        });
        const chassisTagged = createEmptyUnit({
            name: 'Bravo B-1',
            chassis: 'Bravo',
            model: 'B-1',
            _chassisTags: [{ tag: 'Reserve', quantity: 1 }],
        });
        const untagged = createEmptyUnit({
            name: 'Charlie C-1',
            chassis: 'Charlie',
            model: 'C-1',
        });
        const secondUntagged = createEmptyUnit({
            name: 'Delta D-1',
            chassis: 'Delta',
            model: 'D-1',
        });
        const outsideOrganization = createEmptyUnit({
            name: 'Echo E-1',
            chassis: 'Echo',
            model: 'E-1',
        });
        units = [nameTagged, chassisTagged, untagged, secondUntagged, outsideOrganization];

        const fixture = TestBed.createComponent(CollectionDialogComponent);
        const component = fixture.componentInstance;
        selectOrganization(component, [nameTagged, chassisTagged, untagged, secondUntagged]);
        fixture.detectChanges();

        expect(component.filterableRows().map(row => ({ title: row.title, tags: row.tags.length }))).toEqual([
            { title: 'Alpha A-1', tags: 1 },
            { title: 'Bravo', tags: 1 },
            { title: 'Charlie C-1', tags: 0 },
            { title: 'Delta D-1', tags: 0 },
        ]);
        expect(component.firstUntaggedRowKey()).toBe(`name:${untagged.name}`);

        const separator = fixture.nativeElement.querySelector('.untagged-separator') as HTMLElement;
        expect(separator.querySelector('.untagged-separator-label')?.textContent?.trim()).toBe('UNTAGGED UNITS');
        expect(fixture.nativeElement.querySelectorAll('.collection-row .tag-list').length).toBe(2);

        component.selectedRows.set(new Set([`name:${nameTagged.name}`]));
        const selectAllUntagged = separator.querySelector('.untagged-select-all-control input') as HTMLInputElement;
        selectAllUntagged.checked = true;
        selectAllUntagged.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        expect(component.selectedRows()).toEqual(new Set([
            `name:${nameTagged.name}`,
            `name:${untagged.name}`,
            `name:${secondUntagged.name}`,
        ]));
        expect(component.allVisibleUntaggedSelected()).toBeTrue();

        selectAllUntagged.checked = false;
        selectAllUntagged.dispatchEvent(new Event('change'));
        fixture.detectChanges();

        expect(component.selectedRows()).toEqual(new Set([`name:${nameTagged.name}`]));

        component.unitTextFilter.set('Charlie');
        fixture.detectChanges();

        expect(component.showUntaggedSeparator()).toBeFalse();
        expect(fixture.nativeElement.querySelector('.untagged-separator')).toBeNull();
        expect(fixture.nativeElement.querySelector('.untagged-select-all-control')).toBeNull();
    });

    it('keeps a specific tag filter strict when a TO&E contains untagged units', () => {
        const tagged = createEmptyUnit({
            name: 'Alpha A-1',
            chassis: 'Alpha',
            model: 'A-1',
            _nameTags: [{ tag: 'Owned', quantity: 1 }],
        });
        const untagged = createEmptyUnit({
            name: 'Charlie C-1',
            chassis: 'Charlie',
            model: 'C-1',
        });
        units = [tagged, untagged];

        const fixture = TestBed.createComponent(CollectionDialogComponent);
        const component = fixture.componentInstance;
        selectOrganization(component, units);
        component.tagFilter.set('Owned');
        fixture.detectChanges();

        expect(component.filteredRows().map(row => row.title)).toEqual(['Alpha A-1']);
        expect(component.firstUntaggedRowKey()).toBe('');
        expect(fixture.nativeElement.querySelector('.untagged-separator')).toBeNull();
    });
});
