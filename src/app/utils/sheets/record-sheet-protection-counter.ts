// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

/** Shared armor/structure count, including its internal parenthesis spacing. */
export function formatProtectionCounter(current: number, maximum = current): string {
    return `( ${current === maximum ? current : `${current}/${maximum}`} )`;
}

/** Prefixes (damage thresholds or inline labels) are independent of the remaining pips. */
export function renderProtectionCounter(root: SVGSVGElement, id: string, current: number, maximum: number): void {
    for (const counter of root.querySelectorAll<SVGElement>(`#${CSS.escape(id)}`)) {
        if (counter.textContent === '—') continue;
        const prefix = counter.getAttribute('data-mekbay-counter-prefix');
        const text = formatProtectionCounter(current, maximum);
        counter.textContent = prefix ? `${prefix} ${text}` : text;
    }
}
