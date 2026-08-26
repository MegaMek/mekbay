// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

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
    const getUnitByName = (name: string) => ({
        name,
        type: 'Mek',
        subtype: name === 'Phoenix Hawk LAM' ? 'Land-Air BattleMek' : 'BattleMek',
    } as any);

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

});

describe('createForcePreviewEntryFromForce', () => {
    it('builds plain preview data for unsaved alpha strike forces without serializing', () => {
        const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
        const liveUnit = {
            id: 'as-1',
            destroyed: false,
            getSummary: () => resolvedUnit,
            alias: () => 'Ace',
            commander: () => true,
            getPilotSkill: () => 3,
            getPilotStats: () => 3,
            getBv: () => 123,
            getPreSkillBv: () => 100,
        } as any;

        const force = {
            serialize: jasmine.createSpy('serialize'),
            instanceId: () => null,
            owned: () => true,
            name: 'Unsaved Alpha Force',
            note: 'Forward recon screen.',
            tags: ['Recon', 'Priority'],
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

        const result = createForcePreviewEntryFromForce(force, [liveUnit]);

        expect(force.serialize).not.toHaveBeenCalled();
        expect(result instanceof LoadForceEntry).toBe(false);
        expect(result.instanceId).toBe('');
        expect(result.note).toBe('Forward recon screen.');
        expect(result.tags).toEqual(['Recon', 'Priority']);
        expect(result.pv).toBe(123);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Striker',
            formationId: 'battle-lance',
            force: result,
        }));
        expect(getForcePreviewResolvedUnits(result)).toEqual([resolvedUnit]);
        expect(getForcePreviewUnitPilotStats(result.groups[0].units[0], result.type)).toBe('3');
    });

    it('projects a retained CBT member through the original summary view', () => {
        const resolvedUnit = { name: 'Crab CRB-20', type: 'Mek', bv: 1143 } as any;
        const force = {
            instanceId: () => 'force-v2',
            owned: () => true,
            name: 'Retained Force',
            note: '',
            tags: [],
            gameSystem: GameSystem.CLASSIC,
            faction: () => null,
            era: () => null,
            timestamp: '2026-08-14T00:00:00.000Z',
            groups: () => [{
                id: 'group-v2',
                name: () => 'Lance',
                activeFormation: () => null,
                units: () => [],
            }],
            getUnitCrewAssignment: () => ({
                schemaVersion: 1,
                positions: [{ positionId: 'crew:pilot', name: 'Ace', role: 'pilot', gunnery: 3, piloting: 4 }],
            }),
            getUnitDestroyed: () => true,
            isUnitCommander: () => true,
            getUnitAdjustedBattleValue: () => 1200,
            getUnitPristineBattleValue: () => 1143,
        } as any;
        const member = {
            kind: 'cbt',
            id: 'unit-v2',
            force,
            summary: resolvedUnit,
            rosterGroupId: 'group-v2',
            adjustedBattleValue: () => 1200,
        } as const;

        const result = createForcePreviewEntryFromForce(force, [member as any]);

        expect(result.bv).toBe(1200);
        expect(result.groups).toEqual([jasmine.objectContaining({
            name: 'Lance',
            force: result,
            units: [jasmine.objectContaining({
                unit: resolvedUnit,
                destroyed: true,
                commander: true,
                gunnery: 3,
                piloting: 4,
                lockKey: 'unit-v2',
            })],
        })]);
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
