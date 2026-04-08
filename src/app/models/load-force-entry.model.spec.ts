import { GameSystem } from './common.model';
import { getLoadForceUnitPilotStats, type LoadForceUnit } from './load-force-entry.model';

describe('getLoadForceUnitPilotStats', () => {
    it('formats classic skills as gunnery slash piloting', () => {
        const loadForceUnit: LoadForceUnit = {
            unit: { type: 'Mek' } as any,
            destroyed: false,
            gunnery: 3,
            piloting: 4,
        };

        expect(getLoadForceUnitPilotStats(loadForceUnit, GameSystem.CLASSIC)).toBe('3/4');
    });

    it('formats protomek classic skills as gunnery only', () => {
        const loadForceUnit: LoadForceUnit = {
            unit: { type: 'ProtoMek' } as any,
            destroyed: false,
            gunnery: 2,
            piloting: 5,
        };

        expect(getLoadForceUnitPilotStats(loadForceUnit, GameSystem.CLASSIC)).toBe('2');
    });

    it('formats alpha strike skills from the skill field', () => {
        const loadForceUnit: LoadForceUnit = {
            unit: { type: 'Mek' } as any,
            destroyed: false,
            skill: 3,
        };

        expect(getLoadForceUnitPilotStats(loadForceUnit, GameSystem.ALPHA_STRIKE)).toBe('3');
    });
});