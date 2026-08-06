// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { Injectable } from '@angular/core';

import type { CBTForceUnit } from '../../../models/cbt-force-unit.model';
import { resolveCenterPanelTables } from '../../../utils/record-sheet-center-panel.util';

@Injectable()
export class PageViewerPresentationService {
    private readonly centerPanelTablesBySvg = new WeakMap<SVGSVGElement, readonly SVGGraphicsElement[]>();

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