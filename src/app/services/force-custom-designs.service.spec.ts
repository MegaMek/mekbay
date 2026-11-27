// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { TestBed } from '@angular/core/testing';
import { ForceCustomDesignsService } from './force-custom-designs.service';
import { DialogsService } from './dialogs.service';
import type { CBTForce } from '../models/cbt-force.model';
import { asUnitUuid } from './unit-catalog/unit-catalog.types';
import { MAX_EMBEDDED_CUSTOM_DESIGNS, CUSTOM_DESIGN_COUNT_LIMIT_MESSAGE } from '../models/custom-design-policy';

const design = (n: number) => {
    const uuid = asUnitUuid('019f6767-0dcb-7bb8-992f-' + String(n).padStart(12, '0'));
    return { uuid, source: { format: 'mtf' as const, source: 'uuid:' + uuid + '\nchassis:Test\nmodel:' + n + '\n' } };
};

describe('custom design hard cap', () => {
    let notice: jasmine.Spy;
    function force(count: number, repeated = false): CBTForce {
        const designs = Array.from({ length: count }, (_, i) => design(repeated ? 1 : i + 1));
        return {
            getRuntimeInstanceIds: () => designs.map((_, i) => String(i)),
            getUnitSnapshot: (id: string) => ({ uuid: designs[Number(id)].uuid, nativeSource: { isCustom: true, format: 'mtf', bytes: new TextEncoder().encode(designs[Number(id)].source.source).buffer } }),
        } as unknown as CBTForce;
    }
    beforeEach(() => {
        notice = jasmine.createSpy('notice').and.resolveTo();
        TestBed.configureTestingModule({ providers: [ForceCustomDesignsService,
            { provide: DialogsService, useValue: { showNotice: notice } },
        ] });
    });
    it('blocks an additional distinct design with a notice and no option to externalize it', async () => {
        expect(await TestBed.inject(ForceCustomDesignsService).check(force(MAX_EMBEDDED_CUSTOM_DESIGNS), design(21))).toBeFalse();
        expect(notice).toHaveBeenCalledOnceWith(CUSTOM_DESIGN_COUNT_LIMIT_MESSAGE, 'Custom design limit');
    });
    it('allows the twentieth design without ownership or cloud dependencies', async () => {
        expect(await TestBed.inject(ForceCustomDesignsService).check(force(MAX_EMBEDDED_CUSTOM_DESIGNS - 1), design(20))).toBeTrue();
        expect(notice).not.toHaveBeenCalled();
    });
    it('allows another instance of an existing design at the limit', async () => {
        expect(await TestBed.inject(ForceCustomDesignsService).check(force(MAX_EMBEDDED_CUSTOM_DESIGNS), design(1))).toBeTrue();
        expect(notice).not.toHaveBeenCalled();
    });
    it('allows one hundred instances sharing a design', async () => {
        expect(await TestBed.inject(ForceCustomDesignsService).check(force(100, true))).toBeTrue();
        expect(notice).not.toHaveBeenCalled();
    });
    it('allows replacing the last copy of a design or replacing it with a core unit', async () => {
        const policy = TestBed.inject(ForceCustomDesignsService), current = force(MAX_EMBEDDED_CUSTOM_DESIGNS);
        expect(await policy.check(current, design(21), '0')).toBeTrue();
        expect(await policy.check(current, undefined, '0')).toBeTrue();
        expect(notice).not.toHaveBeenCalled();
    });
    it('counts a changed revision separately when other units retain the original', async () => {
        const current = force(MAX_EMBEDDED_CUSTOM_DESIGNS);
        const ids = current.getRuntimeInstanceIds();
        const read = current.getUnitSnapshot;
        current.getRuntimeInstanceIds = () => [...ids, 'duplicate'];
        current.getUnitSnapshot = id => read(id === 'duplicate' ? '0' : id);
        const revision = design(1); revision.source.source += 'changed';
        expect(await TestBed.inject(ForceCustomDesignsService).check(current, revision, '0')).toBeFalse();
    });
    it('does not count an added core unit toward the custom limit', async () => {
        expect(await TestBed.inject(ForceCustomDesignsService).checkNative(force(MAX_EMBEDDED_CUSTOM_DESIGNS), design(21).uuid, undefined)).toBeTrue();
        expect(notice).not.toHaveBeenCalled();
    });
});
