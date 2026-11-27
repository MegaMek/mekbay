// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import type { MouseWheelAction } from '../models/options.model';

/** Shared wheel intent for sheet, card, and diagram viewers; distances are CSS pixels. */
export function viewerWheel(
    event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
    action: MouseWheelAction,
    viewport: { width: number; height: number },
): { x: number; y: number; zoom: number } {
    const { deltaMode, deltaX, deltaY } = event;
    const lineSize = deltaMode === 1 ? 16 : 1;
    const x = deltaX * (deltaMode === 2 ? viewport.width : lineSize);
    const y = deltaY * (deltaMode === 2 ? viewport.height : lineSize);
    // Browsers may already map Shift+wheel to deltaX. Do not swap it back to vertical.
    if (event.shiftKey) {
        return { x: deltaX !== 0 ? x : deltaY * (deltaMode === 2 ? viewport.width : lineSize), y: 0, zoom: 1 };
    }
    const modified = event.ctrlKey || event.metaKey;
    const zoom = action === 'zoom' ? !modified : modified;
    // Keep a native horizontal gesture horizontal, including in wheel-to-zoom mode.
    if (zoom && y !== 0 && Math.abs(deltaY) >= Math.abs(deltaX)) {
        return { x: 0, y: 0, zoom: Math.exp(-Math.max(-600, Math.min(600, y)) * 0.002) };
    }
    return { x, y, zoom: 1 };
}
