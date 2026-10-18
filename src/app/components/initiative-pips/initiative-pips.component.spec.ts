// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { TestBed } from '@angular/core/testing';

import type { InitiativePip } from '../../services/initiative.service';
import { InitiativePipsComponent } from './initiative-pips.component';

describe('InitiativePipsComponent', () => {
    it('nests compact rows of seven however narrow its container', () => {
        const fixture = TestBed.createComponent(InitiativePipsComponent);
        const pips: InitiativePip[] = Array.from({ length: 9 }, () => ({ side: 'a', friendly: true, done: false, next: false }));
        fixture.componentRef.setInput('pips', pips);
        (fixture.nativeElement as HTMLElement).style.width = '40px';
        fixture.detectChanges();

        const boxes = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.dot')].map(dot => dot.getBoundingClientRect());
        expect(boxes[6]!.top).toBe(boxes[0]!.top);
        expect(boxes[7]!.top).toBeGreaterThan(boxes[0]!.top);
        expect(boxes[7]!.left - boxes[0]!.left).toBe(4);
    });
});
