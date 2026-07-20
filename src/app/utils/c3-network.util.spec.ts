import { C3_FLAGS, C3NetworkType } from '../models/c3-network.model';
import type { CBTForceUnit } from '../models/cbt-force-unit.model';
import type { SerializedC3NetworkGroup } from '../models/force-serialization';
import { C3NetworkUtil } from './c3-network.util';

function c3Unit(id: string, baseBv: number, flag: string, tagBv = 0): CBTForceUnit {
    return {
        id,
        getBaseBv: () => baseBv,
        tagBV: () => tagBv,
        getUnit: () => ({
            comp: [{ q: 1, eq: { flags: new Set([flag]) } }],
        }),
    } as unknown as CBTForceUnit;
}

function peerNetwork(units: CBTForceUnit[], type = C3NetworkType.C3I): SerializedC3NetworkGroup[] {
    return [{
        id: 'peer-network',
        type,
        color: '#1565C0',
        peerIds: units.map(unit => unit.id),
    }];
}

describe('C3NetworkUtil', () => {
    it('calculates Core2026 tax from each unit BV and network size', () => {
        const twoUnits = [
            c3Unit('alpha', 1000, C3_FLAGS.C3I, 100),
            c3Unit('bravo', 2000, C3_FLAGS.C3I),
        ];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(twoUnits[0], peerNetwork(twoUnits), twoUnits)).toBe(110);
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(twoUnits[1], peerNetwork(twoUnits), twoUnits)).toBe(200);

        const fiveUnits = Array.from({ length: 5 }, (_, index) =>
            c3Unit(`five-${index}`, 1000, C3_FLAGS.C3I)
        );
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(fiveUnits[0], peerNetwork(fiveUnits), fiveUnits)).toBe(250);

        const eightUnits = Array.from({ length: 8 }, (_, index) =>
            c3Unit(`eight-${index}`, 1000, C3_FLAGS.C3I)
        );
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(eightUnits[0], peerNetwork(eightUnits), eightUnits)).toBe(400);
    });

    it('adds five percentage points for a Boosted Core2026 member after the network rate', () => {
        const boosted = c3Unit('master', 1000, C3_FLAGS.C3MBS);
        const units = [
            boosted,
            c3Unit('slave-1', 1000, C3_FLAGS.C3S),
            c3Unit('slave-2', 1000, C3_FLAGS.C3S),
            c3Unit('slave-3', 1000, C3_FLAGS.C3S),
        ];
        const networks: SerializedC3NetworkGroup[] = [{
            id: 'master-network',
            type: C3NetworkType.C3,
            color: '#1565C0',
            masterId: boosted.id,
            masterCompIndex: 0,
            members: units.slice(1).map(unit => unit.id),
        }];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(boosted, networks, units)).toBe(250);
        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(units[1], networks, units)).toBe(200);
    });

    it('retains the TW network-total C3 tax calculation', () => {
        const units = [
            c3Unit('alpha', 1000, C3_FLAGS.C3I),
            c3Unit('bravo', 2000, C3_FLAGS.C3I),
        ];

        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[0], peerNetwork(units), units)).toBe(150);
        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[1], peerNetwork(units), units)).toBe(150);
    });

    it('keeps Nova CEWS tax unchanged in both rulesets', () => {
        const units = [
            c3Unit('alpha', 1000, C3_FLAGS.NOVA),
            c3Unit('bravo', 2000, C3_FLAGS.NOVA),
        ];

        expect(C3NetworkUtil.calculateCore2026UnitC3Tax(units[0], [], units)).toBe(150);
        expect(C3NetworkUtil.calculateTWUnitC3Tax(units[0], [], units)).toBe(150);
    });

    it('removes a unit from cyclic master networks without overflowing the stack', () => {
        const networks: SerializedC3NetworkGroup[] = [
            {
                id: 'network-alpha',
                type: C3NetworkType.C3,
                color: '#1565C0',
                masterId: 'alpha',
                masterCompIndex: 0,
                members: ['bravo:0']
            },
            {
                id: 'network-bravo',
                type: C3NetworkType.C3,
                color: '#2E7D32',
                masterId: 'bravo',
                masterCompIndex: 0,
                members: ['alpha:0']
            }
        ];

        const result = C3NetworkUtil.removeUnitFromAllNetworks(networks, 'alpha');

        expect(result.success).toBeTrue();
        expect(result.networks).toEqual([]);
    });
});