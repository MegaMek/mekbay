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
            type: GameSystem.CLASSIC,
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
            hasUserLoadedForces: jasmine.createSpy('hasUserLoadedForces').and.returnValue(false),
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
        forceBuilderServiceStub.hasUserLoadedForces.and.returnValue(true);
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
            forceBuilderServiceStub.hasUserLoadedForces.and.returnValue(true);
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
            forceBuilderServiceStub.hasUserLoadedForces.and.returnValue(true);
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
        expect(dialogOptions.data.gameSystem).toBe(GameSystem.CLASSIC);
        expect(dialogOptions.data.formationDisplayName).toBe('Battle');
        expect(dialogOptions.data.unitCount).toBe(4);
    });

    it('pins the preview summary and scrolls the unit list inside the panel', async () => {
        const { fixture } = await render(createForceEntry());
        const nativeElement = fixture.nativeElement as HTMLElement;
        const previewDebugElement = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent));
        const previewPanel = previewDebugElement.componentInstance as ForcePreviewPanelComponent;
        const previewHost = previewDebugElement.nativeElement as HTMLElement;
        const dialogBody = nativeElement.querySelector('.wide-dialog-body') as HTMLElement | null;
        const previewShell = previewHost.querySelector('.force-preview-shell') as HTMLElement | null;
        const forcePreview = previewHost.querySelector('.force-preview') as HTMLElement | null;
        const unitScroll = previewHost.querySelector('.unit-scroll') as HTMLElement | null;

        expect(previewPanel.scrollUnitsOnly()).toBeTrue();
        expect(dialogBody).not.toBeNull();
        expect(previewShell).not.toBeNull();
        expect(forcePreview).not.toBeNull();
        expect(unitScroll).not.toBeNull();
        expect(getComputedStyle(dialogBody!).overflowY).toBe('hidden');
        expect(getComputedStyle(previewHost).display).toBe('flex');
        expect(previewShell?.classList.contains('scroll-units-only')).toBeTrue();
        expect(getComputedStyle(previewShell!).display).toBe('flex');
        expect(getComputedStyle(forcePreview!).overflowY).toBe('auto');
        expect(getComputedStyle(unitScroll!).overflowY).toBe('visible');
    });

    it('keeps unit tile widths consistent across wrapped rows within the compact size cap', async () => {
        const { fixture } = await render(createForceEntry({
            groups: [{
                name: 'Command Force',
                units: createUnitEntries(20),
            }],
        }));
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;
        const units = previewHost.querySelector('.units') as HTMLElement | null;
        const unitTiles = Array.from(previewHost.querySelectorAll('.unit-tile')) as HTMLElement[];
        const unitSquares = Array.from(previewHost.querySelectorAll('.unit-square.compact-mode')) as HTMLElement[];
        const firstTileWidth = parseFloat(getComputedStyle(unitTiles[0]).width);
        const lastTileWidth = parseFloat(getComputedStyle(unitTiles[unitTiles.length - 1]).width);

        expect(units).not.toBeNull();
        expect(unitTiles.length).toBe(20);
        expect(unitSquares.length).toBe(20);
        expect(getComputedStyle(units!).display).toBe('grid');
        expect(Math.abs(firstTileWidth - lastTileWidth)).toBeLessThan(0.1);
        expect(getComputedStyle(unitSquares[0]).width).toBe(getComputedStyle(unitTiles[0]).width);
    });

    it('stretches tiles in the same row to the tallest compact square height', async () => {
        const { fixture } = await render(createForceEntry({
            groups: [{
                name: 'Battle Force',
                units: [
                    { unit: undefined, destroyed: false, alias: 'SAFFIRON JARRIL POLUTAR' },
                    { unit: undefined, destroyed: false, alias: 'Alpha Wolf' },
                ],
            }],
        }), {
            unitDisplayNameOverride: 'alias',
        });
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;
        const units = previewHost.querySelector('.units') as HTMLElement | null;
        const unitTiles = Array.from(previewHost.querySelectorAll('.unit-tile')) as HTMLElement[];
        const unitSquares = Array.from(previewHost.querySelectorAll('.unit-square.compact-mode')) as HTMLElement[];
        const firstTileHeight = unitTiles[0].getBoundingClientRect().height;
        const secondTileHeight = unitTiles[1].getBoundingClientRect().height;
        const firstSquareHeight = unitSquares[0].getBoundingClientRect().height;
        const secondSquareHeight = unitSquares[1].getBoundingClientRect().height;

        expect(units).not.toBeNull();
        expect(unitTiles.length).toBe(2);
        expect(unitSquares.length).toBe(2);
        expect(getComputedStyle(units!).alignItems).toBe('stretch');
        expect(getComputedStyle(unitTiles[0]).alignSelf).toBe('stretch');
        expect(getComputedStyle(unitSquares[0]).flexGrow).toBe('1');
        expect(Math.abs(firstTileHeight - secondTileHeight)).toBeLessThan(0.5);
        expect(Math.abs(firstSquareHeight - secondSquareHeight)).toBeLessThan(0.5);
    });

    xit('shows a formatted note in the preview and lets it open and close with the chevron toggle', async () => {
        const note = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n');
        const { fixture } = await render(createForceEntry({ note }));
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;

        fixture.detectChanges();
        await waitForClampMeasurement();
        fixture.detectChanges();

        const toggleButton = previewHost.querySelector('.force-preview-note-toggle') as HTMLButtonElement | null;
        const collapsedChevron = toggleButton?.querySelector('.chevron') as SVGElement | null;
        const noteSummary = previewHost.querySelector('.force-preview-note-summary') as HTMLElement | null;
        const collapsedLineHeight = noteSummary ? Number.parseFloat(getComputedStyle(noteSummary).lineHeight) : 0;
        const collapsedHeight = noteSummary?.getBoundingClientRect().height ?? 0;

        expect(toggleButton).not.toBeNull();
        expect(noteSummary?.textContent).toContain('Line 1');
        expect(noteSummary?.textContent).toContain('Line 10');
        expect(noteSummary?.classList.contains('clamped')).toBeTrue();
        expect(collapsedHeight).toBeLessThanOrEqual((collapsedLineHeight * 2) + 1);
        expect(toggleButton?.getAttribute('aria-expanded')).toBe('false');
        expect(collapsedChevron?.classList.contains('collapsed')).toBeTrue();

        toggleButton?.click();
        fixture.detectChanges();
        await waitForClampMeasurement();
        fixture.detectChanges();

        const expandedSummary = previewHost.querySelector('.force-preview-note-summary') as HTMLElement | null;
        const expandedChevron = previewHost.querySelector('.force-preview-note-toggle .chevron') as SVGElement | null;
        const expandedHeight = expandedSummary?.getBoundingClientRect().height ?? 0;

        expect(expandedSummary).not.toBeNull();
        expect(expandedSummary?.classList.contains('clamped')).toBeFalse();
        expect(expandedSummary?.textContent).toContain('Line 1');
        expect(expandedSummary?.textContent).toContain('Line 10');
        expect(getComputedStyle(expandedSummary!).whiteSpace).toBe('pre-wrap');
        expect(expandedHeight).toBeGreaterThan(collapsedHeight + 1);
        expect((previewHost.querySelector('.force-preview-note-toggle') as HTMLButtonElement | null)?.getAttribute('aria-expanded')).toBe('true');
        expect(expandedChevron?.classList.contains('collapsed')).toBeFalse();

        (previewHost.querySelector('.force-preview-note-toggle') as HTMLButtonElement | null)?.click();
        fixture.detectChanges();
        await waitForClampMeasurement();
        fixture.detectChanges();

        const recollapsedSummary = previewHost.querySelector('.force-preview-note-summary') as HTMLElement | null;

        expect(recollapsedSummary?.classList.contains('clamped')).toBeTrue();
        expect(recollapsedSummary?.getBoundingClientRect().height ?? 0).toBeLessThanOrEqual((collapsedLineHeight * 2) + 1);
    });

    xit('shows notes up to two lines inline without a chevron when no expansion is needed', async () => {
        const note = 'Line 1\nLine 2';
        const { fixture } = await render(createForceEntry({ note }));
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;

        fixture.detectChanges();
        await waitForClampMeasurement();
        fixture.detectChanges();

        const staticNote = previewHost.querySelector('.force-preview-note-static') as HTMLElement | null;
        const noteSummary = previewHost.querySelector('.force-preview-note-summary') as HTMLElement | null;

        expect(staticNote).not.toBeNull();
        expect(noteSummary?.textContent).toContain('Line 1');
        expect(noteSummary?.textContent).toContain('Line 2');
        expect(previewHost.querySelector('.force-preview-note-toggle')).toBeNull();
        expect(previewHost.querySelector('.chevron')).toBeNull();
    });

    xit('treats a single wrapped line as expandable when it renders past two lines', async () => {
        const note = 'This is a single very long line that should wrap past two rendered lines when the preview is narrow enough. '.repeat(6).trim();
        const { fixture } = await render(createForceEntry({ note }));
        const previewHost = fixture.debugElement.query(By.directive(ForcePreviewPanelComponent))
            .nativeElement as HTMLElement;

        previewHost.style.display = 'block';
        previewHost.style.width = '180px';
        fixture.detectChanges();
        await waitForClampMeasurement();
        fixture.detectChanges();

        const toggleButton = previewHost.querySelector('.force-preview-note-toggle') as HTMLButtonElement | null;
        const noteSummary = previewHost.querySelector('.force-preview-note-summary') as HTMLElement | null;
        const lineHeight = noteSummary ? Number.parseFloat(getComputedStyle(noteSummary).lineHeight) : 0;

        expect(toggleButton).not.toBeNull();
        expect(noteSummary?.classList.contains('clamped')).toBeTrue();
        expect(noteSummary?.getBoundingClientRect().height ?? 0).toBeLessThanOrEqual((lineHeight * 2) + 1);
    });
});
