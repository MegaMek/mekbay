import { calculateTargetTnModifier } from './target-number-calculator.model';
import { CORE_2026_GAME_RULES, TW_GAME_RULES } from './rules/game-rules';

describe('target number calculator rules profiles', () => {
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
            stance: 'immobile',
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
            stance: 'immobile',
            targetHexCover: 'heavy',
        }, CORE_2026_GAME_RULES)).toBe(-2);
    });

    it('treats Terrain and Building targets as Immobile by default', () => {
        expect(calculateTargetTnModifier({ unitType: 'terrain', range: 5 })).toBe(-4);
        expect(calculateTargetTnModifier({ unitType: 'building', range: 5 })).toBe(-4);
    });
});
