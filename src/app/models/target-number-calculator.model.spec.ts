// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { calculateTargetTnModifier, getTargetProneModifier } from './target-number-calculator.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';

describe('target number calculator rules profiles', () => {
    it('applies prone modifiers correctly at adjacent and non-adjacent ranges', () => {
        expect(getTargetProneModifier(1)).toBe(-2);
        expect(getTargetProneModifier(2)).toBe(1);
    });

    it('applies water partial cover at adjacent range', () => {
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 1,
            waterPartialCover: true,
        })).toBe(1);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 1,
            partialCover: true,
        })).toBe(0);
    });

    it('uses Large Target and ignores removed modifiers in core2026', () => {
        expect(calculateTargetTnModifier({
            range: 5,
            largeTarget: true, // used, -1
            skidding: true, // ignored, +1
            secondaryTargetSideBack: true, // ignored, +2
        }, CORE_2026_GAME_RULES)).toBe(-1);
    });

    it('uses Skidding and Side/Back Secondary while ignoring Large Target in TW', () => {
        expect(calculateTargetTnModifier({
            range: 5,
            largeTarget: true, // ignored, -1
            skidding: true, // used, +1
            secondaryTargetSideBack: true, // used, +2
        }, TW_GAME_RULES)).toBe(4);
    });

    it('ignores movement, prone, and cover modifiers for terrain targets while allowing Immobile', () => {
        expect(calculateTargetTnModifier({
            unitType: 'terrain',
            range: 5,
            isAirborne: true,
            targetMovementBracket: '10-17',
            skidding: true,
            immobile: true,
            targetHexCover: 'heavy',
            partialCover: true,
            interveningWoods: 'light1',
        }, TW_GAME_RULES)).toBe(-3);
    });

    it('permits cover and Immobile but not movement or Prone modifiers for buildings', () => {
        expect(calculateTargetTnModifier({
            unitType: 'building',
            range: 5,
            isAirborne: true,
            targetMovementBracket: '10-17',
            immobile: true,
            targetHexCover: 'heavy',
        }, CORE_2026_GAME_RULES)).toBe(-2);
    });

    it('treats Terrain and Building targets as Immobile by default', () => {
        expect(calculateTargetTnModifier({ unitType: 'terrain', range: 5 })).toBe(-4);
        expect(calculateTargetTnModifier({ unitType: 'building', range: 5 })).toBe(-4);
    });

    it('keeps movement modifiers for prone and immobile non-static targets', () => {
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            targetMovementBracket: '7-9',
            prone: true
        })).toBe(4);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            targetMovementBracket: '7-9',
            immobile: true
        })).toBe(-1);
    });

    it('stacks prone and immobile modifiers for non-static targets', () => {
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            targetMovementBracket: '7-9',
            prone: true,
            immobile: true,
        })).toBe(0);
    });
});
