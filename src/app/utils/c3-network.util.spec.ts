import { C3NetworkType } from '../models/c3-network.model';
import type { SerializedC3NetworkGroup } from '../models/force-serialization';
import { C3NetworkUtil } from './c3-network.util';

describe('C3NetworkUtil', () => {
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