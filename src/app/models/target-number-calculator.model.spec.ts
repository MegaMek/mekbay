import { calculateTargetTnModifier } from './target-number-calculator.model';
import { CORE_2026_RULES_DATA, TW_RULES_DATA } from './rules/cbt-rules-data';

describe('target number calculator rules profiles', () => {
    it('uses Large Target and ignores removed modifiers in core2026', () => {
        expect(calculateTargetTnModifier({
            range: 5,
            largeTarget: true, // used, -1
            skidding: true, // ignored, +1
            secondaryTargetSideBack: true, // ignored, +2
        }, CORE_2026_RULES_DATA)).toBe(-1);
    });

    it('uses Skidding and Side/Back Secondary while ignoring Large Target in TW', () => {
        expect(calculateTargetTnModifier({
            range: 5,
            largeTarget: true, // ignored, -1
            skidding: true, // used, +1
            secondaryTargetSideBack: true, // used, +2
        }, TW_RULES_DATA)).toBe(4);
    });
});
