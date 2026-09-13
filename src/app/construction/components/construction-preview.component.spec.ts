// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { Component, forwardRef, input, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SvgViewerLiteComponent } from '../../components/svg-viewer-lite/svg-viewer-lite.component';
import { UnitDetailsCardTabComponent } from '../../components/unit-details-dialog/tabs/unit-details-card-tab.component';
import type { BaseEntity } from '../../models/entity/base-entity';
import { TestBipedMekEntity } from '../../models/entity/testing/test-entities';
import type { UnitSummary } from '../../models/unit-summary.model';
import { OptionsService } from '../../services/options.service';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { ConstructionPreviewComponent } from './construction-preview.component';

@Component({
    selector: 'svg-viewer-lite', template: '',
    providers: [{ provide: SvgViewerLiteComponent, useExisting: forwardRef(() => SheetRendererStub) }],
})
class SheetRendererStub {
    readonly fluffImageUrl = input<string | null>();
    readonly unit = input<UnitSummary>();
    readonly nativeEntity = input<BaseEntity>();
    readonly paperSize = input<string>();
    readonly fitMode = input<'width' | 'page'>('width');
    readonly zoomable = input(false);
    readonly printPreview = input(false);
    readonly ready = signal(false);
    readonly loading = signal(true);
    readonly loadError = signal<string | null>(null);
    readonly zoomPercent = signal(100);
    readonly minZoomPercent = 100;
    readonly maxZoomPercent = 300;
    readonly isZoomPanActive = signal(false);
    readonly print = jasmine.createSpy('sheet.print').and.resolveTo();
    readonly downloadPng = jasmine.createSpy('sheet.downloadPng').and.resolveTo();
    setZoomPercent(value: number): void { this.zoomPercent.set(value); }
    resetZoom(): void { this.zoomPercent.set(100); }
}

@Component({
    selector: 'unit-details-card-tab', template: '',
    providers: [{ provide: UnitDetailsCardTabComponent, useExisting: forwardRef(() => CardRendererStub) }],
})
class CardRendererStub {
    readonly fluffImageUrl = input<string | null>();
    readonly unit = input<UnitSummary>();
}

