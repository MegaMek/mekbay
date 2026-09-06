// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { unitCrewKind } from './unit-crew-policy';

describe('unit crew policy', () => {
    it('distinguishes crewless equipment, integrated infantry, and swappable crew', () => {
        expect(unitCrewKind('Building', 'Building')).toBe('none');
        expect(unitCrewKind('Handheld Weapon', 'Handheld Weapon')).toBe('none');
        expect(unitCrewKind('Tank', 'Support Vehicle', 0)).toBe('none');
        expect(unitCrewKind('Infantry', 'Conventional Infantry')).toBe('integrated');
        expect(unitCrewKind('Infantry', 'Mechanized Conventional Infantry')).toBe('integrated');
        expect(unitCrewKind('Infantry', 'Battle Armor')).toBe('swappable');
        expect(unitCrewKind('ProtoMek', 'ProtoMek')).toBe('swappable');
        expect(unitCrewKind('Mek', 'Tripod BattleMek')).toBe('swappable');
    });
});
