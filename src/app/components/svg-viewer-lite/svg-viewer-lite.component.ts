import { Component, ChangeDetectionStrategy, signal, effect, input, inject, viewChild, ElementRef } from '@angular/core';

import { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';
import { OptionsService } from '../../services/options.service';
import { LoggerService } from '../../services/logger.service';

@Component({
    selector: 'svg-viewer-lite',
    standalone: true,
    imports: [],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './svg-viewer-lite.component.html',
    styleUrls: ['./svg-viewer-lite.component.css']
})
export class SvgViewerLiteComponent {
    logger = inject(LoggerService);
    private dataService = inject(DataService);
    private optionsService = inject(OptionsService);

    unit = input<Unit | null>(null);

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');

    private svgs = signal<SVGSVGElement[]>([]);
    private svgsAttached = signal(false);

    // Reactive effect: load sheet when unit changes
    constructor() {
        effect(() => {
            const u = this.unit();
            this.svgs.set([]);
            this.svgsAttached.set(false)

            if (!u || !u.sheets || u.sheets.length === 0) return;

            (async () => {
                try {
                    const svgs: SVGSVGElement[] = [];
                    for (const sheetName of u.sheets) {
                        const svg = await this.dataService.getSheet(sheetName);
                        const cloned = svg.cloneNode(true) as SVGSVGElement;
                        cloned.removeAttribute('id');
                        svgs.push(cloned);
                    }
                    this.svgs.set([...this.svgs(), ...svgs]);
                    this.cleanContainer();
                    this.attachSvgs();
                } catch (err) {
                    this.logger.error('svg-viewer-lite: failed to load sheet: ' + JSON.stringify(err));
                    this.svgs.set([]);
                }
            })();
        });
        effect(() => {
            if (!this.svgsAttached()) return;
            const centerContent = this.optionsService.options().recordSheetCenterPanelContent;
            const fluffImage = this.unit()?.fluff?.img;
            if (!fluffImage) return; // no fluff image to inject
            if (fluffImage.endsWith('hud.png')) return;
            for (const svg of this.svgs()) {
                if (svg.getElementById('fluff-image')) continue; // already present from the original sheet, we skip
                if (svg.getElementById('fluffImage')) continue; // already present from the original sheet, we skip
                if (centerContent === 'fluffImage') {
                    if (svg.getElementById('fluff-image-injected')) return; // already injected, we skip
                    const fluffImageUrl = `https://db.mekbay.com/images/fluff/${fluffImage}`;
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
        const parentCTM = (injectParent as any).getCTM ? (injectParent as SVGGraphicsElement).getCTM() : null;
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
        const container = this.containerRef().nativeElement;
        while (container.firstChild) container.removeChild(container.firstChild);
        this.svgsAttached.set(false);
    }

    private attachSvgs() {
        const svgs = this.svgs();
        if (!svgs || svgs.length === 0) return;
        const container = this.containerRef().nativeElement;
        for (const s of svgs) {
            s.classList.add('mekbay-sheet');
            s.style.pointerEvents = 'none';
            s.style.display = 'block';
            s.style.width = '100%';
            s.style.height = 'auto';
            container.appendChild(s);
        }        
        requestAnimationFrame(() => {
            this.svgsAttached.set(true);
        });
    }
}