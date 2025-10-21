import { Component, ChangeDetectionStrategy, signal, effect, input, inject, viewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Unit } from '../../models/units.model';
import { DataService } from '../../services/data.service';

@Component({
    selector: 'svg-viewer-lite',
    standalone: true,
    imports: [CommonModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './svg-viewer-lite.component.html',
    styleUrls: ['./svg-viewer-lite.component.css']
})
export class SvgViewerLiteComponent {
    private dataService = inject(DataService);

    unit = input<Unit | null>(null);

    containerRef = viewChild.required<ElementRef<HTMLDivElement>>('container');

    private svgs = signal<SVGSVGElement[]>([]);

    // Reactive effect: load sheet when unit changes
    constructor() {
        effect(() => {
            const u = this.unit();
            this.svgs.set([]);

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
                    console.error('svg-viewer-lite: failed to load sheet', err);
                    this.svgs.set([]);
                }
            })();
        });
    }

    private cleanContainer() {
        const container = this.containerRef().nativeElement;
        while (container.firstChild) container.removeChild(container.firstChild);
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
    }
}