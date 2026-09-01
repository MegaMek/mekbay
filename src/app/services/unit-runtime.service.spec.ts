// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UnitSummary } from '../models/unit-summary.model';
import type { TagData } from './db.service';
import { PublicTagsService } from './public-tags.service';
import { TagsService } from './tags.service';
import { UnitRuntimeService } from './unit-runtime.service';
import { UnitSearchIndexService } from './unit-search-index.service';
import { getProperty } from '../utils/unit-search-shared.util';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { EquipmentRegistry } from '../models/equipment-lookup';
import { MiscEquipment } from '../models/equipment.model';
import { asSourceHash, asUnitUuid, MM_DATA_UNIT_PROVIDER_ID } from './unit-catalog/unit-catalog.types';

function createUnit(name: string, chassis = name): UnitSummary {
    return createEmptyUnit({ name, chassis, type: 'Mek' });
}

function createCatalogUnit(
    name: string,
    uuid: string,
    sourceHash = asSourceHash('A'.repeat(27)),
): UnitSummary {
    const unit = createUnit(name);
    Object.assign(unit, {
        uuid: asUnitUuid(uuid),
        provider: MM_DATA_UNIT_PROVIDER_ID,
        origin: 'megamek' as const,
        hash: sourceHash,
    });
    return unit;
}

