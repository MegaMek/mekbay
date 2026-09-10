// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitNameService } from '../../services/unit-name.service';
import { Component, ChangeDetectionStrategy, signal, computed, effect, input, inject, viewChild, type ElementRef } from '@angular/core';

import type { UnitSummary } from '../../models/unit-summary.model';
import type { BaseEntity } from '../../models/entity/base-entity';
import { OptionsService } from '../../services/options.service';
import { LoggerService } from '../../services/logger.service';
import { SvgExportUtil } from '../../utils/svg-export.util';
import { UnitFluffImageService } from '../../services/catalogs/unit-fluff-image.service';
import { NativeEntityService } from '../../services/native-entity.service';
import { RecordSheetSourceService } from '../../services/record-sheet-source.service';
import type { PrintAllOptions } from '../../models/print-options.model';
import { printRecordSheetPages } from '../../utils/record-sheet-print.util';
import { SvgViewerZoomPan } from './svg-viewer-zoom-pan';

@Component({
    selector: 'svg-viewer-lite',
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './svg-viewer-lite.component.html',
    styleUrl: './svg-viewer-lite.component.css'
})
export class SvgViewerLiteComponent {
    readonly unitNames = inject(UnitNameService);
    logger = inject(LoggerService);
    private optionsService = inject(OptionsService);
    private readonly pipLayout = computed(() => this.optionsService.options().recordSheetPipLayout);
    private readonly showQuirks = computed(() => this.optionsService.options().CBTOptionalRules?.quirks !== false);
    private fluffImages = inject(UnitFluffImageService);
    private nativeEntities = inject(NativeEntityService);
    private recordSheets = inject(RecordSheetSourceService);

    unit = input<UnitSummary | null>(null);
    /** An admitted force design can differ from the latest catalog entry with the same UUID. */
    nativeEntity = input<BaseEntity | null>(null);
    readonly fluffImageUrl = input<string | null>();
    zoomable = input<boolean>(false);
    paperSize = input<PrintAllOptions['paperSize']>();
    private readonly sheetPaperSize = computed(() => this.paperSize() ?? this.optionsService.options().printAllOptions.paperSize);
    /** Fit the first full page at 100%, or retain the details viewer's fit-width behavior. */
    fitMode = input<'width' | 'page'>('width');

    private readonly loadingState = signal(false);
    private readonly loadErrorState = signal<string | null>(null);
    readonly loading = this.loadingState.asReadonly();
    readonly loadError = this.loadErrorState.asReadonly();

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');
    contentRef = viewChild.required<ElementRef<HTMLDivElement>>('content');

    private readonly zoomPan = new SvgViewerZoomPan(this.containerRef, this.contentRef, this.zoomable, this.fitMode);
    get minZoomPercent(): number {
        return this.zoomPan.minZoomPercent;
    }
    readonly maxZoomPercent = this.zoomPan.maxZoomPercent;
    readonly zoomPercent = this.zoomPan.zoomPercent;

    private svgs = signal<SVGSVGElement[]>([]);
    private svgsAttached = signal(false);
    readonly ready = computed(() => this.svgsAttached() && !this.loading() && this.svgs().length > 0);
    private sheetLoadGeneration = 0;

