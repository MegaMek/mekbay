// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { GameSystem } from './common.model';
import { LoadForceEntry } from './load-force-entry.model';
import {
    createForcePreviewEntryFromForce,
    createForcePreviewEntryFromSerializedForce,
    createForcePreviewUnitFromSerializedUnit,
    getForcePreviewResolvedUnits,
    getForcePreviewUnitPilotStats,
    isForcePreviewEntry,
} from './force-preview.model';
import { asUnitUuid } from '../services/unit-catalog/unit-catalog.types';

describe('createForcePreviewUnitFromSerializedUnit', () => {
    const getUnitByName = (name: string) => ({
        name,
        type: 'Mek',
        subtype: name === 'Phoenix Hawk LAM' ? 'Land-Air BattleMek' : 'BattleMek',
    } as any);

    it('reads alpha strike pilot skill from its independently owned person', () => {
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

        const result = createForcePreviewUnitFromSerializedUnit(serializedUnit, getUnitByName,
            { id: 'person:ace', name: 'Ace', gunnery: 3, commander: true });

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
            gameSystem: GameSystem.AS,
            faction: () => null,
            era: () => null,
            totalBv: () => 123,
            timestamp: null,
            personnel: () => ({
                people: [{ id: 'assigned' }, { id: 'reserve' }],
                assignments: [{ unitId: 'as-1', positionId: 'pilot', personId: 'assigned' }],
            }),
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
        expect(result.reserveCount).toBe(1);
        expect(result.groups[0]).toEqual(jasmine.objectContaining({
            name: 'Striker',
            formationId: 'battle-lance',
            force: result,
        }));
        expect(getForcePreviewResolvedUnits(result)).toEqual([resolvedUnit]);
        expect(getForcePreviewUnitPilotStats(result.groups[0].units[0], result.type)).toBe('3');
    });

    it('projects a retained CBT member through an explicit catalog resolver', () => {
        const resolvedUnit = { name: 'Crab CRB-20', type: 'Mek', bv: 1143 } as any;
        const force = {
            instanceId: () => 'force-v2',
            owned: () => true,
            name: 'Retained Force',
            note: '',
            tags: [],
            gameSystem: GameSystem.CBT,
            faction: () => null,
            era: () => null,
            timestamp: '2026-08-14T00:00:00.000Z',
            personnel: () => ({ people: [], assignments: [] }),
            groups: () => [{
                id: 'group-v2',
                name: () => 'Lance',
                activeFormation: () => null,
                units: () => [],
            }],
            getUnitCrewAssignment: () => ({
                schemaVersion: 1,
                positions: [{ positionId: 'crew:pilot', name: 'Ace', gunnery: 3, piloting: 4 }],
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

        const result = createForcePreviewEntryFromForce(
            force,
            [member as any],
            {},
            () => resolvedUnit,
        );

        expect(result.bv).toBe(1200);
        expect(result.reserveCount).toBe(0);
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
    it('counts unassigned people in a normalized save without manufacturing a unit group', () => {
        const result = createForcePreviewEntryFromSerializedForce({
            version: 2, type: GameSystem.AS, instanceId: 'force', timestamp: '', name: 'Force',
            personnel: {
                people: [{ id: 'pilot' }, { id: 'reserve:1' }, { id: 'reserve:2' }],
                assignments: [{ unitId: 'unit', positionId: 'pilot', personId: 'pilot' }],
            },
            groups: [{ id: 'group', units: [{ id: 'unit', uuid: asUnitUuid('019f6767-0dcb-7bb8-992f-aef08202f5e2') }] }],
        }, {
            getUnitByName: () => undefined, getUnitByUuid: () => undefined,
            getFactionById: () => undefined, getEraById: () => undefined,
        });

        expect(result.reserveCount).toBe(2);
        expect(result.groups.length).toBe(1);
        expect(result.groups[0].units.length).toBe(1);
        expect(JSON.stringify({ ...result, groups: undefined })).not.toContain('reserve:');
    });

    it('treats saved load entries as compatible preview entries', () => {
        const resolvedUnit = { name: 'Atlas AS7-D', type: 'Mek' } as any;
        const entry = new LoadForceEntry({
            type: GameSystem.CBT,
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
        }, GameSystem.CBT)).toBe('2');
    });
});
