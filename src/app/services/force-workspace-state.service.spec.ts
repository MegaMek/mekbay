// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CBTForceMember } from '../models/force-member.model';
import { ForceWorkspaceStateService } from './force-workspace-state.service';

describe('ForceWorkspaceStateService construction selection', () => {
    it('follows replacement member identity after a refit without selecting a different roster member', () => {
        TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
        const members = signal<CBTForceMember[]>([]);
        const force = { getCBTMembers: members };
        const original = Object.assign(Object.create(CBTForceMember.prototype), { id: 'unit:a', force }) as CBTForceMember;
        const updated = Object.assign(Object.create(CBTForceMember.prototype), { id: 'unit:a', force }) as CBTForceMember;
        const other = Object.assign(Object.create(CBTForceMember.prototype), { id: 'unit:b', force }) as CBTForceMember;
        const workspace = TestBed.inject(ForceWorkspaceStateService);
        members.set([original, other]); workspace.selectUnit(original); TestBed.tick();
        members.set([updated, other]); TestBed.tick();
        expect(workspace.selectedUnit()).toBe(updated);
        members.set([other]); TestBed.tick();
        expect(workspace.selectedUnit()).toBe(updated); // Removal selection remains the command owner's choice.
    });
});