    // Reactive effect: load sheet when unit changes
    constructor() {
        effect(() => {
            const unit = this.nativeEntity() ?? this.unit();
            if (!unit) return;
            for (const svg of this.svgs()) this.unitNames.applyToRecordSheet(svg, unit);
        });
        effect((onCleanup) => {
            const loadGeneration = ++this.sheetLoadGeneration;
            onCleanup(() => {
                if (this.sheetLoadGeneration === loadGeneration) {
                    this.sheetLoadGeneration += 1;
                }
            });

            const u = this.unit();
            const nativeEntity = this.nativeEntity();
            const pipLayout = this.pipLayout();
            const showQuirks = this.showQuirks();
            const paperSize = this.sheetPaperSize();
            this.fluffImages.revision();
            const fluffImageUrl = this.fluffImageUrl();
            this.svgs.set([]);
            this.svgsAttached.set(false);
            this.loadingState.set(false);
            this.loadErrorState.set(null);
            this.cleanContainer();
            this.resetZoom();

            if (!nativeEntity && !u) return;
            if (!nativeEntity && !this.nativeEntities.canLoad(u!)) {
                this.loadErrorState.set('No native record sheet is available for this unit.');
                return;
            }
            this.loadingState.set(true);

            (async () => {
                try {
                    const entity = nativeEntity ?? (await this.nativeEntities.load(u!.uuid)).entity;
                    if (!this.isCurrentSheetLoad(loadGeneration)) return;
                    const sheets = await this.recordSheets.load(entity, { pipLayout, showQuirks, format: paperSize, pageFormat: paperSize, ...(fluffImageUrl === undefined ? {} : { fluffImageUrl }) }, {
                        design: u ? { provider: u.provider, uuid: u.uuid } : undefined,
                    });
                    if (!this.isCurrentSheetLoad(loadGeneration)) return;
                    if (sheets.svgs.length === 0) throw new Error('No record sheet pages were generated.');

                    const svgs = sheets.svgs.map(svg => {
                        svg.removeAttribute('id');
                        return svg;
                    });
                    this.svgs.set([...svgs]);
                    this.cleanContainer();
                    this.attachSvgs(loadGeneration);
                } catch (err) {
                    if (!this.isCurrentSheetLoad(loadGeneration)) return;

                    this.logger.error('svg-viewer-lite: failed to load sheet: ' + JSON.stringify(err));
                    this.svgs.set([]);
                    this.loadingState.set(false);
                    this.loadErrorState.set(err instanceof Error ? err.message : String(err));
                }
            })();
        });
        effect(() => {
            if (!this.svgsAttached()) return;
            const centerContent = this.optionsService.options().printAllOptions.recordSheetCenterPanelContent;
            const u = this.unit();
            const nativeEntity = this.nativeEntity();
            const fluffImageUrl = this.fluffImageUrl() === undefined ? (nativeEntity
                ? this.fluffImages.resolveEntityUrl(nativeEntity, u ? { provider: u.provider, uuid: u.uuid } : undefined)
                : this.fluffImages.resolveUrl(u)) : this.fluffImageUrl();
            if (!fluffImageUrl) return;
            for (const svg of this.svgs()) {
                if (svg.getElementById('fluff-image')) continue; // already present from the original sheet, we skip
                if (svg.getElementById('fluffImage')) continue; // already present from the original sheet, we skip
                if (centerContent === 'fluffImage') {
                    if (svg.getElementById('fluff-image-injected')) return; // already injected, we skip
                    this.injectFluffToSvg(svg, fluffImageUrl);
                } else {
                    svg.getElementById('fluff-image-injected')?.remove();
                    svg.querySelectorAll<SVGGraphicsElement>('.referenceTable').forEach((rt) => {
                        rt.style.display = 'block';
                    });
                }
            }
        });
    }

