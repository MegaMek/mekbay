// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceImportService } from '../../services/force-import.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { OptionsService } from '../../services/options.service';
import { ToastService } from '../../services/toast.service';
import { FormationInfoDialogComponent, type FormationInfoDialogData } from '../formation-info-dialog/formation-info-dialog.component';
import { ForcePreviewPanelComponent } from '../force-preview-panel/force-preview-panel.component';
import { ForceEntryPreviewDialogComponent } from './force-entry-preview-dialog.component';

describe('ForceEntryPreviewDialogComponent', () => {
    function createUnitEntries(count: number) {
        return Array.from({ length: count }, () => ({
            unit: undefined,
            destroyed: false,
        }));
    }

    function createForceEntry(overrides: Partial<LoadForceEntry> = {}): LoadForceEntry {
        return new LoadForceEntry({
            instanceId: 'force-1',
            name: 'Shared Force',
            type: GameSystem.CBT,
            groups: [],
            ...overrides,
        });
    }

    async function render(
        force: LoadForceEntry,
        config: {
            unitDisplayName?: Options['unitDisplayName'];
            unitDisplayNameOverride?: Options['unitDisplayName'];
        } = {},
    ) {
        const dialogsServiceStub = {
            createDialog: jasmine.createSpy('createDialog'),
        };

        const forceBuilderServiceStub = {
            loadedForces: signal([]),
            smartCurrentForce: jasmine.createSpy('smartCurrentForce').and.returnValue(null),
            loadForceEntry: jasmine.createSpy('loadForceEntry').and.resolveTo(true),
        };

        const optionsServiceStub = {
            options: signal({ unitDisplayName: config.unitDisplayName ?? 'chassisModel' }),
        };

        const toastServiceStub = {
            showToast: jasmine.createSpy('showToast'),
        };

        await TestBed.configureTestingModule({
            imports: [ForceEntryPreviewDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DialogRef, useValue: { close: jasmine.createSpy('close') } },
                {
                    provide: DIALOG_DATA,
                    useValue: {
                        force,
                        unitDisplayNameOverride: config.unitDisplayNameOverride,
                    },
                },
                { provide: DialogsService, useValue: dialogsServiceStub },
                { provide: ForceWorkspaceStateService, useValue: forceBuilderServiceStub },
                { provide: ForceImportService, useValue: forceBuilderServiceStub },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: ToastService, useValue: toastServiceStub },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceEntryPreviewDialogComponent);
        fixture.detectChanges();

        return { fixture, dialogsServiceStub };
    }

    it('shows LOAD, ADD, and DISMISS for owned forces', async () => {
        const { fixture } = await render(createForceEntry({ owned: true }));
        const nativeElement = fixture.nativeElement as HTMLElement;

        const buttonLabels = Array.from(nativeElement.querySelectorAll('button'))
            .map((button) => button.textContent?.trim());

        expect(buttonLabels).toEqual(['LOAD', 'ADD', 'DISMISS']);
    });

    it('shows only ADD and DISMISS for non-owned forces', async () => {
        const { fixture } = await render(createForceEntry({ owned: false }));
        const nativeElement = fixture.nativeElement as HTMLElement;

        const buttonLabels = Array.from(nativeElement.querySelectorAll('button'))
            .map((button) => button.textContent?.trim());

        expect(buttonLabels).toEqual(['ADD', 'DISMISS']);
    });

    it('forwards the unit display override to the preview panel', async () => {
        const { fixture } = await render(createForceEntry(), {
            unitDisplayName: 'alias',
            unitDisplayNameOverride: 'both',
        });

        const previewPanel = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .componentInstance as ForcePreviewPanelComponent;

        expect(previewPanel.displayMode()).toBe('both');
        expect(previewPanel.effectiveUnitDisplayName()).toBe('both');
    });

    it('opens the formation info dialog from preview group headings', async () => {
        const { fixture, dialogsServiceStub } = await render(createForceEntry({
            groups: [{
                name: 'First Group',
                formationId: 'battle-lance',
                units: createUnitEntries(4),
            }],
        }));
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;

        const formationInfoButton = previewHost.querySelector('.btn-formation-info') as HTMLButtonElement | null;

        expect(formationInfoButton).not.toBeNull();

        formationInfoButton?.click();
        fixture.detectChanges();

        expect(dialogsServiceStub.createDialog).toHaveBeenCalledTimes(1);
        const [component, dialogOptions] = dialogsServiceStub.createDialog.calls.mostRecent().args as [
            unknown,
            { data: FormationInfoDialogData },
        ];

        expect(component).toBe(FormationInfoDialogComponent);
        expect(dialogOptions.data.formation.id).toBe('battle-lance');
        expect(dialogOptions.data.gameSystem).toBe(GameSystem.CBT);
        expect(dialogOptions.data.formationDisplayName).toBe('Battle');
        expect(dialogOptions.data.unitCount).toBe(4);
    });

    it('pins the preview summary and scrolls the unit list inside the panel', async () => {
        const { fixture } = await render(createForceEntry());
        const previewDebugElement = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent));
        const previewPanel = previewDebugElement.componentInstance as ForcePreviewPanelComponent;
        const previewHost = previewDebugElement.nativeElement as HTMLElement;
        const previewShell = previewHost.querySelector('.force-preview-shell') as HTMLElement | null;

        expect(previewPanel.scrollUnitsOnly()).toBeTrue();
        expect(previewShell).not.toBeNull();
        expect(previewShell?.classList.contains('scroll-units-only')).toBeTrue();
    });

});
