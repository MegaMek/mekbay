// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestQuadMekEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import { TestBed } from '@angular/core/testing';
import { RecordSheetSourceService } from '../../../services/record-sheet-source.service';
import { RecordSheetSvgGenerator } from '../../../utils/sheets/record-sheet-svg-generator';
import type { PageViewerMember } from './types';
import { PageViewerSheetSourceService } from './page-viewer-sheet-source.service';

describe('PageViewerSheetSourceService', () => {
    let source: jasmine.SpyObj<Pick<RecordSheetSourceService, 'load'>>;
    let service: PageViewerSheetSourceService;

    beforeEach(() => {
        source = jasmine.createSpyObj('RecordSheetSourceService', ['load']);
        source.load.and.callFake(async (entity, options) => ({
            svgs: [await RecordSheetSvgGenerator.generate(entity, options)],
        }));
        TestBed.configureTestingModule({
            providers: [
                PageViewerSheetSourceService,
                { provide: RecordSheetSourceService, useValue: source },
            ],
        });
        service = TestBed.inject(PageViewerSheetSourceService);
    });

    it('generates and retains a Mek sheet from the admitted Entity snapshot', async () => {
        const entity = new TestQuadMekEntity();
        entity.chassis.set('Scorpion');
        const member = createMember('Mek', entity);
        await service.load(member);

        expect(service.svg(member)?.dataset['mekbayGenerated']).toBe('1');
        expect(service.svg(member)?.getAttribute('aria-label')).toBe('Scorpion record sheet');
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('loads non-Mek Classic members through the generic Entity snapshot', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Vedette');
        const member = createMember('Tank', entity);
        await service.load(member);

        expect(service.svg(member)?.dataset['mekbaySheetKind']).toBe('tank-letter');
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('retains one generated sheet until the cache is explicitly cleared', async () => {
        const entity = new TestTankEntity();
        const member = createMember('Tank', entity);
        await service.load(member);
        const first = service.svg(member);
        await service.load(member);

        expect(service.svg(member)).toBe(first);
        expect(source.load).toHaveBeenCalledTimes(1);

        service.clear();
        expect(service.svg(member)).toBeNull();
        await service.load(member);

        expect(service.svg(member)).not.toBe(first);
        expect(source.load).toHaveBeenCalledTimes(2);
    });
});

function createMember(entityType: 'Mek' | 'Tank', entity: TestQuadMekEntity | TestTankEntity): PageViewerMember {
    const getUnitSnapshot = jasmine.createSpy('getUnitSnapshot').and.returnValue({ entity });
    return {
        id: `unit-${entityType}`,
        entity,
        force: {
            instanceId: () => 'force-1',
            getUnitSnapshot,
            getUnitSourceIdentity: () => ({
                provider: 'mm-data',
                uuid: entity.uuid(),
                sourceHashAtSave: `hash-${entityType}`,
            }),
        },
    } as unknown as PageViewerMember;
}
