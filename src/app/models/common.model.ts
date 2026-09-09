// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export const REMOTE_HOST = 'https://db.mekbay.com';

export enum GameSystem {
    CBT = 'cbt',
    AS = 'as'
}

export enum Rulebook {
    ASCE = "Alpha Strike: Commander's Edition",
    ASC = "Alpha Strike: Companion",
    ASC_ERR16 = "Alpha Strike Companion Errata v1.6 (2022)",
    BOT = "Battle of Tukayyid",
    CO = "BattleTech: Campaign Operations",
    FMD = "Force Manual: Davion",
    FMK = "Force Manual: Kurita",
    FMMERC = "Force Manual: Mercenaries",
    EA = "Empire Alone",
    TR = "Tamar Rising",
    DD = "Dominions Divided",
    IEO = "IlKhan's Eyes Only"
}

/**
 * A reference to a specific rulebook and page number or numbers.
 */
export interface RulesReference {
    book: Rulebook;
    page: number | number[];
}

export function formatRulesPages(page: RulesReference['page']): string {
    return Array.isArray(page) ? page.join(', ') : String(page);
}

export function formatRulesReference(reference: RulesReference): string {
    const pageLabel = Array.isArray(reference.page) ? 'pp.' : 'p.';
    return `${reference.book}, ${pageLabel}${formatRulesPages(reference.page)}`;
}

export enum ECMMode {
    ECM = 'ecm',
    ECCM = 'eccm',
    GHOST = 'ghost',
    ECM_ECCM = 'ecm-eccm',
    ECM_GHOST = 'ecm-ghost',
    ECCM_GHOST = 'eccm-ghost',
    OFF = 'off'
}
