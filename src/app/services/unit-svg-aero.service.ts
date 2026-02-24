/*
 * Copyright (C) 2026 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import { UnitSvgService } from "./unit-svg.service";
import { AeroRules } from "../models/rules/aero-rules";

/*
 * Author: Drake
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
        if (hsPipsContainer) {
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
        }

        // Update heatsink count display
        const hsCountElement = svg.querySelector('#hsCount');
        if (hsCountElement) {
            if (dissipation.healthyPips !== dissipation.totalDissipation || dissipation.heatsinksOff > 0) {
                hsCountElement.textContent = `${dissipation.healthyPips} (${dissipation.totalDissipation})`;
            } else {
                hsCountElement.textContent = dissipation.totalDissipation.toString();
            }
        }

        // Update heat profile display
        const heatProfileElement = svg.querySelector('#heatProfile');
        if (heatProfileElement) {
            const existingText = heatProfileElement.textContent || '';
            const match = existingText.match(/:\s*(\d+)/);
            const heatProfileValue = match ? match[1] : '0';
            heatProfileElement.textContent = `Total Heat (Dissipation): ${heatProfileValue} (${dissipation.totalDissipation})`;
        }
    }

    // ── Hit Modifiers ────────────────────────────────────────────────────────

    protected override getGlobalFireModifier(): number {
        const heat = this.unit.getHeat().current;
        return AeroRules.getHeatEffects(heat).fireModifier;
    }
}
