// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

const REMOTE_URL_PATTERN = /^https?:\/\//i;

export function withServiceWorkerBypass(url: string): string {
    if (!REMOTE_URL_PATTERN.test(url)) {
        return url;
    }

    return `${url}${url.includes('?') ? '&' : '?'}ngsw-bypass=true`;
}
