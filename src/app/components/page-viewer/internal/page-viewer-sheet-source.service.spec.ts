// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestQuadMekEntity,
    TestTankEntity,
} from '../../../models/entity/testing/test-entities';
import type { CBTForce } from '../../../models/cbt-force.model';
import { CBTForceMember } from '../../../models/force-member.model';
import { asUnitInstanceId } from '../../../models/runtime/runtime-state';
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

        expect(member.recordSheet()?.dataset['mekbayGenerated']).toBe('1');
        expect(member.recordSheet()?.hasAttribute('aria-label')).toBeFalse();
        expect(member.recordSheet()?.querySelector(':scope > title')).toBeNull();
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('loads non-Mek Classic members through the generic Entity snapshot', async () => {
        const entity = new TestTankEntity();
        entity.chassis.set('Vedette');
        const member = createMember('Tank', entity);
        await service.load(member);

        expect(member.recordSheet()?.dataset['mekbaySheetKind']).toBe('tank-letter');
        expect(member.force.getUnitSnapshot).toHaveBeenCalledOnceWith(member.id);
    });

    it('retains one generated sheet for exactly the member lifetime', async () => {
        const entity = new TestTankEntity();
        const member = createMember('Tank', entity);
        await service.load(member);
        const first = member.recordSheet();
        await service.load(member);

        expect(member.recordSheet()).toBe(first);
        expect(source.load).toHaveBeenCalledTimes(1);

        const replacement = createMember('Tank', entity);
        await service.load(replacement);

        expect(replacement.recordSheet()).not.toBe(first);
        expect(source.load).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent generation on the member', async () => {
        const member = createMember('Mek', new TestQuadMekEntity());

        await Promise.all([service.load(member), service.load(member), service.load(member)]);

        expect(source.load).toHaveBeenCalledTimes(1);
    });

    it('allows the member to retry after generation fails', async () => {
        const member = createMember('Tank', new TestTankEntity());
        source.load.and.rejectWith(new Error('generation failed'));

        await expectAsync(service.load(member)).toBeRejectedWithError('generation failed');

        source.load.and.callFake(async (entity, options) => ({
            svgs: [await RecordSheetSvgGenerator.generate(entity, options)],
        }));
        await service.load(member);

        expect(member.recordSheet()).not.toBeNull();
        expect(source.load).toHaveBeenCalledTimes(2);
    });
});

function createMember(entityType: 'Mek' | 'Tank', entity: TestQuadMekEntity | TestTankEntity): PageViewerMember {
    const getUnitSnapshot = jasmine.createSpy('getUnitSnapshot').and.returnValue({ entity });
    const force = {
        getUnitSnapshot,
        getUnitSourceIdentity: () => ({
            provider: 'mm-data',
            uuid: entity.uuid(),
            sourceHashAtSave: `hash-${entityType}`,
        }),
    } as unknown as CBTForce;
    return new CBTForceMember(asUnitInstanceId(`unit-${entityType}`), force, entity);
}
