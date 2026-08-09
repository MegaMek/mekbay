// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import { combineEquipmentStatuses } from './equipment-status.model';

describe('equipment status', () => {
    it('returns available for no restrictions', () => {
        expect(combineEquipmentStatuses([])).toBe('available');
        expect(combineEquipmentStatuses(['available'])).toBe('available');
    });

    it('gives disabled precedence over available', () => {
        expect(combineEquipmentStatuses(['available', 'disabled'])).toBe('disabled');
    });

    it('gives destroyed precedence over every other status', () => {
        expect(combineEquipmentStatuses(['disabled', 'destroyed', 'available'])).toBe('destroyed');
    });
});