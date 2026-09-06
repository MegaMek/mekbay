// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { GameSystem } from '../../models/common.model';
import type { Force } from '../../models/force.model';
import type { ForceSlot } from '../../models/force-slot.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceWorkspaceStateService } from '../../services/force-workspace-state.service';
import { ForceImportService } from '../../services/force-import.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { OptionsService } from '../../services/options.service';
import { ToastService } from '../../services/toast.service';
import { FormationInfoDialogComponent, type FormationInfoDialogData } from '../formation-info-dialog/formation-info-dialog.component';
import { ForcePreviewPanelComponent } from '../force-preview-panel/force-preview-panel.component';
import { ForceEntryPreviewDialogComponent } from './force-entry-preview-dialog.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { ForceAddModePickerDialogComponent } from '../force-add-mode-picker-dialog/force-add-mode-picker-dialog.component';

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
            loadedForces: signal<ForceSlot[]>([]),
            smartCurrentForce: jasmine.createSpy('smartCurrentForce').and.returnValue(null),
            loadForceEntry: jasmine.createSpy('loadForceEntry').and.resolveTo(true),
            removeLoadedForce: jasmine.createSpy('removeLoadedForce').and.resolveTo(),
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
                { provide: ForceBuilderService, useValue: forceBuilderServiceStub },
                { provide: ForceWorkspaceStateService, useValue: forceBuilderServiceStub },
                { provide: ForceImportService, useValue: forceBuilderServiceStub },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: ToastService, useValue: toastServiceStub },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceEntryPreviewDialogComponent);
        fixture.detectChanges();

        return { fixture, dialogsServiceStub, forceBuilderServiceStub, toastServiceStub };
    }

    async function waitForClampMeasurement() {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    it('appends one count-only Reserves display after unit groups', async () => {
        const force = createForceEntry({ groups: [{ name: 'Lance', units: createUnitEntries(2) }], reserveCount: 3 });
        const { fixture } = await render(force);
        const scroll = fixture.nativeElement.querySelector('.unit-scroll') as HTMLElement;
        const reserves = scroll.querySelector('force-reserves-preview')!;

        expect(scroll.lastElementChild).toBe(reserves);
        expect(reserves.querySelector('.group-name')?.textContent).toBe('Reserves');
        expect(reserves.querySelector('.reserve-count')?.textContent?.trim()).toBe('3');
        expect(reserves.querySelector('.reserve-count')?.getAttribute('aria-label')).toBe('3 people in reserve');
        expect(reserves.querySelectorAll('img').length).toBe(1);
        expect(reserves.querySelectorAll('button, input, unit-icon').length).toBe(0);
        expect(scroll.querySelectorAll('.unit-square').length).toBe(2);
        expect(force.groups.length).toBe(1);
    });

    it('shows reserves for a force with no units and uses a singular accessible label', async () => {
        const { fixture } = await render(createForceEntry({ reserveCount: 1 }));
        const reserves = fixture.nativeElement.querySelector('force-reserves-preview') as HTMLElement;

        expect(reserves.querySelector('.reserve-count')?.getAttribute('aria-label')).toBe('1 person in reserve');
        expect(reserves.querySelector('img')?.getAttribute('alt')).toBe('');
        expect(fixture.nativeElement.querySelectorAll('.unit-square').length).toBe(0);
    });

    it('omits the Reserves display when nobody is in reserve', async () => {
        const { fixture } = await render(createForceEntry());

        expect(fixture.nativeElement.querySelector('force-reserves-preview')).toBeNull();
    });

    it('shows DEPLOY and DISMISS for owned forces', async () => {
        const { fixture } = await render(createForceEntry({ owned: true }));
        const nativeElement = fixture.nativeElement as HTMLElement;

        const buttonLabels = Array.from(nativeElement.querySelectorAll('button'))
            .map((button) => button.textContent?.trim());

        expect(buttonLabels).toEqual(['DEPLOY', 'DISMISS']);
    });

    it('shows DEPLOY and DISMISS for non-owned forces', async () => {
        const { fixture } = await render(createForceEntry({ owned: false }));
        const nativeElement = fixture.nativeElement as HTMLElement;

        const buttonLabels = Array.from(nativeElement.querySelectorAll('button'))
            .map((button) => button.textContent?.trim());

        expect(buttonLabels).toEqual(['DEPLOY', 'DISMISS']);
    });

    function createLoadedSlot(instanceId: string): ForceSlot {
        return {
            force: { instanceId: signal(instanceId) } as unknown as Force,
            alignment: 'friendly',
            changeSub: null,
        };
    }

    it('deploys directly when no user forces are loaded and switches to RECALL', async () => {
        const force = createForceEntry();
        const { fixture, dialogsServiceStub, forceBuilderServiceStub } = await render(force);
        forceBuilderServiceStub.loadForceEntry.and.callFake(async () => {
            forceBuilderServiceStub.loadedForces.set([createLoadedSlot(force.instanceId)]);
            return true;
        });

        await fixture.componentInstance.onDeploy();
        fixture.detectChanges();

        expect(dialogsServiceStub.createDialog).not.toHaveBeenCalled();
        expect(forceBuilderServiceStub.loadForceEntry).toHaveBeenCalledOnceWith(force, 'load');
        expect(fixture.nativeElement.querySelector('.wide-dialog-actions button').textContent.trim()).toBe('RECALL');
        expect(TestBed.inject(DialogRef).close).not.toHaveBeenCalled();
    });

    it('offers replacement when forces are already deployed', async () => {
        const force = createForceEntry();
        const { fixture, dialogsServiceStub, forceBuilderServiceStub } = await render(force);
        forceBuilderServiceStub.loadedForces.set([createLoadedSlot('existing-force')]);
        dialogsServiceStub.createDialog.and.returnValue({ closed: of('replace') });

        await fixture.componentInstance.onDeploy();

        expect(dialogsServiceStub.createDialog).toHaveBeenCalledWith(ConfirmDialogComponent, jasmine.objectContaining({
            data: jasmine.objectContaining({
                title: 'Deploy Force',
                buttons: [
                    { label: 'REPLACE', value: 'replace' },
                    { label: 'ADD', value: 'add' },
                    { label: 'CANCEL', value: 'cancel' },
                ],
            }),
        }));
        expect(forceBuilderServiceStub.loadForceEntry).toHaveBeenCalledOnceWith(force, 'load');
    });

    for (const alignment of ['friendly', 'enemy'] as const) {
        it(`adds a ${alignment} force without replacing or activating it`, async () => {
            const force = createForceEntry();
            const { fixture, dialogsServiceStub, forceBuilderServiceStub } = await render(force);
            forceBuilderServiceStub.loadedForces.set([createLoadedSlot('existing-force')]);
            dialogsServiceStub.createDialog.and.returnValues({ closed: of('add') }, { closed: of(alignment) });

            await fixture.componentInstance.onDeploy();

            expect(dialogsServiceStub.createDialog.calls.argsFor(1)[0]).toBe(ForceAddModePickerDialogComponent);
            expect(forceBuilderServiceStub.loadForceEntry).toHaveBeenCalledOnceWith(force, 'add', alignment, { activate: false });
            expect(TestBed.inject(DialogRef).close).not.toHaveBeenCalled();
        });
    }

    for (const answers of [['cancel'], ['add', null]]) {
        it(`does not deploy when the ${answers.length === 1 ? 'deployment' : 'alignment'} picker is cancelled`, async () => {
            const { fixture, dialogsServiceStub, forceBuilderServiceStub } = await render(createForceEntry());
            forceBuilderServiceStub.loadedForces.set([createLoadedSlot('existing-force')]);
            dialogsServiceStub.createDialog.and.returnValues(...answers.map(answer => ({ closed: of(answer) })));

            await fixture.componentInstance.onDeploy();

            expect(forceBuilderServiceStub.loadForceEntry).not.toHaveBeenCalled();
            expect(fixture.componentInstance.busy()).toBeFalse();
        });
    }

    it('keeps DEPLOY available if loading fails', async () => {
        const { fixture, forceBuilderServiceStub, toastServiceStub } = await render(createForceEntry());
        forceBuilderServiceStub.loadForceEntry.and.resolveTo(false);

        await fixture.componentInstance.onDeploy();

        expect(fixture.componentInstance.isForceLoaded()).toBeFalse();
        expect(fixture.componentInstance.busy()).toBeFalse();
        expect(toastServiceStub.showToast).not.toHaveBeenCalled();
    });

    it('recalls only this force and switches back to DEPLOY', async () => {
        const { fixture, forceBuilderServiceStub } = await render(createForceEntry());
        const recalled = createLoadedSlot('force-1');
        const remaining = createLoadedSlot('force-2');
        forceBuilderServiceStub.loadedForces.set([remaining, recalled]);
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('.wide-dialog-actions button').textContent.trim()).toBe('RECALL');
        forceBuilderServiceStub.removeLoadedForce.and.callFake(async (force: Force) => {
            forceBuilderServiceStub.loadedForces.update(slots => slots.filter(slot => slot.force !== force));
        });

        await fixture.componentInstance.onRecall();
        fixture.detectChanges();

        expect(forceBuilderServiceStub.removeLoadedForce).toHaveBeenCalledOnceWith(recalled.force);
        expect(forceBuilderServiceStub.loadedForces()).toEqual([remaining]);
        expect(fixture.nativeElement.querySelector('.wide-dialog-actions button').textContent.trim()).toBe('DEPLOY');
    });

    it('keeps RECALL when the save prompt cancels removal', async () => {
        const { fixture, forceBuilderServiceStub, toastServiceStub } = await render(createForceEntry());
        forceBuilderServiceStub.loadedForces.set([createLoadedSlot('force-1')]);

        await fixture.componentInstance.onRecall();

        expect(fixture.componentInstance.isForceLoaded()).toBeTrue();
        expect(fixture.componentInstance.busy()).toBeFalse();
        expect(toastServiceStub.showToast).not.toHaveBeenCalled();
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
