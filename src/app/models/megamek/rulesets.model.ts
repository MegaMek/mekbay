// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export type MegaMekRulesetEchelonModifier = 'R' | 'US';

export interface MegaMekRulesetEchelonToken {
    code: string;
    modifier?: MegaMekRulesetEchelonModifier;
    augmented?: boolean;
}

export interface MegaMekRulesetCodeLabel {
    code: string;
    label?: string;
}

export interface MegaMekRulesetWhen {
    fromYear?: number;
    toYear?: number;
    unitTypes?: string[];
    weightClasses?: string[];
    ratings?: string[];
    echelons?: MegaMekRulesetEchelonToken[];
    formations?: string[];
    roles?: string[];
    motives?: string[];
    augmented?: boolean;
    topLevel?: boolean;
    names?: string[];
    factions?: string[];
    flags?: string[];
    indexes?: string[];
}

export interface MegaMekRulesetAssign {
    unitTypes?: string[];
    weightClasses?: string[];
    ratings?: string[];
    echelons?: MegaMekRulesetEchelonToken[];
    echelon?: MegaMekRulesetEchelonToken;
    rankSystems?: string[];
    formations?: string[];
    roles?: string[];
    motives?: string[];
    flags?: string[];
    variants?: string[];
    chassis?: string[];
    name?: string;
    factionKey?: string;
    augmented?: boolean;
}

export interface MegaMekRulesetNodeBase {
    when?: MegaMekRulesetWhen;
    assign?: MegaMekRulesetAssign;
    weight?: number;
    count?: number;
    position?: number;
    title?: string;
    generate?: string;
    factionKey?: string;
}

export interface MegaMekRulesetNameNode {
    name: string;
    when?: MegaMekRulesetWhen;
}

export interface MegaMekRulesetRankNode {
    rank: string;
    when?: MegaMekRulesetWhen;
    position?: number;
}

export interface MegaMekRulesetOptionNode extends MegaMekRulesetNodeBase {
    echelon?: MegaMekRulesetEchelonToken;
    echelons?: MegaMekRulesetEchelonToken[];
    unitTypes?: string[];
    weightClasses?: string[];
    ratings?: Array<MegaMekRulesetCodeLabel | string>;
    rankSystems?: string[];
    formations?: string[];
    roles?: string[];
    motives?: string[];
    flags?: string[];
    variants?: string[];
    chassis?: string[];
    name?: string;
    asFactionKey?: string;
    useParentFaction?: boolean;
}

export interface MegaMekRulesetOptionGroup<TOption extends MegaMekRulesetOptionNode = MegaMekRulesetOptionNode>
    extends MegaMekRulesetNodeBase {
    options: TOption[];
}

export interface MegaMekRulesetSubforceNode extends MegaMekRulesetNodeBase {
    echelon?: MegaMekRulesetEchelonToken;
    unitTypes?: string[];
    weightClasses?: string[];
    roles?: string[];
    motives?: string[];
    flags?: string[];
    name?: string;
    augmented?: boolean;
    asFactionKey?: string;
    useParentFaction?: boolean;
}

export interface MegaMekRulesetSubforceOptionGroup extends MegaMekRulesetNodeBase {
    options: MegaMekRulesetSubforceNode[];
    generate?: string;
}

export interface MegaMekRulesetSubforceGroup extends MegaMekRulesetNodeBase {
    subforces?: MegaMekRulesetSubforceNode[];
    subforceOptions?: MegaMekRulesetSubforceOptionGroup[];
    asFactionKey?: string;
    useParentFaction?: boolean;
    generate?: string;
}

export interface MegaMekRulesetRuleGroup extends MegaMekRulesetNodeBase {
    unitType?: MegaMekRulesetOptionGroup;
    weightClass?: MegaMekRulesetOptionGroup;
    role?: MegaMekRulesetOptionGroup;
    motive?: MegaMekRulesetOptionGroup;
    flags?: MegaMekRulesetOptionGroup;
}

export interface MegaMekRulesetForceNode extends MegaMekRulesetNodeBase {
    echelon?: MegaMekRulesetEchelonToken;
    echelonName?: string;
    name?: MegaMekRulesetNameNode[];
    co?: MegaMekRulesetRankNode[];
    xo?: MegaMekRulesetRankNode[];
    unitType?: MegaMekRulesetOptionGroup;
    weightClass?: MegaMekRulesetOptionGroup;
    role?: MegaMekRulesetOptionGroup;
    motive?: MegaMekRulesetOptionGroup;
    flags?: MegaMekRulesetOptionGroup;
    changeEschelon?: MegaMekRulesetOptionGroup;
    ruleGroup?: MegaMekRulesetRuleGroup[];
    subforces?: MegaMekRulesetSubforceGroup[];
    attachedForces?: MegaMekRulesetSubforceGroup[];
}

export interface MegaMekRulesetIndexes {
    forceIndexesByEchelon: Record<string, number[]>;
}

export interface MegaMekRulesetDefaults {
    unitType?: MegaMekRulesetOptionNode[];
    echelon?: MegaMekRulesetOptionNode[];
    rankSystem?: MegaMekRulesetOptionNode[];
    rating?: MegaMekRulesetOptionNode[];
}

export interface MegaMekRulesetToc {
    unitType?: MegaMekRulesetOptionGroup;
    echelon?: MegaMekRulesetOptionGroup;
    rating?: MegaMekRulesetOptionGroup;
    flags?: MegaMekRulesetOptionGroup;
    weightClass?: MegaMekRulesetOptionGroup;
    formation?: MegaMekRulesetOptionGroup;
    role?: MegaMekRulesetOptionGroup;
    motive?: MegaMekRulesetOptionGroup;
}

export interface MegaMekRulesetRecord {
    factionKey: string;
    parentFactionKey?: string;
    ratingSystem?: string;
    assign?: MegaMekRulesetAssign;
    customRanks?: Record<string, unknown>;
    defaults?: MegaMekRulesetDefaults;
    toc?: MegaMekRulesetToc;
    forces: MegaMekRulesetForceNode[];
    indexes: MegaMekRulesetIndexes;
    forceCount: number;
}

export interface MegaMekRulesetsData {
    etag: string;
    version: number;
    rulesets: MegaMekRulesetRecord[];
}