// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';

import type { CBTForce } from '../../models/cbt-force.model';
import type { CBTForceMember, ForceMember } from '../../models/force-member.model';
import { ForceBuilderViewerComponent } from './force-builder-viewer.component';

describe('ForceBuilderViewerComponent', () => {
    it('opens CBT unit details with navigation across the loaded force', () => {
        const forceMembers = signal<ForceMember[]>([]);
        const force = { members: forceMembers } as unknown as CBTForce;
        const first = { kind: 'cbt', id: 'first', force } as CBTForceMember;
        const selected = { kind: 'cbt', id: 'selected', force } as CBTForceMember;
        const last = { kind: 'cbt', id: 'last', force } as CBTForceMember;
        forceMembers.set([first, selected, last]);

        const createDialog = jasmine.createSpy('createDialog');
        const component = Object.create(ForceBuilderViewerComponent.prototype) as ForceBuilderViewerComponent;
        (component as unknown as { dialogsService: { createDialog: typeof createDialog } }).dialogsService = {
            createDialog,
        };
        const event = { stopPropagation: jasmine.createSpy('stopPropagation') } as unknown as MouseEvent;

        component.showUnitInfo(event, selected);

        expect(event.stopPropagation).toHaveBeenCalled();
        expect(createDialog).toHaveBeenCalled();
        const config = createDialog.calls.mostRecent().args[1];
        expect(config.data.unitList).toBe(forceMembers);
        expect(config.data.unitIndex).toBe(1);
        expect(config.data.hideAddButton).toBeTrue();
    });
});
