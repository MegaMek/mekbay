// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { RecordSheetHeatEffect } from '../../models/runtime/heat-effect-presentation';

/** Values and effect activation are projected before looking up any layout element. */
export function renderRecordSheetHeatEffects(svg: SVGSVGElement, effects: readonly RecordSheetHeatEffect[]): void {
    svg.querySelectorAll('.heatEffect').forEach(element => element.classList.remove('hot', 'surpassed'));
    for (const effect of effects) {
        svg.querySelectorAll<SVGElement>(`.heatEffect[heat="${effect.heat}"]`).forEach(element => {
            element.classList.toggle('hot', effect.active);
            element.classList.toggle('surpassed', effect.superseded);
        });
    }
}
