// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
AERO_HEAT_EFFECTS,LAM_HEAT_EFFECTS,MEK_HEAT_EFFECTS,projectHeatEffects,
type HeatEffectDefinition
} from '../rules/heat-effect-rules';

export interface RecordSheetHeatEffect {
    readonly heat: number;
    readonly label: string;
    readonly secondaryLabel?: string;
    readonly active: boolean;
    readonly superseded: boolean;
    readonly movementModifier?: number;
}

export function recordSheetHeatEffects(family: 'mek' | 'aero' | 'lam', heat: number): readonly RecordSheetHeatEffect[] {
    const definitions = family === 'aero' ? AERO_HEAT_EFFECTS : family === 'lam' ? LAM_HEAT_EFFECTS : MEK_HEAT_EFFECTS;
    const effects = projectHeatEffects(definitions, heat);
    return Object.freeze(effects.filter(effect => family !== 'lam' || effect.kind !== 'random-movement')
        .map(effect => {
            const random = family === 'lam' && effect.kind === 'movement'
                ? effects.find(row => row.kind === 'random-movement' && row.heat === effect.heat) : undefined;
            return Object.freeze({
                heat: effect.heat, label: heatEffectLabel(effect), active: effect.active, superseded: effect.superseded,
                ...(effect.kind === 'movement' ? { movementModifier: effect.value } : {}),
                ...(random === undefined ? {} : { secondaryLabel: `/Rand. Movement ${random.value}+` }),
            });
        }).reverse());
}

function heatEffectLabel(effect: HeatEffectDefinition): string {
    switch (effect.kind) {
        case 'movement': return `${effect.value} Movement Points`;
        case 'fire': return `+${effect.value} Modifier to Fire`;
        case 'shutdown': return effect.value === 100 ? 'Shutdown' : `Shutdown, avoid on ${effect.value}+`;
        case 'ammo-explosion': return `Ammo Exp, avoid on ${effect.value}+`;
        case 'random-movement': return `Random Movement, avoid on ${effect.value}+`;
        case 'pilot-damage': return `Pilot damage, avoid on ${effect.value}+`;
    }
}
