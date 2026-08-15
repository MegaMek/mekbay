// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { calculateTargetTnModifier, calculateTargetTnModifierBreakdown, getTargetProneModifier, resolveTnTargetWaterState } from './target-number-calculator.model';
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
            waterDepth: 'underwater-depth-1',
        })).toBe(1);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 1,
            partialCover: true,
        })).toBe(0);
    });

    it('uses profile-specific ordinary partial cover for indirect fire while retaining water cover', () => {
        const ordinaryPartialCover = {
            unitType: 'mek-biped',
            range: 5,
            indirectFire: true,
            partialCover: true,
        } as const;
        expect(calculateTargetTnModifier(ordinaryPartialCover, CORE_2026_GAME_RULES)).toBe(1);
        expect(calculateTargetTnModifier(ordinaryPartialCover, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifier({
            ...ordinaryPartialCover,
            range: 1,
        }, CORE_2026_GAME_RULES)).toBe(1);
        expect(calculateTargetTnModifier({
            ...ordinaryPartialCover,
            range: 1,
        }, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            indirectFire: true,
            waterDepth: 'underwater-depth-1',
        })).toBe(2);
    });

    it('applies water partial cover only at the unit-specific partial depth', () => {
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            waterDepth: 'underwater-depth-2',
        }, TW_GAME_RULES)).toBe(0);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            largeTarget: true,
            waterDepth: 'underwater-depth-1',
        }, TW_GAME_RULES)).toBe(0);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            largeTarget: true,
            waterDepth: 'underwater-depth-2',
        }, TW_GAME_RULES)).toBe(1);
    });

    it('resolves non-Mek water state from target height', () => {
        expect(resolveTnTargetWaterState({
            unitType: 'vehicle',
            waterDepth: 'underwater-depth-1',
        })).toEqual({ partiallyUnderwater: false, submerged: true });
        expect(calculateTargetTnModifier({
            unitType: 'vehicle',
            range: 5,
            waterDepth: 'underwater-depth-1',
        }, CORE_2026_GAME_RULES)).toBe(0);
    });

    it('applies building cover by target height and posture', () => {
        expect(calculateTargetTnModifier({
            unitType: 'vehicle',
            range: 5,
            buildingCover: 'building-1',
        }, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            buildingCover: 'building-1',
        }, TW_GAME_RULES)).toBe(1);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            buildingCover: 'building-2',
        }, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            prone: true,
            buildingCover: 'building-2',
        }, TW_GAME_RULES)).toBe(3);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            largeTarget: true,
            buildingCover: 'building-1',
        }, TW_GAME_RULES)).toBe(0);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            largeTarget: true,
            buildingCover: 'building-2',
        }, TW_GAME_RULES)).toBe(1);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            prone: true,
            largeTarget: true,
            buildingCover: 'building-1',
        }, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifier({
            unitType: 'mek-biped',
            range: 5,
            prone: true,
            largeTarget: true,
            buildingCover: 'building-2',
        }, TW_GAME_RULES)).toBe(3);
    });

    it('retains building partial cover for adjacent and indirect attacks', () => {
        const input = {
            unitType: 'mek-biped' as const,
            range: 1,
            indirectFire: true,
            buildingCover: 'building-1' as const,
        };
        expect(calculateTargetTnModifier(input, TW_GAME_RULES)).toBe(2);
        expect(calculateTargetTnModifierBreakdown(input, TW_GAME_RULES)).toContain(jasmine.objectContaining({
            label: 'Partial Cover (building)',
            modifier: 1,
            partialCoverSource: 'building',
        }));
    });

    it('identifies partial-cover rules independently of their display labels', () => {
        const waterCover = calculateTargetTnModifierBreakdown({
            unitType: 'mek-biped',
            waterDepth: 'underwater-depth-1',
        });
        const manualCover = calculateTargetTnModifierBreakdown({
            unitType: 'mek-biped',
            range: 2,
            partialCover: true,
        });

        expect(waterCover).toContain(jasmine.objectContaining({
            label: 'Partial Cover (water)',
            partialCoverSource: 'water',
        }));
        expect(manualCover).toContain(jasmine.objectContaining({
            label: 'Partial Cover',
            partialCoverSource: 'manual',
            guidanceAdjustment: 'partial-cover',
        }));
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
