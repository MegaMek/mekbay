// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable, inject } from '@angular/core';

import { resolveCenterPanelTables } from '../../../utils/record-sheet-center-panel.util';
import { PageViewerSheetSourceService } from './page-viewer-sheet-source.service';
import type { PageViewerMember } from './types';

@Injectable()
export class PageViewerPresentationService {
    private readonly centerPanelTablesBySvg = new WeakMap<SVGSVGElement, readonly SVGGraphicsElement[]>();
    private readonly sheetSource = inject(PageViewerSheetSourceService);

    updateSelectedPageHighlight(wrappers: readonly HTMLDivElement[], currentUnitId: string | null): void {
        wrappers.forEach((wrapper) => {
            wrapper.classList.toggle('selected', wrapper.dataset['unitId'] === currentUnitId);
        });
    }

    setDisplayedFluffImageVisibility(displayedUnits: readonly PageViewerMember[], showFluff: boolean): void {
        displayedUnits.forEach((unit) => {
            const svg = this.sheetSource.svg(unit);
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
        const fluffElements = [
            svg.getElementById('fluff-image-fo'),
            svg.getElementById('fluff-image-injected'),
            svg.getElementById('fluffImage'),
            svg.getElementById('fluffSinglePilot'),
            svg.getElementById('fluffDualPilot'),
            svg.getElementById('fluffTriplePilot'),
        ].filter((element): element is SVGElement => element instanceof SVGElement);
        const referenceTables = this.resolveCenterPanelTables(svg);
        if (fluffElements.length === 0 && referenceTables.length === 0) {
            return;
        }

        if (showFluff && fluffElements.length > 0) {
            fluffElements.forEach(element => element.style.setProperty('display', 'block'));
            referenceTables.forEach((referenceTable) => {
                referenceTable.style.display = 'none';
            });
            return;
        }

        fluffElements.forEach(element => element.style.setProperty('display', 'none'));
        referenceTables.forEach((referenceTable) => {
            referenceTable.style.display = 'block';
        });
    }

    private resolveCenterPanelTables(svg: SVGSVGElement): readonly SVGGraphicsElement[] {
        const cachedTables = this.centerPanelTablesBySvg.get(svg);
        if (cachedTables) {
            return cachedTables;
        }

        const tables = resolveCenterPanelTables(svg);
        this.centerPanelTablesBySvg.set(svg, tables);
        return tables;
    }
}
