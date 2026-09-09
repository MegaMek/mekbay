// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { createEmptyUnit } from '../testing/unit-test-helpers';
import type { Force } from '../models/force.model';
import { CBTForce } from '../models/cbt-force.model';
import { ASForceUnit } from '../models/as-force-unit.model';
import { GameSystem } from '../models/common.model';
import type { UnitSummary } from '../models/unit-summary.model';
import { buildForceQueryParams, buildMultiForceQueryParams, buildUnitShareLinks, parseForceUrl } from './force-url.util';

const catalogUnit = createEmptyUnit({ name: 'BMKingCrab_KGC000Custom' });
const customUnit = createEmptyUnit({ name: catalogUnit.name, isCustom: true });
const secondCustomUnit = createEmptyUnit({ name: catalogUnit.name, isCustom: true });
const mixedCatalog = [customUnit, catalogUnit, secondCustomUnit];

describe('parseForceUrl', () => {
    const units = [
        createEmptyUnit({ name: 'BMAtlas_AS7D', id: 140 }),
        createEmptyUnit({ name: 'BMAtlas_AS7K', id: 144 }),
        createEmptyUnit({ name: 'BMLocust_LCT1V', id: 1901 }),
    ];

    it('decodes case-insensitive native names without constructing runtime owners', () => {
        const groups = parseForceUrl('bmatlas_as7d,bmlocust_lct1v', units);

        expect(groups).toEqual([jasmine.objectContaining({
            name: null,
            formationId: null,
            units: [
                jasmine.objectContaining({ summary: units[0] }),
                jasmine.objectContaining({ summary: units[2] }),
            ],
        })]);
    });

    it('decodes MUL IDs, group metadata, and skills while keeping the first duplicate', () => {
        const logger = { warn: jasmine.createSpy('warn') };
        const groups = parseForceUrl('Alpha;assault~140:3:4,1901', units, logger, 'mulId');

        expect(groups).toEqual([{
            name: 'Alpha',
            formationId: 'assault',
            units: [
                { summary: units[0], gunnerySkill: 3, pilotingSkill: 4 },
                { summary: units[2] },
            ],
        }]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('reports missing rows and never creates a compatibility runtime', () => {
        const logger = { warn: jasmine.createSpy('warn') };

        expect(parseForceUrl('missing', units, logger)).toEqual([{
            name: null,
            formationId: null,
            units: [],
        }]);
        expect(logger.warn).toHaveBeenCalledOnceWith('Unit with UUID or non-custom name "missing" not found in data');
    });

    it('accepts a mix of catalog names and UUIDs, including colliding custom designs', () => {
        const groups = parseForceUrl(
            `Alpha;assault~${catalogUnit.name.toLowerCase()},${customUnit.uuid.toUpperCase()}:3:4|Beta~${secondCustomUnit.uuid},${catalogUnit.uuid}`,
            mixedCatalog,
        );

        expect(groups.map(group => group.units.map(unit => unit.summary.uuid))).toEqual([
            [catalogUnit.uuid, customUnit.uuid], [secondCustomUnit.uuid, catalogUnit.uuid],
        ]);
        expect(groups[0].name).toBe('Alpha');
        expect(groups[0].formationId).toBe('assault');
        expect(groups[0].units[1]).toEqual({ summary: customUnit, gunnerySkill: 3, pilotingSkill: 4 });
    });

    it('does not resolve a custom name even if only one custom design has it', () => {
        const logger = { warn: jasmine.createSpy('warn') };
        expect(parseForceUrl(customUnit.name, [customUnit], logger)[0].units).toEqual([]);
        expect(logger.warn).toHaveBeenCalled();
    });

    it('gives UUID matches priority over a conflicting catalog name', () => {
        const collision = createEmptyUnit({ name: customUnit.uuid });
        expect(parseForceUrl(customUnit.uuid, [collision, customUnit])[0].units[0].summary).toBe(customUnit);
    });

    it('does not select an arbitrary non-custom unit with an ambiguous name', () => {
        const collision = createEmptyUnit({ name: catalogUnit.name });
        expect(parseForceUrl(catalogUnit.name, [catalogUnit, collision])[0].units).toEqual([]);
        expect(parseForceUrl(catalogUnit.uuid, [catalogUnit, collision])[0].units[0].summary).toBe(catalogUnit);
    });

    it('does not let custom units shadow catalog MUL IDs', () => {
        const custom = createEmptyUnit({ id: 140, isCustom: true });
        expect(parseForceUrl('140', [custom, ...units], undefined, 'mulId')[0].units[0].summary).toBe(units[0]);
    });
});

describe('force URL serialization', () => {

    it('omits session-only lobby forces', () => {
        const persistedForce = { instanceId: () => 'persisted-force' } as unknown as Force;
        const lobbyForce = { instanceId: () => 'lobby-force' } as unknown as Force;

        const params = buildMultiForceQueryParams([
            { force: persistedForce, alignment: 'friendly', changeSub: null },
            { force: lobbyForce, alignment: 'enemy', changeSub: null, persistInUrl: false },
        ]);

        expect(params.instance).toBe('persisted-force');
    });

    function forceWithUnits(system: GameSystem, summaries: UnitSummary[] = [catalogUnit, customUnit, secondCustomUnit]): Force {
        const common = {
            gameSystem: system,
            name: 'Collision test',
            instanceId: () => null,
            faction: () => null,
            era: () => null,
        };
        if (system === GameSystem.CBT) {
            return Object.setPrototypeOf({ ...common,
                queryCanonicalRoster: () => ({ kind: 'available', snapshot: {
                    groups: [{ groupId: 'alpha', name: 'Alpha', formationId: 'assault' }],
                    members: summaries.map((_, index) => ({ instanceId: String(index), groupId: 'alpha' })),
                } }),
                getUnitUuid: (id: string) => summaries[Number(id)].uuid,
                getUnitCrewPolicy: () => ({ positions: [{ positionId: 'pilot' }] }),
                getAssignedPerson: () => ({ gunnery: 3, piloting: 4 }),
            }, CBTForce.prototype) as unknown as CBTForce;
        }
        return { ...common, groups: () => [{
            name: () => 'Alpha',
            activeFormation: () => ({ id: 'assault' }),
            units: () => summaries.map(summary => Object.assign(Object.create(ASForceUnit.prototype), {
                getSummary: () => summary, pilotSkill: () => 3,
            })),
        }] } as unknown as Force;
    }

    for (const system of [GameSystem.CBT, GameSystem.AS]) {
        it(`round-trips ${system} clean shares and browser URLs with UUIDs for all units`, () => {
            const force = forceWithUnits(system);
            const params = buildForceQueryParams(force);
            const multiParams = buildMultiForceQueryParams([
                { force, alignment: 'friendly', changeSub: null },
            ]);
            const skills = system === GameSystem.CBT ? ':3:4' : ':3';
            const expected = `Alpha;assault~${catalogUnit.uuid}${skills},${customUnit.uuid}${skills},${secondCustomUnit.uuid}${skills}`;

            expect(params.units).toBe(expected);
            expect(multiParams.units).toBe(expected);
            expect(parseForceUrl(params.units!, mixedCatalog)[0].units.map(unit => unit.summary.uuid))
                .toEqual([catalogUnit.uuid, customUnit.uuid, secondCustomUnit.uuid]);
        });
    }

    it('serializes non-Mek CBT designs without requiring a Mek record sheet', () => {
        const tank = createEmptyUnit({ name: 'CVCustomTank', type: 'Tank', isCustom: true });
        const force = forceWithUnits(GameSystem.CBT, [tank]);
        const params = buildForceQueryParams(force);
        expect(params.units).toBe(`Alpha;assault~${tank.uuid}:3:4`);
        expect(parseForceUrl(params.units!, [tank])[0].units[0].summary).toBe(tank);
    });

    it('retains a design UUID when its catalog summary is unavailable', () => {
        const force = forceWithUnits(GameSystem.CBT);
        const params = buildForceQueryParams(force);
        expect(params.units).toBe(`Alpha;assault~${catalogUnit.uuid}:3:4,${customUnit.uuid}:3:4,${secondCustomUnit.uuid}:3:4`);
    });
});

describe('unit share links', () => {
    for (const unit of mixedCatalog) {
        it(`shares ${unit.isCustom ? 'custom UUID ' + unit.uuid : 'the catalog UUID'} in HTTP and app links`, () => {
            const links = buildUnitShareLinks('https://mekbay.com', '/app/', GameSystem.CBT, unit, 'General');
            for (const link of [links.httpsUrl, links.appUrl]) {
                const params = new URL(link).searchParams;
                expect(params.get('shareUnit')).toBe(unit.uuid);
                expect(params.get('tab')).toBe('General');
                expect(params.get('gs')).toBe(GameSystem.CBT);
                expect(parseForceUrl(params.get('shareUnit')!, mixedCatalog)[0].units[0].summary).toBe(unit);
            }
        });
    }

    it('encodes UUIDs and tab names as query values', () => {
        const unit = createEmptyUnit({ name: 'Catalog & Special/Unit' });
        const links = buildUnitShareLinks('https://mekbay.com', '/', GameSystem.AS, unit, 'Tab & Name');
        expect(new URL(links.httpsUrl).searchParams.get('shareUnit')).toBe(unit.uuid);
        expect(new URL(links.httpsUrl).searchParams.get('tab')).toBe('Tab & Name');
    });
});
