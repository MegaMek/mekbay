// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { formatEquipmentLocationCodes } from './equipment-location-display.util';

describe('formatEquipmentLocationCodes', () => {
    it('uses the requested separator for up to three distinct locations', () => {
        expect(formatEquipmentLocationCodes(['LA', 'LT', 'LL'], ', ')).toBe('LA, LT, LL');
    });

    it('uses an asterisk when equipment spans more than three locations', () => {
        expect(formatEquipmentLocationCodes(['HD', 'FLL', 'RT', 'FRL', 'RLL', 'RRL'])).toBe('*');
    });

    it('does not count duplicate or empty location codes', () => {
        expect(formatEquipmentLocationCodes(['LT', 'LT', '', 'RT'])).toBe('LT/RT');
    });
});
