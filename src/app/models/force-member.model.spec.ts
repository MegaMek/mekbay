// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { CBTForce } from './cbt-force.model';
import { CBTForceMember } from './force-member.model';
import { TestBipedMekEntity } from './entity/testing/test-entities';
import { asUnitInstanceId } from './runtime/runtime-state';

function createMember(id: string): CBTForceMember {
    return new CBTForceMember(
        asUnitInstanceId(id),
        {} as CBTForce,
        new TestBipedMekEntity(),
    );
}

describe('CBTForceMember tactical presentation memory', () => {
    it('defaults every inventory row to collapsed and remembers expansion per unit', () => {
        const first = createMember('first');
        const second = createMember('second');

        expect(first.isTacticalInventoryRowExpanded('weapon-1')).toBeFalse();

        first.setTacticalInventoryRowExpanded('weapon-1', true);

        expect(first.isTacticalInventoryRowExpanded('weapon-1')).toBeTrue();
        expect(second.isTacticalInventoryRowExpanded('weapon-1')).toBeFalse();
    });

    it('keeps presentation memory when gameplay runtime is rebound', () => {
        const member = createMember('unit');
        member.setTacticalInventoryRowsExpanded(['weapon-1', 'equipment-1']);

        member.bindRuntime({}, 1);
        member.bindRuntime({}, 2);

        expect(member.isTacticalInventoryRowExpanded('weapon-1')).toBeTrue();
        expect(member.isTacticalInventoryRowExpanded('equipment-1')).toBeTrue();
        member.setTacticalInventoryRowsExpanded([]);
        expect(member.isTacticalInventoryRowExpanded('weapon-1')).toBeFalse();
    });
});

describe('CBTForceMember record-sheet ownership', () => {
    it('retains every generated page and cycles presentation without regenerating', async () => {
        const member = createMember('unit');
        const front = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const reverse = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const create = jasmine.createSpy('create').and.resolveTo([front, reverse]);

        await member.loadRecordSheets(create);

        expect(member.recordSheets()).toEqual([front, reverse]);
        expect(member.recordSheet()).toBe(front);
        expect(member.recordSheetIndex()).toBe(0);

        expect(member.showNextRecordSheet()).toBe(reverse);
        expect(member.recordSheetIndex()).toBe(1);
        expect(member.showNextRecordSheet()).toBe(front);

        await member.loadRecordSheets(create);
        expect(create).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent generation and permits a retry after failure', async () => {
        const member = createMember('unit');
        const failure = jasmine.createSpy('failure').and.rejectWith(new Error('generation failed'));

        await expectAsync(member.loadRecordSheets(failure)).toBeRejectedWithError('generation failed');

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const create = jasmine.createSpy('create').and.resolveTo([svg]);
        await Promise.all([
            member.loadRecordSheets(create),
            member.loadRecordSheets(create),
            member.loadRecordSheets(create),
        ]);

        expect(create).toHaveBeenCalledTimes(1);
        expect(member.recordSheet()).toBe(svg);
    });

    it('retains at most the two supported record-sheet pages', async () => {
        const member = createMember('unit');
        const pages = Array.from({ length: 3 }, () =>
            document.createElementNS('http://www.w3.org/2000/svg', 'svg'));

        await member.loadRecordSheets(async () => pages);

        expect(member.recordSheets()).toEqual(pages.slice(0, 2));
    });
});
