// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

let isiDevice: boolean | undefined = undefined;

export function isAndroid(): boolean {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    const ua = nav?.userAgent || '';
    return /Android/i.test(ua);
}

export function isIOS(): boolean {
    if (typeof isiDevice !== 'undefined') {
        return isiDevice;
    }
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    if (!nav) {
        isiDevice = false;
    } else {
        const ua = nav.userAgent || nav.vendor || '';
        // covers iPhone/iPad/iPod and iPadOS on Intel (Mac with touch points)
        isiDevice = /iPad|iPhone|iPod/.test(ua)
            || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    }
    return isiDevice;
}

export function isRunningStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    const nav = window.navigator;
    return ('standalone' in nav && nav.standalone === true)
        || window.matchMedia('(display-mode: standalone)').matches;
}
