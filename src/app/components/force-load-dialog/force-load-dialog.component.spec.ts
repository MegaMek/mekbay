// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { LoadForceEntry } from '../../models/load-force-entry.model';
import { ForceLoadDialogComponent } from './force-load-dialog.component';

describe('ForceLoadDialogComponent', () => {
    it('does not describe an incomplete cloud list as an empty account', () => {
        const context = { hangarComplete: () => false };
        expect(ForceLoadDialogComponent.prototype.getHangarEmptyStateMessage.call(context as never))
            .toBe('The cloud list is not fully loaded.');
    });

    it('counts every unit across saved-force groups without counting reserve personnel', () => {
        const force = new LoadForceEntry({
            reserveCount: 4,
            groups: [
                { units: [{}, {}] },
                { units: [{}] },
            ] as LoadForceEntry['groups'],
        });

        expect(ForceLoadDialogComponent.prototype.getForceUnitCount(force)).toBe(3);
    });
});
