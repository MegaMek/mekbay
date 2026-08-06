// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

/**
 * Builds a shareable root URL (`{origin}/?{query}`) from query parameters.
 * Parameters with null/undefined values are omitted. Uses the same
 * URLSearchParams serialization as the app URL, so shared links match
 * the URLs the app itself produces.
 */
export function buildShareUrl(
    origin: string,
    params: Record<string, string | number | null | undefined>,
): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined) continue;
        searchParams.set(key, String(value));
    }
    const query = searchParams.toString();
    return query ? `${origin}/?${query}` : `${origin}/`;
}
