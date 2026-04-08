import {
    resolveMegaMekFactionRecord,
    type MegaMekFactionRecordData,
} from './factions.model';

function createFaction(overrides: Partial<MegaMekFactionRecordData> & Pick<MegaMekFactionRecordData, 'id'>): MegaMekFactionRecordData {
    return {
        id: overrides.id,
        name: overrides.name ?? overrides.id,
        yearsActive: overrides.yearsActive ?? [],
        ratingLevels: overrides.ratingLevels ?? [],
        nameChanges: overrides.nameChanges ?? [],
        fallBackFactions: overrides.fallBackFactions ?? [],
        tags: overrides.tags ?? [],
        ancestry: overrides.ancestry ?? [],
        capital: overrides.capital,
        capitalChanges: overrides.capitalChanges,
        color: overrides.color,
        logo: overrides.logo,
        camos: overrides.camos,
        nameGenerator: overrides.nameGenerator,
        rankSystem: overrides.rankSystem,
        successor: overrides.successor,
        factionLeaders: overrides.factionLeaders,
        preInvasionHonorRating: overrides.preInvasionHonorRating,
        postInvasionHonorRating: overrides.postInvasionHonorRating,
        formationBaseSize: overrides.formationBaseSize,
        formationGrouping: overrides.formationGrouping,
    };
}

describe('resolveMegaMekFactionRecord', () => {
    it('inherits missing optional fields from the first fallback chain', () => {
        const factions = {
            AA: createFaction({ id: 'AA', fallBackFactions: ['BB'] }),
            BB: createFaction({ id: 'BB', logo: 'bb.png', rankSystem: 'BBRS' }),
        };

        const resolved = resolveMegaMekFactionRecord(factions.AA, factions);

        expect(resolved.logo).toBe('bb.png');
        expect(resolved.rankSystem).toBe('BBRS');
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
});