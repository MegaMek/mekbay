// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

export type HeatEffectKind = 'movement' | 'fire' | 'shutdown' | 'ammo-explosion' | 'random-movement' | 'pilot-damage';
export interface HeatEffectDefinition {
    readonly heat: number;
    readonly kind: HeatEffectKind;
    readonly value: number;
}

const COMMON_HEAT_EFFECTS: readonly HeatEffectDefinition[] = Object.freeze([
    { heat: 8, kind: 'fire', value: 1 }, { heat: 13, kind: 'fire', value: 2 },
    { heat: 17, kind: 'fire', value: 3 }, { heat: 24, kind: 'fire', value: 4 },
    { heat: 14, kind: 'shutdown', value: 4 }, { heat: 18, kind: 'shutdown', value: 6 },
    { heat: 22, kind: 'shutdown', value: 8 }, { heat: 26, kind: 'shutdown', value: 10 },
    { heat: 30, kind: 'shutdown', value: 100 },
    { heat: 19, kind: 'ammo-explosion', value: 4 }, { heat: 23, kind: 'ammo-explosion', value: 6 },
    { heat: 28, kind: 'ammo-explosion', value: 8 },
]);
const MOVEMENT_HEAT_EFFECTS: readonly HeatEffectDefinition[] = Object.freeze([
    { heat: 5, kind: 'movement', value: -1 }, { heat: 10, kind: 'movement', value: -2 },
    { heat: 15, kind: 'movement', value: -3 }, { heat: 20, kind: 'movement', value: -4 },
    { heat: 25, kind: 'movement', value: -5 },
]);
const RANDOM_MOVEMENT_HEAT_EFFECTS: readonly HeatEffectDefinition[] = Object.freeze([
    { heat: 5, kind: 'random-movement', value: 5 }, { heat: 10, kind: 'random-movement', value: 6 },
    { heat: 15, kind: 'random-movement', value: 7 }, { heat: 20, kind: 'random-movement', value: 8 },
    { heat: 25, kind: 'random-movement', value: 10 },
]);
export const MEK_HEAT_EFFECTS = Object.freeze([...COMMON_HEAT_EFFECTS, ...MOVEMENT_HEAT_EFFECTS]
    .sort((a, b) => a.heat - b.heat));
export const AERO_HEAT_EFFECTS: readonly HeatEffectDefinition[] = Object.freeze([
    ...COMMON_HEAT_EFFECTS, ...RANDOM_MOVEMENT_HEAT_EFFECTS,
    { heat: 21, kind: 'pilot-damage', value: 6 }, { heat: 27, kind: 'pilot-damage', value: 9 },
].sort((a, b) => a.heat - b.heat) as HeatEffectDefinition[]);
export const LAM_HEAT_EFFECTS = Object.freeze([...MEK_HEAT_EFFECTS, ...RANDOM_MOVEMENT_HEAT_EFFECTS]
    .sort((a, b) => a.heat - b.heat));

export function heatEffectValue(definitions: readonly HeatEffectDefinition[], kind: HeatEffectKind, heat: number): number | undefined {
    return definitions.filter(effect => effect.kind === kind && effect.heat <= heat).at(-1)?.value;
}

export function projectHeatEffects(definitions: readonly HeatEffectDefinition[], heat: number): readonly Readonly<HeatEffectDefinition & {
    active: boolean; superseded: boolean;
}>[] {
    return definitions.map(effect => Object.freeze({
        ...effect,
        active: effect.heat <= heat,
        superseded: effect.heat <= heat && definitions.some(later =>
            later.kind === effect.kind && later.heat > effect.heat && later.heat <= heat),
    }));
}