describe('UnitRuntimeService', () => {
    let service: UnitRuntimeService;
    const unitSearchIndexServiceMock = {
        prepareUnits: jasmine.createSpy('prepareUnits'),
        rebuildTagSearchIndex: jasmine.createSpy('rebuildTagSearchIndex'),
    };
    const tagsServiceMock = {
        getTagData: jasmine.createSpy('getTagData'),
        migrateChassisTagsToVariantGroups: jasmine.createSpy('migrateChassisTagsToVariantGroups'),
        fixNameTagsCoveredByChassis: jasmine.createSpy('fixNameTagsCoveredByChassis'),
    };

    beforeEach(() => {
        TestBed.resetTestingModule();
        unitSearchIndexServiceMock.prepareUnits.calls.reset();
        unitSearchIndexServiceMock.rebuildTagSearchIndex.calls.reset();
        tagsServiceMock.getTagData.calls.reset();
        tagsServiceMock.migrateChassisTagsToVariantGroups.calls.reset();
        tagsServiceMock.migrateChassisTagsToVariantGroups.and.callFake((_units: UnitSummary[], data?: TagData) => Promise.resolve(data));
        tagsServiceMock.fixNameTagsCoveredByChassis.calls.reset();
        tagsServiceMock.fixNameTagsCoveredByChassis.and.resolveTo(undefined);

        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                UnitRuntimeService,
                { provide: TagsService, useValue: tagsServiceMock },
                { provide: PublicTagsService, useValue: { getPublicTagsForUnit: jasmine.createSpy('getPublicTagsForUnit') } },
                { provide: UnitSearchIndexService, useValue: unitSearchIndexServiceMock },
            ],
        });

        service = TestBed.inject(UnitRuntimeService);
    });

    it('retrieves units by name without matching case exactly', () => {
        const unit = createUnit('Mad Cat Prime');

        service.preprocessUnits([unit]);

        expect(service.getUnitByName('Mad Cat Prime')).toBe(unit);
        expect(service.getUnitByName('mad cat prime')).toBe(unit);
        expect(service.getUnitByName('MAD CAT PRIME')).toBe(unit);
    });

    it('retrieves distinct units by UUID even when names collide', () => {
        const first = createCatalogUnit('Duplicate Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        const second = createCatalogUnit('Duplicate Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d35678');

        service.preprocessUnits([first, second]);

        expect(service.getUnitsByName('duplicate name')).toEqual([first, second]);
        expect(service.getUnitByName('Duplicate Name')).toBeUndefined();
        expect(service.getUnitByUuid(first.uuid)).toBe(first);
        expect(service.getUnitByUuid(second.uuid)).toBe(second);
    });

    it('resolves a V1 UUID before a conflicting legacy name', () => {
        const requested = createCatalogUnit('Shared Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        const collision = createCatalogUnit('Shared Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d35678');
        service.preprocessUnits([collision, requested]);

        const resolution = service.resolveUnitReference({
            unit: 'A stale legacy name is only evidence',
            entityIdentity: { uuid: requested.uuid },
        });

        expect(resolution.kind).toBe('resolved');
        if (resolution.kind === 'resolved') {
            expect(resolution.unit).toBe(requested);
            expect(resolution.usedLegacyNameFallback).toBeFalse();
        }
        expect(service.getUnitByName('Shared Name')).toBeUndefined();
    });

    it('indexes summaries by UUID without a readiness facade', () => {
        const catalogOnly = createCatalogUnit('Static Emplacement', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        const gameplayReady = createUnit('Gameplay Ready');
        service.preprocessUnits([catalogOnly, gameplayReady]);

        expect(service.getUnitByUuid(catalogOnly.uuid)).toBe(catalogOnly);
        expect(Object.prototype.hasOwnProperty.call(catalogOnly, 'readiness')).toBeFalse();
        expect(Object.prototype.hasOwnProperty.call(gameplayReady, 'readiness')).toBeFalse();
    });

    it('uses a legacy name only when it has exactly one catalog match', () => {
        const unique = createCatalogUnit('Unique Legacy Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        service.preprocessUnits([unique]);

        const resolution = service.resolveUnitReference({ unit: 'unique legacy name' });

        expect(resolution.kind).toBe('resolved');
        if (resolution.kind === 'resolved') {
            expect(resolution.unit).toBe(unique);
            expect(resolution.usedLegacyNameFallback).toBeTrue();
        }
    });

    it('defers ambiguous name-only state instead of selecting the first match', () => {
        const first = createCatalogUnit('Duplicate Legacy Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        const second = createCatalogUnit('Duplicate Legacy Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d35678');
        service.preprocessUnits([first, second]);

        const resolution = service.resolveUnitReference({ unit: 'Duplicate Legacy Name' });

        expect(resolution.kind).toBe('deferred');
        if (resolution.kind === 'deferred') {
            expect(resolution.descriptor.reason).toBe('ambiguous');
            expect(resolution.descriptor.candidates.length).toBe(2);
        }
    });

    it('does not fall back by name when a saved UUID is missing locally', () => {
        const sameNameWrongDesign = createCatalogUnit('Expected Name', '01890f3a-9d5b-7c24-8b2e-6f8a10d35678');
        const missing = createCatalogUnit('Missing', '01890f3a-9d5b-7c24-8b2e-6f8a10d31234');
        const missingIdentity = { uuid: missing.uuid };
        service.preprocessUnits([sameNameWrongDesign]);

        const resolution = service.resolveUnitReference({ unit: 'Expected Name', entityIdentity: missingIdentity });

        expect(resolution.kind).toBe('deferred');
        if (resolution.kind === 'deferred') {
            expect(resolution.descriptor.reason).toBe('not-found');
            expect(resolution.descriptor.requestedUuid).toBe(
                asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234'),
            );
        }
    });

    it('ignores historical V1 source metadata and resolves the saved UUID', () => {
        const current = createCatalogUnit(
            'Updated Unit',
            '01890f3a-9d5b-7c24-8b2e-6f8a10d31234',
            asSourceHash('E'.repeat(27)),
        );
        service.preprocessUnits([current]);

        const resolution = service.resolveUnitReference({
            unit: 'Old Name',
            entityIdentity: {
                uuid: asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234'),
                sourceHashAtSave: asSourceHash('A'.repeat(27)),
            },
        });

        expect(resolution.kind).toBe('resolved');
        if (resolution.kind === 'resolved') {
            expect(resolution.unit).toBe(current);
            expect(resolution.uuid).toBe(asUnitUuid('01890f3a-9d5b-7c24-8b2e-6f8a10d31234'));
        }
    });

    it('precomputes mixed-aware tech-base display values before indexing', () => {
        const units = [
            createEmptyUnit({ name: 'Inner Sphere', techBase: 'Inner Sphere', mixed: false }),
            createEmptyUnit({ name: 'Clan', techBase: 'Clan', mixed: false }),
            createEmptyUnit({ name: 'Mixed Inner Sphere', techBase: 'Inner Sphere', mixed: true }),
            createEmptyUnit({ name: 'Mixed Clan', techBase: 'Clan', mixed: true }),
        ];
        units[0]._techBaseDisplay = 'Mixed (Clan)';

        service.preprocessUnits(units);

        expect(units.map(unit => unit._techBaseDisplay)).toEqual([
            'Inner Sphere',
            'Clan',
            'Mixed (Inner Sphere)',
            'Mixed (Clan)',
        ]);
        expect(unitSearchIndexServiceMock.prepareUnits).toHaveBeenCalledOnceWith(units);
    });

    it('keeps exported source and published arrays available to search helpers', () => {
        const unit = createUnit('Atlas');
        unit.source = ['TR:3039', 'TR:SW'];
        unit.published = ['RSFP:Wave 2', 'RS:Gothic'];

        service.preprocessUnits([unit]);

        expect(unit.source).toEqual(['TR:3039', 'TR:SW']);
        expect(unit.published).toEqual(['RSFP:Wave 2', 'RS:Gothic']);
        expect(getProperty(unit, 'source')).toEqual(['TR:3039', 'TR:SW', 'RSFP:Wave 2', 'RS:Gothic']);
        expect(unitSearchIndexServiceMock.prepareUnits).toHaveBeenCalledOnceWith([unit]);
    });

    it('links equipment recursively through canonical registry aliases', () => {
        const equipment = new MiscEquipment({
            id: 'Canonical Equipment',
            name: 'Canonical Equipment',
            type: 'misc',
            aliases: ['Legacy Equipment'],
        });
        const unit = createUnit('Alias Test');
        unit.comp = [{
            id: ' legacy equipment ', q: 1, n: 'Legacy Equipment', t: 'C', p: 1, l: 'CT',
            bay: [{ id: 'CANONICAL EQUIPMENT', q: 1, n: 'Canonical Equipment', t: 'C', p: 1, l: 'CT' }],
        }];

        service.linkEquipmentToUnit(unit, new EquipmentRegistry({ [equipment.internalName]: equipment }));

        expect(unit.comp[0].eq).toBe(equipment);
        expect(unit.comp[0].bay?.[0].eq).toBe(equipment);
    });

    it('leaves unknown component equipment unresolved', () => {
        const unit = createUnit('Unknown Equipment');
        unit.comp = [{ id: 'Missing Equipment', q: 1, n: 'Missing Equipment', t: 'C', p: 1, l: 'CT' }];

        service.linkEquipmentToUnit(unit, new EquipmentRegistry({}));

        expect(unit.comp[0].eq).toBeUndefined();
    });

    it('removes unit tags that are already covered by same-named chassis tags when applying tag data', () => {
        const prime = createUnit('Dasher Prime', 'Dasher');
        const variantA = createUnit('Dasher A', 'Dasher');
        const adder = createUnit('Adder Prime', 'Adder');
        const tagData: TagData = {
            tags: {
                clan: {
                    label: 'CLAN',
                    units: {
                        'Dasher Prime': { q: 2 },
                        'Dasher A': {},
                        'Adder Prime': {},
                    },
                    chassis: {
                        'Dasher|BM': {},
                    },
                },
                cjf: {
                    label: 'CJF',
                    units: {
                        'Dasher Prime': {},
                        'Dasher A': {},
                    },
                    chassis: {},
                },
            },
            timestamp: 1,
            formatVersion: 4,
        };
        tagsServiceMock.fixNameTagsCoveredByChassis.and.callFake((units: UnitSummary[], data: TagData | null) => {
            for (const unit of units) {
                const chassisKey = TagsService.getChassisTagKey(unit);
                for (const entry of Object.values(data?.tags ?? {})) {
                    if (entry.units[unit.name] !== undefined && entry.chassis[chassisKey] !== undefined) {
                        delete entry.units[unit.name];
                    }
                }
            }
            return Promise.resolve();
        });

        service.applyTagDataToUnits([prime, variantA, adder], tagData, { rebuildTagSearchIndex: false });

        expect(prime._nameTags).toEqual([{ tag: 'CJF', quantity: 1 }]);
        expect(prime._chassisTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(variantA._nameTags).toEqual([{ tag: 'CJF', quantity: 1 }]);
        expect(variantA._chassisTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(adder._nameTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(adder._chassisTags).toEqual([]);
        expect(tagData.tags['clan'].units).toEqual({ 'Adder Prime': {} });
        expect(tagsServiceMock.migrateChassisTagsToVariantGroups).toHaveBeenCalledOnceWith([prime, variantA, adder], tagData);
        expect(tagsServiceMock.fixNameTagsCoveredByChassis).toHaveBeenCalledOnceWith([prime, variantA, adder], tagData);
    });

    it('awaits tag cleanup before hydrating a catalog and can defer its only index rebuild', async () => {
        const unit = createUnit('Dasher Prime', 'Dasher');
        const chassisKey = TagsService.getChassisTagKey(unit);
        const tagData: TagData = {
            tags: {
                clan: {
                    label: 'CLAN',
                    units: { [unit.name]: {} },
                    chassis: { [chassisKey]: {} },
                },
            },
            timestamp: 1,
            formatVersion: 4,
        };
        tagsServiceMock.migrateChassisTagsToVariantGroups.and.resolveTo(tagData);
        let releaseCleanup!: () => void;
        tagsServiceMock.fixNameTagsCoveredByChassis.and.callFake(async () => {
            await new Promise<void>(resolve => { releaseCleanup = resolve; });
            delete tagData.tags['clan'].units[unit.name];
        });

        const hydration = service.loadUnitTags([unit], { rebuildTagSearchIndex: false });
        for (let index = 0; index < 3; index += 1) await Promise.resolve();
        expect(releaseCleanup).toBeDefined();
        expect(unit._chassisTags).toEqual([]);

        releaseCleanup();
        await hydration;

        expect(unit._nameTags).toEqual([]);
        expect(unit._chassisTags).toEqual([{ tag: 'CLAN', quantity: 1 }]);
        expect(tagsServiceMock.migrateChassisTagsToVariantGroups).toHaveBeenCalledOnceWith([unit]);
        expect(tagsServiceMock.fixNameTagsCoveredByChassis).toHaveBeenCalledOnceWith([unit], tagData);
        expect(unitSearchIndexServiceMock.rebuildTagSearchIndex).not.toHaveBeenCalled();
    });
});
