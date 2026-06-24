import type { CBTForceUnit } from '../cbt-force-unit.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { ProtoMekRules } from './protomek-rules';

function createRulesHarness(): ProtoMekRules {
    const baseUnit = createEmptyUnit({
        type: 'ProtoMek',
        subtype: 'ProtoMek',
    });
    const unit = {
        getCritSlots: () => [],
        getUnit: () => baseUnit,
        locations: { internal: new Map() },
        destroyed: false,
        setDestroyed: jasmine.createSpy('setDestroyed'),
    } as unknown as CBTForceUnit;

    return new ProtoMekRules(unit);
}

describe('ProtoMekRules', () => {
    it('provides ProtoMek attack movement modifiers through the rules system', () => {
        const rules = createRulesHarness();

        expect(rules.getAttackMovementModifier('stationary')).toBe(0);
        expect(rules.getAttackMovementModifier('walk')).toBe(1);
        expect(rules.getAttackMovementModifier('run')).toBe(2);
        expect(rules.getAttackMovementModifier('jump')).toBe(3);
    });
});
