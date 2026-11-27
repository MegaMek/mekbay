// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { MAX_CONVENTIONAL_INFANTRY_STRENGTH } from '../../models/entity/entities/infantry/infantry-entity';

export const INFANTRY_STRENGTH_CELL_COUNT = MAX_CONVENTIONAL_INFANTRY_STRENGTH;

export type InfantryStrengthVisualState = 'alive' | 'damaged' | 'committed' | 'fresh' | 'restored';

export interface InfantryStrengthFacts {
    readonly maximum: number;
    readonly committedRemaining: number;
    readonly previewRemaining: number;
}

export interface InfantryStrengthCell {
    readonly strength: number;
    readonly available: boolean;
    readonly committedDamaged: boolean;
    readonly state: InfantryStrengthVisualState;
}

/** Projects aggregate counts into exact strength choices. Cells have no soldier identity. */
export function projectInfantryStrengthCells(
    facts: InfantryStrengthFacts,
    previousPreview?: number,
): readonly InfantryStrengthCell[] {
    return Object.freeze(Array.from({ length: INFANTRY_STRENGTH_CELL_COUNT }, (_, index) => {
        const strength = INFANTRY_STRENGTH_CELL_COUNT - index;
        const damaged = strength > facts.previewRemaining;
        const committedDamaged = strength > facts.committedRemaining;
        const wasDamaged = strength > (previousPreview ?? facts.previewRemaining);
        const changed = previousPreview !== undefined && wasDamaged !== damaged;
        const pending = damaged !== committedDamaged;
        const state: InfantryStrengthVisualState = damaged
            ? changed ? 'fresh' : pending ? 'damaged' : 'committed'
            : changed || pending ? 'restored' : 'alive';
        return Object.freeze({
            strength,
            available: strength <= facts.maximum,
            committedDamaged,
            state,
        });
    }));
}
