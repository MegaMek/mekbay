// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestQuadMekEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import type {
    RecordSheetSourceMode,
    RecordSheetSourceService,
} from '../../../services/record-sheet-source.service';
import { RecordSheetSvgGenerator } from '../../../utils/sheets/record-sheet-svg-generator';
import type { PageViewerMember } from './types';
import { PageViewerSheetSourceService } from './page-viewer-sheet-source.service';

describe('PageViewerSheetSourceService', () => {
    let mode: RecordSheetSourceMode;
    let source: jasmine.SpyObj<Pick<RecordSheetSourceService, 'mode' | 'load'>>;

    beforeEach(() => {
        mode = 'generated';
        source = jasmine.createSpyObj('RecordSheetSourceService', ['mode', 'load']);
        source.mode.and.callFake(() => mode);
        source.load.and.callFake(async (_summary, entity, options, requestedMode) => ({
            source: requestedMode ?? mode,
            svgs: [await RecordSheetSvgGenerator.generate(entity, options)],
        }));
    });

    it('generates and retains a Mek sheet from the admitted Entity snapshot', async () => {
        const entity = new TestQuadMekEntity();
        entity.chassis.set('Scorpion');
        const member = createMember('Mek', entity);
        const service = new PageViewerSheetSourceService(source as unknown as RecordSheetSourceService);

        await service.load(member);

        expect(service.svg(member)?.dataset['mekbayGenerated']).toBe('1');
        expect(service.svg(member)?.getAttribute('aria-label')).toBe('Scorpion record sheet');
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('loads non-Mek Classic members through the generic Entity snapshot', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Vedette');
        const member = createMember('Tank', entity);
        const service = new PageViewerSheetSourceService(source as unknown as RecordSheetSourceService);

        await service.load(member);

        expect(service.svg(member)?.dataset['mekbaySheetKind']).toBe('tank-letter');
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('keeps generated and pre-generated retained artwork in separate cache entries', async () => {
        const entity = new TestTankEntity();
        const member = createMember('Tank', entity);
        const service = new PageViewerSheetSourceService(source as unknown as RecordSheetSourceService);

        await service.load(member);
        const generated = service.svg(member);

        mode = 'pre-generated';
        expect(service.svg(member)).toBeNull();
        const legacy = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        legacy.dataset['mekbaySheetSource'] = 'pre-generated';
        source.load.and.resolveTo({ source: 'pre-generated', svgs: [legacy] });
        await service.load(member);

        expect(service.svg(member)).toBe(legacy);
        expect(service.svg(member)).not.toBe(generated);
        expect(source.load).toHaveBeenCalledTimes(2);
    });
});

function createMember(entityType: 'Mek' | 'Tank', entity: TestQuadMekEntity | TestTankEntity): PageViewerMember {
    const getUnitSnapshot = jasmine.createSpy('getUnitSnapshot').and.returnValue({ entity });
    return {
        id: `unit-${entityType}`,
        summary: {
            name: entity.displayName(),
            entityType,
            hash: `hash-${entityType}`,
        },
        force: {
            instanceId: () => 'force-1',
            getUnitSnapshot,
        },
    } as unknown as PageViewerMember;
}
