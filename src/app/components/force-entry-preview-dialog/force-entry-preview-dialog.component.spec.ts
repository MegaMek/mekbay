import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { GameSystem } from '../../models/common.model';
import { LoadForceEntry } from '../../models/load-force-entry.model';
import type { Options } from '../../models/options.model';
import { DialogsService } from '../../services/dialogs.service';
import { ForceBuilderService } from '../../services/force-builder.service';
import { OptionsService } from '../../services/options.service';
import { ToastService } from '../../services/toast.service';
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
                { provide: ForceBuilderService, useValue: forceBuilderServiceStub },
                { provide: OptionsService, useValue: optionsServiceStub },
                { provide: ToastService, useValue: toastServiceStub },
            ],
        }).compileComponents();

        const fixture = TestBed.createComponent(ForceEntryPreviewDialogComponent);
        fixture.detectChanges();

        return { fixture };
    }

    async function waitForClampMeasurement() {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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
        expect(firstTileWidth).toBeGreaterThanOrEqual(86);
        expect(firstTileWidth).toBeLessThanOrEqual(92);
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

    it('shows a formatted note in the preview and lets it open and close with the chevron toggle', async () => {
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

    it('shows notes up to two lines inline without a chevron when no expansion is needed', async () => {
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

    it('treats a single wrapped line as expandable when it renders past two lines', async () => {
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