describe('construction preview view and output controls', () => {
    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [ConstructionPreviewComponent],
            providers: [provideZonelessChangeDetection(),
                { provide: OptionsService, useValue: { options: signal({ printAllOptions: { paperSize: 'a4' } }) } }],
        }).overrideComponent(ConstructionPreviewComponent, {
            remove: { imports: [SvgViewerLiteComponent, UnitDetailsCardTabComponent] },
            add: { imports: [SheetRendererStub, CardRendererStub] },
        });
    });

    function create(type: UnitSummary['as']['TP'] = 'BM') {
        const fixture = TestBed.createComponent(ConstructionPreviewComponent);
        const entity = new TestBipedMekEntity();
        const unit = createEmptyUnit({ mul1id: null, isCustom: true, as: { TP: type } });
        fixture.componentRef.setInput('entity', entity);
        fixture.componentRef.setInput('unit', unit);
        fixture.componentRef.setInput('unsaved', true);
        fixture.detectChanges();
        return { fixture, preview: fixture.componentInstance, entity, unit };
    }

    it('passes the detached design to the sheet and disables output until generation completes', () => {
        const { fixture, preview, entity, unit } = create();
        const sheet = fixture.debugElement.query(By.directive(SheetRendererStub)).componentInstance as SheetRendererStub;
        expect(sheet.nativeEntity()).toBe(entity);
        expect(sheet.unit()).toBe(unit);
        expect(sheet.paperSize()).toBe('a4');
        expect(sheet.fitMode()).toBe('page');
        expect(sheet.zoomable()).toBeTrue();
        expect(preview.ready()).toBeFalse();
        expect(fixture.nativeElement.textContent).toContain('Generating record sheet');
        expect(fixture.nativeElement.querySelector('.preview-actions button').disabled).toBeTrue();
        sheet.loading.set(false);
        sheet.ready.set(true);
        fixture.detectChanges();
        expect(preview.ready()).toBeTrue();
        expect(fixture.nativeElement.querySelector('.preview-actions button').disabled).toBeFalse();
        expect(fixture.nativeElement.textContent).not.toContain('Generating record sheet');
    });

    it('shows sheet generation failures without enabling output', async () => {
        const { fixture, preview } = create();
        const sheet = fixture.debugElement.query(By.directive(SheetRendererStub)).componentInstance as SheetRendererStub;
        sheet.loading.set(false);
        sheet.loadError.set('This native sheet is unavailable');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('This native sheet is unavailable');
        await preview.output('print');
        expect(sheet.print).not.toHaveBeenCalled();
        expect(preview.working()).toBeNull();
    });

    it('requests strict sheet PNG export so preparation failures reach the preview alert', async () => {
        const { fixture, preview } = create();
        const sheet = fixture.debugElement.query(By.directive(SheetRendererStub)).componentInstance as SheetRendererStub;
        sheet.loading.set(false);
        sheet.ready.set(true);
        sheet.downloadPng.and.rejectWith(new Error('Record sheet PNG generation failed'));
        await preview.output('export');
        fixture.detectChanges();
        expect(sheet.downloadPng).toHaveBeenCalledOnceWith(true);
        expect(preview.working()).toBeNull();
        expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Record sheet PNG generation failed');
    });

    it('shows the current custom card without output controls', async () => {
        const { fixture, preview, unit } = create();
        preview.setView('card');
        fixture.detectChanges();
        const card = fixture.debugElement.query(By.directive(CardRendererStub)).componentInstance as CardRendererStub;
        expect(card.unit()).toBe(unit);
        expect(preview.ready()).toBeTrue();
        expect(fixture.debugElement.query(By.directive(SheetRendererStub))).toBeNull();
        expect(fixture.nativeElement.querySelector('.preview-actions')).toBeNull();
        await preview.output('print');
        await preview.output('export');
        expect(preview.actionError()).toBe('');
        expect(preview.working()).toBeNull();
    });

    it('keeps unsupported Alpha Strike types visible as an explanation without creating a card', async () => {
        const { fixture, preview } = create('XX');
        preview.setView('card');
        fixture.detectChanges();
        expect(preview.supportsCard()).toBeFalse();
        expect(preview.ready()).toBeFalse();
        expect(fixture.debugElement.query(By.directive(CardRendererStub))).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Alpha Strike cards are not available for this unit type');
        await preview.output('export');
        expect(preview.working()).toBeNull();
        preview.setView('sheet');
        fixture.detectChanges();
        expect(fixture.debugElement.query(By.directive(SheetRendererStub))).not.toBeNull();
    });

    it('reports output failures, unlocks the controls, and clears the error when switching views', async () => {
        const { fixture, preview } = create();
        const sheet = fixture.debugElement.query(By.directive(SheetRendererStub)).componentInstance as SheetRendererStub;
        sheet.loading.set(false);
        sheet.ready.set(true);
        sheet.downloadPng.and.rejectWith(new Error('PNG generation failed'));
        await preview.output('export');
        fixture.detectChanges();
        expect(preview.working()).toBeNull();
        expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('PNG generation failed');
        sheet.print.and.rejectWith(new Error('Print preparation failed'));
        await preview.output('print');
        expect(preview.actionError()).toBe('Print preparation failed');
        expect(preview.working()).toBeNull();
        preview.setView('card');
        fixture.detectChanges();
        expect(preview.actionError()).toBe('');
    });

    it('blocks duplicate exports and view controls while output is pending', async () => {
        const { fixture, preview } = create();
        const sheet = fixture.debugElement.query(By.directive(SheetRendererStub)).componentInstance as SheetRendererStub;
        sheet.loading.set(false);
        sheet.ready.set(true);
        let finish!: () => void;
        sheet.downloadPng.and.returnValue(new Promise<void>(resolve => { finish = resolve; }));
        const exporting = preview.output('export');
        fixture.detectChanges();
        expect(preview.working()).toBe('export');
        expect(fixture.nativeElement.querySelector('.preview-views button').disabled).toBeTrue();
        await preview.output('export');
        await preview.output('print');
        expect(sheet.downloadPng).toHaveBeenCalledOnceWith(true);
        expect(sheet.print).not.toHaveBeenCalled();
        finish();
        await exporting;
        expect(preview.working()).toBeNull();
    });
});
