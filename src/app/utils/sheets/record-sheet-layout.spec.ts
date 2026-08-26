// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import {
    TestBattleArmorEntity,
    TestBipedMekEntity,
    TestInfantryEntity,
    TestProtoMekEntity,
    TestSupportNavalEntity,
    TestTankEntity,
    TestVtolEntity,
} from '../../models/entity/testing/test-entities';
import {
    planRecordSheetPages,
    recordSheetPageProfile,
} from './record-sheet-layout';
import { recordSheetLayoutProfile } from './layouts/record-sheet-layout-resolver';

describe('record-sheet page layout', () => {
    it('classifies every MegaMekLab small-unit family as compact', () => {
        expect(recordSheetLayoutProfile(new TestBattleArmorEntity()).kind).toBe('battle-armor');
        expect(recordSheetLayoutProfile(new TestInfantryEntity()).kind).toBe('infantry');
        expect(recordSheetLayoutProfile(new TestProtoMekEntity()).kind).toBe('protomek');
        expect(recordSheetLayoutProfile(new TestTankEntity()).kind).toBe('vehicle');
        expect(recordSheetLayoutProfile(new TestVtolEntity()).kind).toBe('vehicle');
        expect(recordSheetLayoutProfile(new TestSupportNavalEntity()).kind).toBe('vehicle');
        const wige = new TestTankEntity();
        wige.motiveType.set('WiGE');
        expect(recordSheetLayoutProfile(wige).kind).toBe('vehicle');
        expect(recordSheetLayoutProfile(new TestBipedMekEntity()).compact).toBeFalse();
    });

    it('fits five Battle Armor units on a page', () => {
        const units = Array.from({ length: 6 }, () => new TestBattleArmorEntity());
        const pages = planRecordSheetPages(units, recordSheetLayoutProfile);

        expect(pages.map(page => page.items.length)).toEqual([5, 1]);
    });

    it('fits four infantry and five ProtoMeks on their shared-family pages', () => {
        const infantry = Array.from({ length: 5 }, () => new TestInfantryEntity());
        const protoMeks = Array.from({ length: 6 }, () => new TestProtoMekEntity());

        expect(planRecordSheetPages(infantry, recordSheetLayoutProfile)
            .map(page => page.items.length)).toEqual([4, 1]);
        expect(planRecordSheetPages(protoMeks, recordSheetLayoutProfile)
            .map(page => page.items.length)).toEqual([5, 1]);
    });

    it('fits two vehicles on a page', () => {
        const units = Array.from({ length: 4 }, () => new TestTankEntity());
        const pages = planRecordSheetPages(units, recordSheetLayoutProfile);

        expect(recordSheetLayoutProfile(units[0]).pageContentY)
            .toBe(recordSheetPageProfile('letter').margin);
        expect(pages.map(page => page.items.length)).toEqual([2, 2]);
    });

    it('gets compact page origins from the owning family layouts', () => {
        const page = recordSheetPageProfile('letter');

        expect(recordSheetLayoutProfile(new TestBattleArmorEntity()).pageContentY)
            .toBe(page.compactContentY);
        expect(recordSheetLayoutProfile(new TestProtoMekEntity()).pageContentY)
            .toBe(page.compactContentY);
        expect(recordSheetLayoutProfile(new TestTankEntity()).pageContentY)
            .toBe(page.margin);
        expect(recordSheetLayoutProfile(new TestSupportNavalEntity()).pageContentY)
            .toBe(page.margin);
    });

    it('uses the full compact content height for naval sheets', () => {
        const naval = new TestSupportNavalEntity();
        const profile = recordSheetLayoutProfile(naval);
        const pages = planRecordSheetPages([naval, new TestTankEntity()], recordSheetLayoutProfile);

        expect(profile.height).toBe(recordSheetPageProfile('letter').contentHeight);
        expect(pages.map(page => page.items.length)).toEqual([1, 1]);
    });

    it('derives A4 dimensions and compact capacity from the A4 profile', () => {
        const page = recordSheetPageProfile('a4');
        const battleArmor = Array.from({ length: 6 }, () => new TestBattleArmorEntity());
        const vehicles = Array.from({ length: 4 }, () => new TestTankEntity());

        expect(page.width).toBe(595.276);
        expect(page.height).toBe(841.89);
        expect(page.contentWidth).not.toBe(recordSheetPageProfile('letter').contentWidth);
        expect(recordSheetLayoutProfile(new TestBattleArmorEntity(), 'a4').height).toBe(146.2);
        expect(recordSheetLayoutProfile(new TestInfantryEntity(), 'a4').height).toBe(186.5);
        expect(recordSheetLayoutProfile(new TestProtoMekEntity(), 'a4').height).toBe(149.2);
        expect(recordSheetLayoutProfile(new TestTankEntity(), 'a4').height).toBe(400);
        expect(planRecordSheetPages(
            battleArmor,
            entity => recordSheetLayoutProfile(entity, 'a4'),
            'a4',
        ).map(result => result.items.length)).toEqual([5, 1]);
        expect(planRecordSheetPages(
            vehicles,
            entity => recordSheetLayoutProfile(entity, 'a4'),
            'a4',
        ).map(result => result.items.length)).toEqual([2, 2]);
    });

    it('keeps contiguous compact runs separate around full sheets', () => {
        const units = [
            new TestTankEntity(),
            new TestTankEntity(),
            new TestBipedMekEntity(),
            new TestBattleArmorEntity(),
            new TestProtoMekEntity(),
        ];
        const pages = planRecordSheetPages(units, recordSheetLayoutProfile);

        expect(pages.map(page => ({ compact: page.compact, count: page.items.length }))).toEqual([
            { compact: true, count: 2 },
            { compact: false, count: 1 },
            { compact: true, count: 2 },
        ]);
        expect(pages.flatMap(page => page.items)).toEqual(units);
    });
});
