// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

let isiDevice: boolean | undefined = undefined;

export function isAndroid(): boolean {
    const nav = typeof navigator !== 'undefined' ? navigator : typeof window !== 'undefined' ? (window as any).navigator : undefined;
    const ua = nav?.userAgent || '';
    return /Android/i.test(ua);
}

export function isIOS(): boolean {
    if (typeof isiDevice !== 'undefined') {
        return isiDevice;
    }
    const nav = typeof navigator !== 'undefined' ? navigator : (window as any).navigator;
    if (!nav) {
        isiDevice = false;
    } else {
        const ua = nav.userAgent || nav.vendor || '';
        // covers iPhone/iPad/iPod and iPadOS on Intel (Mac with touch points)
        isiDevice = /iPad|iPhone|iPod/.test(ua)
            || (nav.platform === 'MacIntel' && (nav as any).maxTouchPoints > 1);
    }
    return isiDevice;
}

export function isRunningStandalone(): boolean {
    return (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}