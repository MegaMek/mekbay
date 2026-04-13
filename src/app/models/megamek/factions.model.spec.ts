import {
    resolveMegaMekFactionRecord,
    type MegaMekFactionRecordData,
} from './factions.model';

function createFaction(overrides: Partial<MegaMekFactionRecordData> & Pick<MegaMekFactionRecordData, 'id'>): MegaMekFactionRecordData {
    return {
        id: overrides.id,
        name: overrides.name ?? overrides.id,
        mulId: overrides.mulId ?? [],
        yearsActive: overrides.yearsActive ?? [],
        fallBackFactions: overrides.fallBackFactions ?? [],
        ancestry: overrides.ancestry ?? [],
        nameChanges: overrides.nameChanges ?? [],
        color: overrides.color,
        logo: overrides.logo,
    };
}

describe('resolveMegaMekFactionRecord', () => {
    it('inherits missing optional fields from the first fallback chain', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB'] }),
            BB: createFaction({ id: 'BB', logo: 'bb.png', color: [1, 2, 3] }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.logo).toBe('bb.png');
        expect(resolved.color).toEqual([1, 2, 3]);
    });

    it('resolves depth-first before moving to the next fallback', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB', 'CC'] }),
            BB: createFaction({ id: 'BB', fallBackFactions: ['DD'] }),
            CC: createFaction({ id: 'CC', logo: 'cc.png' }),
            DD: createFaction({ id: 'DD', logo: 'dd.png' }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.logo).toBe('dd.png');
    });

    it('continues to later fallbacks when an earlier chain does not resolve a field', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB', 'CC'] }),
            BB: createFaction({ id: 'BB', fallBackFactions: ['DD'] }),
            CC: createFaction({ id: 'CC', logo: 'cc.png' }),
            DD: createFaction({ id: 'DD' }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.logo).toBe('cc.png');
    });

    it('avoids cycles and still checks later fallbacks', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB', 'CC'] }),
            BB: createFaction({ id: 'BB', fallBackFactions: ['AA'] }),
            CC: createFaction({ id: 'CC', logo: 'cc.png' }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.logo).toBe('cc.png');
    });

    it('treats empty mulId arrays as unresolved and continues fallback lookup', () => {
        const factions = {
            AA: createFaction({ id: 'AA', mulId: [], fallBackFactions: ['BB'] }),
            BB: createFaction({ id: 'BB', mulId: [42] }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.mulId).toEqual([42]);
    });

    it('preserves an empty mulId array when no fallback resolves it', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB'] }),
            BB: createFaction({ id: 'BB' }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.mulId).toEqual([]);
    });
});