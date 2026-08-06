// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { UnitSvgService } from "./unit-svg.service";
import { AeroRules } from "../models/rules/aero-rules";

/*
 *
 * Aerospace Fighter SVG rendering service.
 */
export class UnitSvgAeroService extends UnitSvgService {

    private get aeroRules(): AeroRules { return this.unit.rules as AeroRules; }

    // ── Heat Sink Pips ───────────────────────────────────────────────────────

    protected override updateHeatSinkPips() {
        const svg = this.unit.svg();
        if (!svg) return;

        const dissipation = this.aeroRules.heatDissipation();
        if (!dissipation) return;

        // Update hsPips (visual damaged/fresh/disabled)
        const hsPipsContainer = svg.querySelector('.hsPips');

        // This unit has no heatsink pips, lets skip all, probably is a vessel or something.
        // TODO: implement this better...
        if (!hsPipsContainer) return;
        
        const allHsPips = Array.from(hsPipsContainer.querySelectorAll('.pip')) as SVGElement[];
        let idx = 0;
        allHsPips.forEach(pip => {
            if (idx < dissipation.damagedCount) {
                if (!pip.classList.contains('damaged')) {
                    pip.classList.add('fresh');
                    pip.classList.add('damaged');
                } else {
                    pip.classList.remove('fresh');
                }
            } else {
                if (pip.classList.contains('damaged')) {
                    pip.classList.add('fresh');
                    pip.classList.remove('damaged');
                } else {
                    pip.classList.remove('fresh');
                }
            }
            idx++;
        });

        idx = 0;
        allHsPips.reverse().forEach(pip => {
            if (idx < dissipation.heatsinksOff) {
                if (!pip.classList.contains('disabled')) {
                    pip.classList.add('disabled');
                }
            } else {
                if (pip.classList.contains('disabled')) {
                    pip.classList.remove('disabled');
                }
            }
            idx++;
        });

        // Update heatsink count display
        const hsCountElement = svg.querySelector('#hsCount');
        if (hsCountElement) {
            if (dissipation.healthyPips !== dissipation.totalDissipation || dissipation.heatsinksOff > 0) {
                hsCountElement.textContent = `${dissipation.healthyPips} (${dissipation.totalDissipation})`;
            } else {
                hsCountElement.textContent = dissipation.totalDissipation.toString();
            }
        }

        this.updateHeatProfileDisplay(dissipation.totalDissipation);
    }

    // ── Hit Modifiers ────────────────────────────────────────────────────────

}
