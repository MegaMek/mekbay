
import { projectMekLifeSupportPilotDamage } from './mek-life-support';
import type { DirectMekRuntimeFixture } from './testing/direct-mek-runtime-fixture';
import {
    createDirectMekRuntimeFixture,
    createDirectSuperheavyRuntimeFixture,
    createDirectTorsoCockpitRuntimeFixture,
} from './testing/direct-mek-runtime-fixture';

describe('Mek Life Support rules', () => {
    it('uses the Core 2026 and Total Warfare heat thresholds', () => {
        const core = damagedLifeSupport(createDirectMekRuntimeFixture('core-2026', 'life-support:core'));
        const tw = damagedLifeSupport(createDirectMekRuntimeFixture('total-warfare', 'life-support:tw'));

        expect([9, 10, 19, 20].map(heat => projection(core, heat).heatHits)).toEqual([0, 1, 1, 2]);
        expect([14, 15, 25, 26].map(heat => projection(tw, heat).heatHits)).toEqual([0, 1, 1, 2]);
    });

    it('uses the torso-mounted cockpit thresholds and suppresses head-hit pilot damage', () => {
        const fixture = damagedLifeSupport(createDirectTorsoCockpitRuntimeFixture());

        expect([1, 14, 15].map(heat => projection(fixture, heat).heatHits)).toEqual([1, 1, 2]);
        expect(projection(fixture, 1).headHitHits).toBe(0);
        expect(projection(createDirectMekRuntimeFixture(), 30).headHitHits).toBe(1);
    });

    it('uses preview damage and prone-aware water depth for oxygen deprivation', () => {
        const fixture = createDirectMekRuntimeFixture();
        const slot = lifeSupportSlot(fixture);
        expect(fixture.instance.dispatch({
            type: 'hit-critical',

            slotId: slot.id, hits: 1, target: 'pending',
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',

            turn: { ...fixture.instance.query().turnState(), cover: 'underwater-depth-1' },
        }).accepted).toBeTrue();

        expect(projection(fixture, 10)).toEqual(jasmine.objectContaining({ damaged: true, oxygenHits: 0 }));
        expect(fixture.instance.dispatch({
            type: 'set-condition',

            condition: 'prone', active: true,
        }).accepted).toBeTrue();
        expect(projection(fixture, 10).oxygenHits).toBe(1);
    });

    it('keeps a prone superheavy Mek above water until depth 2', () => {
        const fixture = damagedLifeSupport(createDirectSuperheavyRuntimeFixture());
        expect(fixture.instance.dispatch({
            type: 'set-condition',

            condition: 'prone', active: true,
        }).accepted).toBeTrue();
        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',

            turn: { ...fixture.instance.query().turnState(), cover: 'underwater-depth-1' },
        }).accepted).toBeTrue();
        expect(projection(fixture, 10).oxygenHits).toBe(0);

        expect(fixture.instance.dispatch({
            type: 'replace-turn-state',

            turn: { ...fixture.instance.query().turnState(), cover: 'underwater-depth-2' },
        }).accepted).toBeTrue();
        expect(projection(fixture, 10).oxygenHits).toBe(1);
    });
});

function projection(fixture: DirectMekRuntimeFixture, heat: number) {
    return projectMekLifeSupportPilotDamage(
        fixture.entity,
        fixture.index,
        fixture.instance.ruleset(),
        fixture.instance.query(),
        heat,
    );
}

function damagedLifeSupport(fixture: DirectMekRuntimeFixture): DirectMekRuntimeFixture {
    expect(fixture.instance.dispatch({
        type: 'hit-critical',

        slotId: lifeSupportSlot(fixture).id, hits: 1, target: 'committed',
    }).accepted).toBeTrue();
    return fixture;
}

function lifeSupportSlot(fixture: DirectMekRuntimeFixture) {
    const slot = [...fixture.index.slots.values()].find(candidate =>
        candidate.componentIds.some(componentId => {
            const component = fixture.index.components.get(componentId);
            return component?.kind === 'system' && component.systemType === 'Life Support';
        }));
    if (!slot) throw new Error('Direct Mek fixture has no Life Support slot');
    return slot;
}
