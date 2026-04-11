import { GameSystem } from './common.model';
import type { ASSerializedUnit, CBTSerializedUnit } from './force-serialization';
import { createLoadForceUnitFromSerializedUnit, getLoadForceUnitPilotStats, type LoadForceUnit } from './load-force-entry.model';

describe('createLoadForceUnitFromSerializedUnit', () => {
    const getUnitByName = (name: string) => ({ name, type: 'Mek' } as any);

    it('reads alpha strike pilot skill from serialized AS units', () => {
        const serializedUnit: ASSerializedUnit = {
            id: 'as-1',
            unit: 'Atlas AS7-D',
            alias: 'Ace',
            commander: true,
            skill: 3,
            abilities: [],
            state: {
                modified: false,
                destroyed: false,
                shutdown: false,
                heat: [0, 0],
                armor: [0, 0],
                internal: [0, 0],
                crits: [],
                pCrits: [],
            },
        };

        const result = createLoadForceUnitFromSerializedUnit(serializedUnit, getUnitByName);

        expect(result).toEqual(jasmine.objectContaining({
            alias: 'Ace',
            skill: 3,
            commander: true,
        }));
        expect(result.gunnery).toBeUndefined();
        expect(result.piloting).toBeUndefined();
    });

    it('reads classic crew skills from serialized CBT units', () => {
        const serializedUnit: CBTSerializedUnit = {
            id: 'cbt-1',
            unit: 'Atlas AS7-D',
            commander: false,
            state: {
                modified: false,
                destroyed: false,
                shutdown: false,
                crew: [
                    { id: 0, name: 'Pilot 1', gunnerySkill: 4, pilotingSkill: 5, hits: 0, state: 0 },
                    { id: 1, name: 'Pilot 2', gunnerySkill: 3, pilotingSkill: 4, hits: 0, state: 0 },
                ],
                crits: [],
                locations: {},
                heat: {
                    current: 0,
                    previous: 0,
                },
            },
        };

        const result = createLoadForceUnitFromSerializedUnit(serializedUnit, getUnitByName);

        expect(result).toEqual(jasmine.objectContaining({
            gunnery: 3,
            piloting: 5,
            commander: false,
        }));
        expect(result.skill).toBeUndefined();
    });
});

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