// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { LoadForceEntry } from '../../models/load-force-entry.model';
import { ForceLoadDialogComponent } from './force-load-dialog.component';

describe('ForceLoadDialogComponent', () => {
    it('counts every unit across saved-force groups', () => {
        const force = new LoadForceEntry({
            groups: [
                { units: [{}, {}] },
                { units: [{}] },
            ] as LoadForceEntry['groups'],
        });

        expect(ForceLoadDialogComponent.prototype.getForceUnitCount(force)).toBe(3);
    });
});
