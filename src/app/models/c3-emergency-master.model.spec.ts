// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import {
    C3EmergencyMasterActivationTracker,
    type C3EmergencyMasterStatusEntry,
} from './c3-emergency-master.model';

describe('C3EmergencyMasterActivationTracker', () => {
    it('establishes its initial status baseline without reporting activation', () => {
        const tracker = new C3EmergencyMasterActivationTracker();

        expect(tracker.update([{ key: 'unit:c3em', status: 'active' }])).toEqual([]);
    });

    it('reports only non-active to active transitions', () => {
        const tracker = new C3EmergencyMasterActivationTracker();
        const update = (status: C3EmergencyMasterStatusEntry['status']) => (
            tracker.update([{ key: 'unit:c3em', status }])
        );

        update('dormant');
        expect(update('active')).toEqual(['unit:c3em']);
        expect(update('active')).toEqual([]);
        expect(update('standby')).toEqual([]);
        expect(update('active')).toEqual(['unit:c3em']);
        expect(update('fried')).toEqual([]);
    });

    it('does not treat a newly discovered active entry as a transition', () => {
        const tracker = new C3EmergencyMasterActivationTracker();
        tracker.update([]);

        expect(tracker.update([{ key: 'unit:c3em', status: 'active' }])).toEqual([]);
    });
});