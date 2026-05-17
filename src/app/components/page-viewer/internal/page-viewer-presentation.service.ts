import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';

@Injectable()
export class PageViewerPresentationService {
    updateSelectedPageHighlight(wrappers: readonly HTMLDivElement[], currentUnitId: string | null): void {
        wrappers.forEach((wrapper) => {
            wrapper.classList.toggle('selected', wrapper.dataset['unitId'] === currentUnitId);
        });
    }

    setDisplayedFluffImageVisibility(displayedUnits: readonly CBTForceUnit[], showFluff: boolean): void {
        displayedUnits.forEach((unit) => {
            const svg = unit.svg();
            if (!svg) {
                return;
            }

            this.applyFluffImageVisibilityToSvg(svg, showFluff);
        });
    }

    setShadowFluffImageVisibility(wrappers: readonly HTMLDivElement[], showFluff: boolean): void {
        wrappers.forEach((wrapper) => {
            const svg = wrapper.querySelector('svg');
            if (svg instanceof SVGSVGElement) {
                this.applyFluffImageVisibilityToSvg(svg, showFluff);
            }
        });
    }

    applyFluffImageVisibilityToSvg(svg: SVGSVGElement, showFluff: boolean): void {
        const injectedEl = svg.getElementById('fluff-image-fo') as HTMLElement | null;
        if (!injectedEl) {
            return;
        }

        const referenceTables = svg.querySelectorAll<SVGGraphicsElement>('.referenceTable');
        if (referenceTables.length === 0) {
            return;
        }

        if (showFluff) {
            injectedEl.style.setProperty('display', 'block');
            referenceTables.forEach((referenceTable) => {
                referenceTable.style.display = 'none';
            });
            return;
        }

        injectedEl.style.setProperty('display', 'none');
        referenceTables.forEach((referenceTable) => {
            referenceTable.style.display = 'block';
        });
    }
}