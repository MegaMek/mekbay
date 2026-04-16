import { GameSystem } from './common.model';
import type { CBTSerializedUnit, SerializedForce } from './force-serialization';
import { createLoadForceEntry, createLoadForceEntryFromSerializedForce, LoadForceEntry, type RemoteLoadForceEntry } from './load-force-entry.model';

describe('createLoadForceEntry', () => {
    const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
    const resolvedFaction = { id: 1, name: 'Mercenary' } as any;
    const resolvedEra = { id: 3025, name: 'Succession Wars' } as any;
    const resolver = {
        getUnitByName: (name: string) => name === 'Atlas AS7-D' ? resolvedUnit : undefined,
        getFactionById: (id: number) => id === 1 ? resolvedFaction : undefined,
        getEraById: (id: number) => id === 3025 ? resolvedEra : undefined,
    };

    it('wraps remote preview data in a saved entry and links groups back to the entry', () => {
        const raw: RemoteLoadForceEntry = {
            owned: true,
            instanceId: 'force-1',
            name: 'Alpha Lance',
            type: GameSystem.ALPHA_STRIKE,
            factionId: 1,
            eraId: 3025,
            pv: 123,
            timestamp: '2026-04-16T00:00:00.000Z',
            groups: [{
                name: 'Striker',
                formationId: 'battle-lance',
                units: [{
                    unit: 'Atlas AS7-D',
                    alias: 'Ace',
                    skill: 3,
                    commander: true,
                    state: {
                        destroyed: false,
                    },
                }],
            }],
        };

        const result = createLoadForceEntry(raw, resolver, { cloud: true });

        expect(result instanceof LoadForceEntry).toBe(true);
        expect(result.cloud).toBe(true);
        expect(result.local).toBe(false);
        expect(result.faction).toBe(resolvedFaction);
        expect(result.era).toBe(resolvedEra);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Striker',
            formationId: 'battle-lance',
            force: result,
        }));
        expect(result.groups[0].units[0]).toEqual(jasmine.objectContaining({
            unit: resolvedUnit,
            alias: 'Ace',
            skill: 3,
            commander: true,
        }));
    });
});

describe('createLoadForceEntryFromSerializedForce', () => {
    const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
    const resolvedFaction = { id: 1, name: 'Mercenary' } as any;
    const resolvedEra = { id: 3025, name: 'Succession Wars' } as any;
    const resolver = {
        getUnitByName: (name: string) => name === 'Atlas AS7-D' ? resolvedUnit : undefined,
        getFactionById: (id: number) => id === 1 ? resolvedFaction : undefined,
        getEraById: (id: number) => id === 3025 ? resolvedEra : undefined,
    };

    it('wraps serialized force data in a saved entry and preserves unit crew stats', () => {
        const serializedUnit: CBTSerializedUnit = {
            id: 'cbt-1',
            unit: 'Atlas AS7-D',
            commander: false,
            state: {
                destroyed: false,
                modified: false,
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

        const raw: SerializedForce = {
            version: 1,
            owned: true,
            instanceId: 'force-2',
            name: 'Classic Lance',
            type: GameSystem.CLASSIC,
            factionId: 1,
            eraId: 3025,
            bv: 1400,
            timestamp: '2026-04-16T00:00:00.000Z',
            groups: [{
                id: 'group-1',
                name: 'Command Lance',
                formationId: 'command-lance',
                units: [serializedUnit],
            }],
        } as SerializedForce;

        const result = createLoadForceEntryFromSerializedForce(raw, resolver, { local: true });

        expect(result instanceof LoadForceEntry).toBe(true);
        expect(result.local).toBe(true);
        expect(result.cloud).toBe(false);
        expect(result.bv).toBe(1400);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Command Lance',
            formationId: 'command-lance',
            force: result,
        }));
        expect(result.groups[0].units[0]).toEqual(jasmine.objectContaining({
            unit: resolvedUnit,
            gunnery: 3,
            piloting: 5,
        }));
        expect(result.faction).toBe(resolvedFaction);
        expect(result.era).toBe(resolvedEra);
    });
});