    private injectFluffToSvg(svg: SVGSVGElement, imageUrl: string) {
        const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
        if (referenceTables.length === 0) return; // We don't have a place where to put the fluff image
        // We calculate the width/height using all the reference tables and also the top/left most position
        
        const pt = svg.createSVGPoint();
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let topLeftElement: SVGGraphicsElement = referenceTables[0];
        referenceTables.forEach((rt: SVGGraphicsElement) => {
            const bbox = rt.getBBox();
            const ctm = rt.getCTM() ?? svg.getCTM() ?? new DOMMatrix();
            const corners = [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x, y: bbox.y + bbox.height },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
            ];
            let rtMinX = Number.POSITIVE_INFINITY;
            let rtMinY = Number.POSITIVE_INFINITY;
            let rtMaxX = Number.NEGATIVE_INFINITY;
            let rtMaxY = Number.NEGATIVE_INFINITY;
            for (const c of corners) {
                pt.x = c.x; pt.y = c.y;
                const p = pt.matrixTransform(ctm);
                rtMinX = Math.min(rtMinX, p.x);
                rtMinY = Math.min(rtMinY, p.y);
                rtMaxX = Math.max(rtMaxX, p.x);
                rtMaxY = Math.max(rtMaxY, p.y);
            }

            minX = Math.min(minX, rtMinX);
            minY = Math.min(minY, rtMinY);
            maxX = Math.max(maxX, rtMaxX);
            maxY = Math.max(maxY, rtMaxY);
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;
        // Determine parent to inject into (parent of top/left most referenceTable if available)
        let injectParent: ParentNode = svg;
        if (topLeftElement?.parentElement) {
            injectParent = topLeftElement.parentElement;
        }
        const parentCTM = injectParent instanceof SVGGraphicsElement ? injectParent.getCTM() : null;
        const invParent = parentCTM ? parentCTM.inverse() : new DOMMatrix();
        pt.x = minX; pt.y = minY;
        const localTL = pt.matrixTransform(invParent);
        pt.x = maxX; pt.y = maxY;
        const localBR = pt.matrixTransform(invParent);

        const localWidth = localBR.x - localTL.x;
        const localHeight = localBR.y - localTL.y;
        // We create an image element
        const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        img.setAttribute('id', 'fluff-image-injected');
        img.setAttribute('href', imageUrl);
        img.setAttribute('x', localTL.x.toString());
        img.setAttribute('y', localTL.y.toString());
        img.setAttribute('width', Math.max(0, localWidth).toString());
        img.setAttribute('height', Math.max(0, localHeight).toString());
        injectParent.appendChild(img);
        // We hide the reference tables
        referenceTables.forEach((rt) => {
            rt.style.display = 'none';
        });
    }

    private cleanContainer() {
        const content = this.contentRef().nativeElement;
        while (content.firstChild) content.removeChild(content.firstChild);
        this.svgsAttached.set(false);
    }

    private attachSvgs(loadGeneration: number) {
        if (!this.isCurrentSheetLoad(loadGeneration)) return;

        const svgs = this.svgs();
        if (!svgs || svgs.length === 0) return;
        const content = this.contentRef().nativeElement;
        for (const s of svgs) {
            s.classList.add('mekbay-sheet');
            s.style.pointerEvents = 'none';
            s.style.display = 'block';
            s.style.width = '100%';
            s.style.height = 'auto';
            content.appendChild(s);
        }        
        requestAnimationFrame(() => {
            if (!this.isCurrentSheetLoad(loadGeneration)) return;

            this.zoomPan.refreshLayout();
            this.svgsAttached.set(true);
            this.loadingState.set(false);
        });
    }

    private isCurrentSheetLoad(loadGeneration: number): boolean {
        return loadGeneration === this.sheetLoadGeneration;
    }

    isZoomPanActive(): boolean {
        return this.zoomPan.isZoomPanActive();
    }

    setZoomPercent(value: number): void {
        this.zoomPan.setZoomPercent(value);
    }

    resetZoom(): void {
        this.zoomPan.resetZoom();
    }

    async downloadPng(strict = false): Promise<void> {
        try {
            if (strict) this.requireReady();
            await SvgExportUtil.downloadPng(this.snapshotPages(), this.exportFileName());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to download PNG: ' + JSON.stringify(err));
            if (strict) throw err;
        }
    }
    
    async openPng(strict = false): Promise<void> {
        try {
            if (strict) this.requireReady();
            await SvgExportUtil.openPng(this.snapshotPages());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to open PNG: ' + JSON.stringify(err));
            if (strict) throw err;
        }
    }
    
    async copyPngToClipboard(): Promise<void> {
        try {
            this.requireReady();
            await SvgExportUtil.copyPngToClipboard(this.snapshotPages(), this.exportFileName());
        } catch (err) {
            this.logger.error('svg-viewer-lite: failed to copy PNG to clipboard: ' + JSON.stringify(err));
            throw err;
        }
    }

    /** Prints the displayed design without looking up or changing a force/catalog entry. */
    async print(): Promise<void> {
        this.requireReady();
        await printRecordSheetPages(this.svgs(), {
            paperSize: this.sheetPaperSize(),
            printMargin: this.optionsService.options().printAllOptions.printMargin,
        });
    }

    private requireReady(): void {
        if (!this.ready()) throw new Error(this.loadError() ?? 'The record sheet is not ready yet.');
    }

    private snapshotPages(): SVGSVGElement[] {
        return this.svgs().map(svg => svg.cloneNode(true) as SVGSVGElement);
    }

    private exportFileName(): string {
        const unit = this.unit();
        const name = this.unitNames.name(unit).replaceAll(' ', '-') || 'record-sheet';
        return name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'record-sheet';
    }
}
