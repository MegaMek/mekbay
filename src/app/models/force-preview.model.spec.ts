import { GameSystem } from './common.model';
import { LoadForceEntry } from './load-force-entry.model';
import {
    createForcePreviewEntryFromForce,
    createForcePreviewUnitFromSerializedUnit,
    getForcePreviewResolvedUnits,
    getForcePreviewUnitPilotStats,
    isForcePreviewEntry,
} from './force-preview.model';

describe('createForcePreviewUnitFromSerializedUnit', () => {
    const getUnitByName = (name: string) => ({ name, type: 'Mek' } as any);

    it('reads alpha strike pilot skill from serialized AS units', () => {
        const serializedUnit = {
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
        } as any;

        const result = createForcePreviewUnitFromSerializedUnit(serializedUnit, getUnitByName);

        expect(result).toEqual(jasmine.objectContaining({
            alias: 'Ace',
            skill: 3,
            commander: true,
        }));
        expect(result.gunnery).toBeUndefined();
        expect(result.piloting).toBeUndefined();
    });

    it('reads classic crew skills from serialized CBT units', () => {
        const serializedUnit = {
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
        } as any;

        const result = createForcePreviewUnitFromSerializedUnit(serializedUnit, getUnitByName);

        expect(result).toEqual(jasmine.objectContaining({
            gunnery: 3,
            piloting: 5,
            commander: false,
        }));
        expect(result.skill).toBeUndefined();
    });
});

describe('createForcePreviewEntryFromForce', () => {
    it('builds plain preview data for unsaved alpha strike forces without serializing', () => {
        const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
        const liveUnit = {
            id: 'as-1',
            destroyed: false,
            getUnit: () => resolvedUnit,
            alias: () => 'Ace',
            commander: () => true,
            getPilotSkill: () => 3,
            getPilotStats: () => 3,
        } as any;

        const force = {
            serialize: jasmine.createSpy('serialize'),
            instanceId: () => null,
            owned: () => true,
            name: 'Unsaved Alpha Force',
            note: 'Forward recon screen.',
            gameSystem: GameSystem.ALPHA_STRIKE,
            faction: () => null,
            era: () => null,
            totalBv: () => 123,
            timestamp: null,
            groups: () => [{
                name: () => 'Striker',
                activeFormation: () => ({ id: 'battle-lance' }),
                units: () => [liveUnit],
            }],
        } as any;

        const result = createForcePreviewEntryFromForce(force);

        expect(force.serialize).not.toHaveBeenCalled();
        expect(result instanceof LoadForceEntry).toBe(false);
        expect(result.instanceId).toBe('');
        expect(result.note).toBe('Forward recon screen.');
        expect(result.pv).toBe(123);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Striker',
            formationId: 'battle-lance',
            force: result,
        }));
        expect(getForcePreviewResolvedUnits(result)).toEqual([resolvedUnit]);
        expect(getForcePreviewUnitPilotStats(result.groups[0].units[0], result.type)).toBe('3');
    });

    it('builds classic pilot stats from live force units and skips empty groups', () => {
        const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
        const liveUnit = {
            id: 'cbt-1',
            destroyed: false,
            getUnit: () => resolvedUnit,
            alias: () => 'Veteran',
            commander: () => false,
            getPilotStats: () => '3/4',
            gunnerySkill: () => 3,
            pilotingSkill: () => 4,
        } as any;

        const force = {
            serialize: jasmine.createSpy('serialize'),
            instanceId: () => null,
            owned: () => true,
            name: 'Unsaved Classic Force',
            note: 'Drop-ready line unit.',
            gameSystem: GameSystem.CLASSIC,
            faction: () => null,
            era: () => null,
            totalBv: () => 1400,
            timestamp: null,
            groups: () => [
                {
                    name: () => undefined,
                    activeFormation: () => null,
                    units: () => [liveUnit],
                },
                {
                    name: () => 'Empty Group',
                    activeFormation: () => null,
                    units: () => [],
                },
            ],
        } as any;

        const result = createForcePreviewEntryFromForce(force);

        expect(force.serialize).not.toHaveBeenCalled();
        expect(result.bv).toBe(1400);
        expect(result.note).toBe('Drop-ready line unit.');
        expect(result.groups.length).toBe(1);
        expect(result.groups[0].units[0]).toEqual(jasmine.objectContaining({
            alias: 'Veteran',
            gunnery: 3,
            piloting: 4,
        }));
        expect(getForcePreviewResolvedUnits(result)).toEqual([resolvedUnit]);
        expect(getForcePreviewUnitPilotStats(result.groups[0].units[0], result.type)).toBe('3/4');
    });
});

describe('force preview helpers', () => {
    it('treats saved load entries as compatible preview entries', () => {
        const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
        const entry = new LoadForceEntry({
            type: GameSystem.CLASSIC,
            groups: [{
                units: [
                    { unit: resolvedUnit, destroyed: false },
                    { unit: undefined, destroyed: false },
                ],
            }],
        });

        expect(isForcePreviewEntry(entry)).toBe(true);
        expect(getForcePreviewResolvedUnits(entry)).toEqual([resolvedUnit]);
    });

    it('formats protomek classic pilot stats as gunnery only', () => {
        expect(getForcePreviewUnitPilotStats({
            unit: { type: 'ProtoMek' } as any,
            destroyed: false,
            gunnery: 2,
            piloting: 5,
        }, GameSystem.CLASSIC)).toBe('2');
    });
});