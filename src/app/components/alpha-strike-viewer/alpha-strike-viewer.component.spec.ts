// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import { signal } from '@angular/core';
import { AlphaStrikeViewerComponent } from './alpha-strike-viewer.component';

describe('AlphaStrikeViewerComponent wheel navigation', () => {
    it('leaves default scrolling native and applies the preference to card zoom and Ctrl scrolling', () => {
        const viewer = Object.create(AlphaStrikeViewerComponent.prototype) as AlphaStrikeViewerComponent;
        const options = signal({ mouseWheelAction: 'scroll' });
        const container = document.createElement('div');
        const scroll: jasmine.Spy = spyOn(container, 'scrollBy');
        Object.assign(viewer, {
            optionsService: { options },
            viewerContainer: () => ({ nativeElement: container }),
            columnCount: signal(3),
            getMaxColumns: () => 5,
            wheelState: null,
        });
        const wheel = (init: WheelEventInit) => {
            const event = new WheelEvent('wheel', { cancelable: true, ...init });
            viewer.onWheel(event);
            return event;
        };
        expect(wheel({ deltaY: 120 }).defaultPrevented).toBeFalse();
        expect(viewer.columnCount()).toBe(3);
        wheel({ ctrlKey: true, deltaY: -1, deltaMode: WheelEvent.DOM_DELTA_LINE });
        expect(viewer.columnCount()).toBe(2);
        options.set({ mouseWheelAction: 'zoom' });
        wheel({ deltaY: 1, deltaMode: WheelEvent.DOM_DELTA_LINE });
        expect(viewer.columnCount()).toBe(3);
        expect(wheel({ ctrlKey: true, deltaY: 120 }).defaultPrevented).toBeTrue();
        expect(viewer.columnCount()).toBe(3);
        expect(scroll).toHaveBeenCalledWith({ left: 0, top: 120, behavior: 'instant' });
        wheel({ shiftKey: true, deltaY: 80 });
        expect(scroll).toHaveBeenCalledWith({ left: 80, top: 0, behavior: 'instant' });
        expect(wheel({ deltaX: 120 }).defaultPrevented).toBeFalse();
        expect(viewer.columnCount()).toBe(3);
    });
});
