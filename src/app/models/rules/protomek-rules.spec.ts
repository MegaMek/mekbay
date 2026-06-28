import type { CBTForceUnit } from '../cbt-force-unit.model';
import { CRIPPLED_CREW_HIT_THRESHOLD, type CrewMemberState } from '../crew-member.model';
import { createEmptyUnit } from '../../testing/unit-test-helpers';
import { ProtoMekRules } from './protomek-rules';

function createRulesHarness(crewStates: CrewMemberState[] = ['healthy'], crewHits: number[] = []): ProtoMekRules {
    const baseUnit = createEmptyUnit({
        type: 'ProtoMek',
        subtype: 'ProtoMek',
    });
    const unit = {
        getCritSlots: () => [],
        getCrewMembers: () => crewStates.map((state, index) => ({
            getState: () => state,
            isCrippled: () => (crewHits[index] ?? 0) >= CRIPPLED_CREW_HIT_THRESHOLD,
        })),
        getUnit: () => baseUnit,
        isLoaded: () => true,
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

    it('marks ProtoMeks abandoned only when pilot is dead', () => {
        expect(createRulesHarness(['dead']).hasComputedCondition('abandoned')).toBeTrue();
        expect(createRulesHarness(['ejected']).hasComputedCondition('abandoned')).toBeFalse();
    });

    it('marks ProtoMeks crippled when pilot is crippled', () => {
        expect(createRulesHarness(['healthy'], [CRIPPLED_CREW_HIT_THRESHOLD]).hasComputedCondition('crippled')).toBeTrue();
        expect(createRulesHarness(['healthy', 'healthy'], [CRIPPLED_CREW_HIT_THRESHOLD, 0]).hasComputedCondition('crippled')).toBeFalse();
    });
});
