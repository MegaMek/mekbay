// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { TestBed } from '@angular/core/testing';
import { ArmorEquipment } from '../models/equipment.model';
import { EquipmentRegistry } from '../models/equipment-lookup';
import type { UnitSummary } from '../models/unit-summary.model';
import { createEmptyUnit } from '../testing/unit-test-helpers';
import { DataService } from './data.service';
import { LoggerService } from './logger.service';
import { sha1Base64Url } from '../utils/sha1.util';
import {
    asSourceHash,
    asUnitProviderId,
    asUnitUuid,
    makeUnitFileName,
    MM_DATA_UNIT_PROVIDER_ID,
} from './unit-catalog/unit-catalog.types';
import { UnitDetailsSummaryService } from './unit-details-summary.service';
import { UnitsCatalogService } from './catalogs/units-catalog.service';
import { parseEntity } from '../models/entity/parse-entity';
import type { CBTForceMember } from '../models/force-member.model';

describe('UnitDetailsSummaryService', () => {
    const uuid = asUnitUuid('019f583e-b5e8-7032-b925-ba6c429a0687');
    let data: jasmine.SpyObj<Pick<
        DataService,
        'getEquipmentRegistry' | 'getSourcebookByAbbrev' | 'getQuirkByKey' | 'getUnitByUuid'
    >>;
    let catalog: jasmine.SpyObj<Pick<UnitsCatalogService, 'readNativeUnitSource'>>;
    let logger: jasmine.SpyObj<Pick<LoggerService, 'warn'>>;
    let service: UnitDetailsSummaryService;

    beforeEach(() => {
        data = jasmine.createSpyObj('DataService', [
            'getEquipmentRegistry',
            'getSourcebookByAbbrev',
            'getQuirkByKey',
            'getUnitByUuid',
        ]);
        catalog = jasmine.createSpyObj('UnitsCatalogService', ['readNativeUnitSource']);
        logger = jasmine.createSpyObj('LoggerService', ['warn']);
        data.getEquipmentRegistry.and.returnValue(equipmentRegistry());
        data.getSourcebookByAbbrev.and.returnValue(undefined);
        data.getQuirkByKey.and.returnValue(undefined);

        TestBed.configureTestingModule({
            providers: [
                UnitDetailsSummaryService,
                { provide: DataService, useValue: data },
                { provide: UnitsCatalogService, useValue: catalog },
                { provide: LoggerService, useValue: logger },
            ],
        });
        service = TestBed.inject(UnitDetailsSummaryService);
    });

    it('rebuilds the active native row through the canonical entity summary path', async () => {
        const bytes = new TextEncoder().encode([
            '<UUID>', uuid, '</UUID>',
            '<UnitType>', 'BuildingEntity', '</UnitType>',
            '<Name>', 'Medium Sniper Turret', '</Name>',
            '<Model>', '(3075)', '</Model>',
            '<year>', '3075', '</year>',
            '<type>', 'IS Level 3', '</type>',
        ].join('\n')).buffer;
        const hash = asSourceHash(await sha1Base64Url(bytes));
        const file = makeUnitFileName(uuid, 'blk');
        const cached = nativeSummary(hash);
        catalog.readNativeUnitSource.and.resolveTo({ file, hash, format: 'blk', bytes });

        const rebuilt = await service.resolve(cached);

        expect(catalog.readNativeUnitSource).toHaveBeenCalledOnceWith(uuid);
        expect(rebuilt).not.toBe(cached);
        expect(rebuilt.entityType).toBe('BuildingEntity');
        expect(rebuilt.chassis).toBe('Medium Sniper Turret');
        expect(rebuilt.icon).toBe('catalog-icon');
        expect(rebuilt._searchKey).toBe('cached-search-overlay');
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('leaves a non-native summary untouched', async () => {
        const cached = createEmptyUnit({
            origin: 'user',
            provider: asUnitProviderId('user:local'),
        });

        await expectAsync(service.resolve(cached)).toBeResolvedTo(cached);

        expect(catalog.readNativeUnitSource).not.toHaveBeenCalled();
    });

    it('falls back to the cached summary when installed source evidence does not match', async () => {
        const hash = asSourceHash('A'.repeat(27));
        const file = makeUnitFileName(uuid, 'blk');
        const cached = nativeSummary(hash);
        catalog.readNativeUnitSource.and.resolveTo({
            file,
            hash: asSourceHash('B'.repeat(26) + 'A'),
            format: 'blk',
            bytes: new ArrayBuffer(0),
        });

        const resolved = await service.resolve(cached);

        expect(resolved).toBe(cached);
        expect(logger.warn).toHaveBeenCalledOnceWith(
            jasmine.stringContaining('native source does not match the selected catalog summary'),
        );
    });

    it('projects the force-owned design instead of a later custom catalog revision', async () => {
        const { member, hash } = await forceMember('Original refit');
        data.getUnitByUuid.and.returnValue({ ...nativeSummary(asSourceHash('A'.repeat(27))),
            isCustom: true, model: 'Later refit', tons: 999 });

        const summary = service.resolveForceMember(member);

        expect(summary.model).toBe('Original refit');
        expect(summary.tons).not.toBe(999);
        expect(summary.hash).toBe(hash);
        expect(summary.isCustom).toBeTrue();
        expect(summary.icon).toBe('catalog-icon');
        expect(service.resolveForceMember(member)).toBe(summary);
        expect(catalog.readNativeUnitSource).not.toHaveBeenCalled();
    });

    it('keeps a pinned custom design available after catalog deletion', async () => {
        const { member, hash } = await forceMember('Retained refit');
        data.getUnitByUuid.and.returnValue(undefined);

        const summary = service.resolveForceMember(member);

        expect(summary.model).toBe('Retained refit');
        expect(summary.uuid).toBe(uuid);
        expect(summary.hash).toBe(hash);
        expect(summary.isCustom).toBeTrue();
        expect(summary.origin).toBe('user');
        expect(catalog.readNativeUnitSource).not.toHaveBeenCalled();
    });

    it('refreshes details for a replacement force entity with the same UUID and roster ID', async () => {
        const first = await forceMember('First');
        const next = await forceMember('Second');

        expect(service.resolveForceMember(first.member).model).toBe('First');
        expect(service.resolveForceMember(next.member).model).toBe('Second');
        expect(service.resolveForceMember(first.member).model).toBe('First');
    });

    async function forceMember(model: string) {
        const source = [
            '<UUID>', uuid, '</UUID>', '<UnitType>', 'BuildingEntity', '</UnitType>',
            '<Name>', 'Medium Sniper Turret', '</Name>', '<Model>', model, '</Model>',
            '<year>', '3075', '</year>', '<type>', 'IS Level 3', '</type>',
        ].join('\n');
        const entity = parseEntity(source, 'force.blk', equipmentRegistry()).entity;
        const bytes = new TextEncoder().encode(source).buffer;
        const hash = asSourceHash(await sha1Base64Url(bytes));
        const nativeSource = { format: 'blk', file: makeUnitFileName(uuid, 'blk'),
            sourceHash: hash, bytes, isCustom: true };
        const member = { id: 'unit:refit', entity,
            force: { getUnitSnapshot: () => ({ entity, nativeSource }) },
        } as unknown as CBTForceMember;
        return { member, hash };
    }

    function nativeSummary(
        hash: ReturnType<typeof asSourceHash>,
    ): UnitSummary {
        return Object.assign(createEmptyUnit({ uuid }), {
            provider: MM_DATA_UNIT_PROVIDER_ID,
            origin: 'megamek' as const,
            hash,
            entityType: 'BuildingEntity' as const,
            icon: 'catalog-icon',
            _searchKey: 'cached-search-overlay',
        });
    }

    function equipmentRegistry(): EquipmentRegistry {
        const standardArmor = new ArmorEquipment({
            id: 'Standard Armor',
            name: 'Standard',
            type: 'armor',
            armor: { type: 'STANDARD' },
            tech: { base: 'All' },
        });
        return new EquipmentRegistry({ [standardArmor.id]: standardArmor });
    }
});
