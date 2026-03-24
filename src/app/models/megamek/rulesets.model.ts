export type MegaMekRulesetPrimitive = string | number | boolean | null;

export interface MegaMekRulesetCodeLabel {
    code: string;
    label?: string;
}

export interface MegaMekRulesetEchelon {
    echelon: string;
    augmented?: boolean;
    modifier?: 'R' | 'US';
}

export type MegaMekRulesetProperty =
    | MegaMekRulesetPrimitive
    | MegaMekRulesetCodeLabel
    | MegaMekRulesetEchelon
    | MegaMekRulesetCustomRanks
    | MegaMekRulesetNode
    | MegaMekRulesetProperty[];

export interface MegaMekRulesetNode {
    augmented?: boolean;
    assign?: MegaMekRulesetAssignment;
    attachedForces?: MegaMekRulesetNode[];
    asParent?: string;
    base?: string;
    changeEschelon?: MegaMekRulesetNode | MegaMekRulesetNode[];
    co?: MegaMekRulesetNode[];
    customRanks?: MegaMekRulesetCustomRanks;
    defaults?: MegaMekRulesetNode;
    echelon?: MegaMekRulesetEchelon;
    echelonName?: string;
    echelons?: MegaMekRulesetEchelon[];
    faction?: string;
    factions?: string[];
    flags?: string[];
    formation?: MegaMekRulesetNode | MegaMekRulesetNode[];
    formations?: string[];
    forces?: MegaMekRulesetNode[];
    fromYear?: number;
    generate?: string;
    indexes?: string[];
    label?: string;
    name?: string | MegaMekRulesetNode[];
    num?: number;
    options?: MegaMekRulesetNode[];
    parent?: string;
    rank?: string;
    rankSystem?: MegaMekRulesetNode[];
    rankSystems?: string[];
    rate?: string;
    rating?: MegaMekRulesetNode[] | MegaMekRulesetNode;
    ratings?: Array<string | MegaMekRulesetCodeLabel>;
    role?: string;
    roles?: string[];
    ruleGroup?: MegaMekRulesetNode[];
    subforceOptions?: MegaMekRulesetNode[];
    subforces?: MegaMekRulesetNode[];
    toYear?: number;
    toc?: MegaMekRulesetNode;
    topLevel?: boolean;
    unitType?: MegaMekRulesetNode;
    unitTypes?: string[];
    weight?: number;
    weightClass?: MegaMekRulesetNode;
    weightClasses?: string[];
    when?: MegaMekRulesetCondition;
    xo?: MegaMekRulesetNode[];
    [key: string]: MegaMekRulesetProperty | undefined;
}

export interface MegaMekRulesetCustomRanks {
    base: string;
    rank: MegaMekRulesetCodeLabel[];
}

export interface MegaMekRulesetRecord {
    factionKey: string;
    parentFaction?: string;
    ratingSystem?: string;
    document: MegaMekRulesetNode;
    forceCount: number;
}

export interface MegaMekRulesetCondition extends MegaMekRulesetNode {}

export interface MegaMekRulesetAssignment extends MegaMekRulesetNode {}

export interface MegaMekRulesets {
    rulesets: Record<string, MegaMekRulesetRecord>;
}