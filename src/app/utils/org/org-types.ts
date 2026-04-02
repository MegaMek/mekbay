/*
 * Copyright (C) 2025 The MegaMek Team. All Rights Reserved.
 *
 * This file is part of MekBay.
 *
 * MekBay is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License (GPL),
 * version 3 or (at your option) any later version,
 * as published by the Free Software Foundation.
 *
 * MekBay is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty
 * of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * A copy of the GPL should have been included with this project;
 * if not, see <https://www.gnu.org/licenses/>.
 *
 * NOTICE: The MegaMek organization is a non-profit group of volunteers
 * creating free software for the BattleTech community.
 *
 * MechWarrior, BattleMech, `Mech and AeroTech are registered trademarks
 * of The Topps Company, Inc. All Rights Reserved.
 *
 * Catalyst Game Labs and the Catalyst Game Labs logo are trademarks of
 * InMediaRes Productions, LLC.
 *
 * MechWarrior Copyright Microsoft Corporation. MegaMek was created under
 * Microsoft's "Game Content Usage Rules"
 * <https://www.xbox.com/en-US/developers/rules> and it is not endorsed by or
 * affiliated with Microsoft.
 */

import type { ASUnitTypeCode, Unit } from '../../models/units.model';

/*
 * Author: Drake
 *
 * Pure type / interface definitions for the force-org system.
 * No runtime code — only types and interfaces live here.
 */

export const EMPTY_RESULT: GroupSizeResult = {
	name: 'Force',
	type: null,
	modifierKey: '',
	countsAsType: null,
	tier: 0,
};

export type OrgType =
    // Generic
    | 'Force'
    | 'Mercenary'
    | 'Element'

    // IS-specific types
    | 'Squad'
    | 'Platoon'
    | 'Flight'
    | 'Squadron'
    | 'Wing'
    | 'Single'
    | 'Lance'
    | 'Air Lance'
    | 'Company'
    | 'Battalion'
    | 'Regiment'
    | 'Brigade'

    // Clan-specific types
    | 'Point'
    | 'Star'
    | 'Nova'
    | 'Binary'
    | 'Supernova Binary'
    | 'Trinary'
    | 'Supernova Trinary'
    | 'Cluster'
    | 'Galaxy'

    // ComStar/WoB-specific types
    | 'Level I'
    | 'Level II'
    | 'Choir'
//  | 'Demi-Level III'
    | 'Level III'
    | 'Level IV'
    | 'Level V'
    | 'Level VI'

    // Society-specific types
    | 'Un'
    | 'Trey'
    | 'Sept'

    // MH-specific types
    | 'Contubernium'
    | 'Century'
    | 'Maniple'
    | 'Cohort'
    | 'Legion'

    // CC-specific types
    | 'Augmented Lance'
    | 'Augmented Company'
    | 'Augmented Battalion'
    | 'Augmented Regiment';

export interface PointRange {
    min: number;
    max: number;
}

export interface GroupSizeResult {
    name: string;
    type: OrgType | null;
    modifierKey: string;
    countsAsType: OrgType | null;
    tier: number;
    count?: number;
    isFragment?: boolean;
    provenance?: OrgGroupProvenance;
    foreignDisplayName?: string;
    children?: GroupSizeResult[];
    units?: Unit[];
    unitAllocations?: GroupUnitAllocation[];
    leftoverUnits?: Unit[];
    leftoverUnitAllocations?: GroupUnitAllocation[];
    tag?: OrgGroupTag;
    priority?: number;
}

export interface GroupUnitAllocation {
    readonly unit: Unit;
    readonly troopers: number;
}

export type OrgGroupProvenance = 'input-group' | 'produced-group';

export interface OrgSizeResult {
    readonly name: string;
    readonly tier: number;
    readonly groups: readonly GroupSizeResult[];
}

export interface OrgTypeModifier {
    count: number;
    tier?: number;
}

export interface OrgTypeRuleBase {
    readonly type: OrgType;
    readonly modifiers: Record<string, number | OrgTypeModifier>;
    readonly commandRank?: string;
    readonly strict?: boolean;
    readonly tier: number;
    readonly dynamicTier?: number;
    readonly filter?: (unit: Unit) => boolean;
    readonly countsAs?: OrgType;
    readonly priority?: number;
    readonly tag?: OrgGroupTag;
}

// -----------------------------------------------------------------------------
// Next-generation declarative org model
// -----------------------------------------------------------------------------

export type OrgFactScalar = string | number | boolean;
export type BuiltInOrgSelectorName =
    | 'all'
    | 'aero'
    | 'flightEligible'
    | 'infantry'
    | 'nonInfantry'
    | 'nonConventionalInfantry'
    | 'nonAero'
    | 'omni'
    | 'transportMec'
    | 'transportXmec'
    | ASUnitTypeCode;
export type OrgSelectorName = BuiltInOrgSelectorName;
export type BuiltInOrgBucketName =
    | 'classKey'
    | 'ciMoveClass'
    | 'ciMoveClassTroopers'
    | 'flightType'
    | 'infantryTroopers'
    | 'moveType'
    | 'transport'
    | 'promotionBasic'
    | 'promotionWithUnitKinds';
export type OrgBucketName = BuiltInOrgBucketName;
export type BuiltInOrgUnitBucketName =
    | 'classKey'
    | 'ciMoveClass'
    | 'ciMoveClassTroopers'
    | 'flightType'
    | 'infantryTroopers'
    | 'moveType'
    | 'transport';
export type OrgUnitBucketName = BuiltInOrgUnitBucketName;
export type BuiltInOrgGroupBucketName =
    | 'ciMoveClass'
    | 'promotionBasic'
    | 'promotionWithUnitKinds';
export type OrgGroupBucketName = BuiltInOrgGroupBucketName;
export type BuiltInUnitClassKey =
    | 'AF'
    | 'AF:omni'
    | 'BA'
    | 'BM'
    | 'BM:omni'
    | 'CI'
    | 'CI:mechanized'
    | 'CV'
    | 'CV:omni'
    | 'PM';
export type DerivedUnitClassKey = Lowercase<Unit['type']>;
export type UnitClassKey = BuiltInUnitClassKey | DerivedUnitClassKey;
export type CIMoveClass =
    | 'foot'
    | 'jump'
    | 'motorized'
    | 'scuba'
    | 'mechanized-vtol'
    | 'mechanized-hover'
    | 'mechanized-submarine'
    | 'mechanized-tracked'
    | 'mechanized-wheeled';
export type CIMoveClassBucketValue = `CI:${CIMoveClass}` | 'mixed-ci' | 'not-ci';
export type CIMoveClassTrooperBucketValue = `CI:${CIMoveClass}:${number}` | 'not-ci';
export type CIMoveClassTag = `ci:${CIMoveClass}`;
export type BuiltInInfantryTrooperBucketValue = `BA:${number}` | `CI:${number}` | 'not-infantry';
export type InfantryTrooperBucketValue = BuiltInInfantryTrooperBucketValue;
export type BuiltInFlightTypeBucketValue = `flight:${string}` | 'not-flight';
export type FlightTypeBucketValue = BuiltInFlightTypeBucketValue;
export type BuiltInMoveTypeBucketValue = `move:${string}` | 'not-move';
export type MoveTypeBucketValue = BuiltInMoveTypeBucketValue;
export type BuiltInTransportBucketValue =
    | UnitClassKey
    | 'BA:mec'
    | 'BA:xmec'
    | 'BA:mec+xmec';
export type TransportBucketValue = BuiltInTransportBucketValue;
export type OrgTypeBucketToken = OrgType | 'null';
export type PromotionBasicBucketValue =
    `${OrgTypeBucketToken}|${OrgTypeBucketToken}|${string}`;
export type PromotionWithUnitKindsBucketValue =
    `${OrgTypeBucketToken}|${OrgTypeBucketToken}|${string}|BM:${number}|CV:${number}|AF:${number}|CF:${number}|BA:${number}|CI:${number}|PM:${number}`;
export type BuiltInUnitBucketValue =
    | UnitClassKey
    | CIMoveClassTrooperBucketValue
    | FlightTypeBucketValue
    | InfantryTrooperBucketValue
    | MoveTypeBucketValue
    | TransportBucketValue;
export type BuiltInGroupBucketValue =
    | CIMoveClassBucketValue
    | PromotionBasicBucketValue
    | PromotionWithUnitKindsBucketValue;
export type BuiltInUnitFactTag =
    | UnitClassKey
    | CIMoveClassTag
    | 'aero'
    | 'omni'
    | 'transport.mec'
    | 'transport.xmec';
export type UnitFactTag = BuiltInUnitFactTag;
export type OrgGroupTag = string;
export type BuiltInChildTypeCountKey =
    | OrgTypeBucketToken
    | `countsAs:${OrgType}`
    | `tag:${OrgGroupTag}`;
export type OrgChildTypeCountKey = BuiltInChildTypeCountKey;
export type BuiltInUnitNumericScalarName =
    | 'id'
    | 'tons'
    | 'pv'
    | 'bv'
    | 'troopers';
export type UnitNumericScalarName = BuiltInUnitNumericScalarName;
export type OrgBucketValue = BuiltInUnitBucketValue | BuiltInGroupBucketValue;
export type OrgPatternAliasName = string;
export type OrgPatternReferenceName = OrgBucketName | OrgPatternAliasName;
export type BuiltInOrgFactPath = `bucket:${OrgBucketName}` | `sum:${OrgPatternReferenceName}`;
export type OrgFactPath = BuiltInOrgFactPath;

export interface UnitFactScalars {
    readonly id: number;
    readonly tons: number;
    readonly pv: number;
    readonly bv: number;
    readonly troopers: number;
    readonly omni: boolean;
    readonly isAero: boolean;
    readonly isBM: boolean;
    readonly isCV: boolean;
    readonly isBA: boolean;
    readonly isCI: boolean;
    readonly isPM: boolean;
    readonly hasMEC: boolean;
    readonly hasXMEC: boolean;
    readonly [key: string]: OrgFactScalar;
}

/**
 * Normalized facts derived once from a Unit.
 *
 * This is the unit-level input to the next-generation solver. Rules should
 * primarily consume named selectors, buckets, and fact paths rather than raw
 * Unit callbacks.
 */
export interface UnitFacts {
    readonly unit: Unit;
    readonly factId: number;
    readonly classKey: UnitClassKey;
    readonly tags: ReadonlySet<UnitFactTag>;
    readonly scalars: UnitFactScalars;
}

/**
 * Aggregated facts derived once from a resolved group.
 *
 * This replaces repeated descendant-unit scans in the hot path for composed
 * rules. Group facts should be computed when groups are created and reused.
 */
export interface GroupFacts {
    readonly groupFactId: number;
    readonly group: GroupSizeResult;
    readonly type: OrgType | null;
    readonly countsAsType: OrgType | null;
    readonly modifierKey: string;
    readonly tier: number;
    readonly isFragment: boolean;
    readonly provenance: OrgGroupProvenance;
    readonly tag?: OrgGroupTag;
    readonly priority?: number;
    readonly directChildCount: number;
    readonly childTypeCounts: ReadonlyMap<OrgChildTypeCountKey, number>;
    readonly unitTypeCounts: ReadonlyMap<ASUnitTypeCode, number>;
    readonly unitClassCounts: ReadonlyMap<UnitClassKey, number>;
    readonly unitTagCounts: ReadonlyMap<UnitFactTag, number>;
    readonly unitScalarSums: ReadonlyMap<UnitNumericScalarName, number>;
    readonly descendantUnitBucketCounts: ReadonlyMap<OrgUnitBucketName, ReadonlyMap<OrgBucketValue, number>>;
}

export interface OrgConstraintSpec {
    readonly left: OrgFactPath;
    readonly op: '<=' | '>=' | '=';
    readonly right: OrgFactPath | number | boolean | string;
}

export interface OrgRuleMetadata extends Omit<OrgTypeRuleBase, 'filter' | 'strict'> {
    readonly description?: string;
    readonly formationMatching?: OrgFormationMatchingSpec;
}

export interface OrgFormationMatchingSpec {
    readonly ignoredChildRoles: readonly OrgChildRoleSpec[];
    readonly notice?: string;
}

export interface OrgChildRoleSpec {
    readonly matches: readonly OrgType[];
    readonly min?: number;
    readonly max?: number;
    readonly onlyUnitTypes?: readonly ASUnitTypeCode[];
    readonly requiredUnitTagsAny?: readonly UnitFactTag[];
    readonly requiredUnitTagsAll?: readonly UnitFactTag[];
    readonly requiredTagsAny?: readonly OrgGroupTag[];
    readonly requiredTagsAll?: readonly OrgGroupTag[];
}

export interface OrgComposedCountAlternativeSpec {
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly modifiers: Record<string, number | OrgTypeModifier>;
    readonly childBucketBy?: OrgGroupBucketName;
    readonly childMatchBucketBy?: OrgGroupBucketName;
}

export interface OrgCIFormationEntry {
    readonly moveClass: CIMoveClass;
    readonly troopers: number;
    readonly counts: Readonly<Record<string, number>>;
}

export interface OrgPatternTargetScoreTerm {
	readonly kind: 'target';
	readonly ref: OrgPatternReferenceName;
	readonly target: number | PointRange;
	readonly weight?: number;
}

export interface OrgPatternPositiveDiffScoreTerm {
	readonly kind: 'positive-diff';
    readonly left: OrgPatternReferenceName;
    readonly right: OrgPatternReferenceName;
	readonly weight?: number;
}

export interface OrgPatternNumericTargetScoreTerm {
    readonly kind: 'numeric-target';
    readonly ref: OrgPatternReferenceName;
    readonly target: number | PointRange;
    readonly divisor?: number;
    readonly weight?: number;
}

export type OrgPatternScoreTerm =
	| OrgPatternTargetScoreTerm
    | OrgPatternPositiveDiffScoreTerm
    | OrgPatternNumericTargetScoreTerm;

export interface OrgPatternBucketPrefixMatcher {
    readonly prefix: string;
}

export type OrgPatternBucketMatcher = readonly OrgBucketValue[] | OrgPatternBucketPrefixMatcher;

export interface OrgPatternSpecBase {
    readonly copySize: number;
    readonly bucketGroups?: Readonly<Record<OrgPatternAliasName, OrgPatternBucketMatcher>>;
    readonly demands?: Readonly<Partial<Record<OrgPatternReferenceName, number>>>;
    readonly minSums?: Readonly<Partial<Record<OrgPatternReferenceName, number>>>;
    readonly maxSums?: Readonly<Partial<Record<OrgPatternReferenceName, number>>>;
    readonly constraints?: readonly OrgConstraintSpec[];
}

export interface OrgExactPatternSpec extends OrgPatternSpecBase {
    readonly matchMode?: 'exact';
    readonly scoreTerms?: never;
}

export interface OrgScoredPatternSpec extends OrgPatternSpecBase {
    readonly matchMode: 'score';
    readonly scoreTerms: readonly OrgPatternScoreTerm[];
}

export type OrgPatternSpec = OrgExactPatternSpec | OrgScoredPatternSpec;

/**
 * Simple count-based leaf rule.
 *
 * Intended for formations like Point, Single, Flight, Level I, and other rules
 * that can be derived directly from a selector and modifier counts.
 */
export interface OrgLeafCountRule extends OrgRuleMetadata {
    readonly kind: 'leaf-count';
    readonly unitSelector: OrgSelectorName | readonly OrgSelectorName[];
    readonly pointModel: 'fixed' | 'range';
    readonly bucketBy?: OrgUnitBucketName;
    readonly fragmentType?: OrgType;
    readonly fragmentTier?: number;
}

/**
 * Declarative pattern-based leaf rule.
 *
 * Intended for Nova, Choir, Augmented Lance, Squad, Platoon, and other rules
 * that consume fact buckets rather than arbitrary Unit[] subset functions.
 */
export interface OrgLeafPatternRule extends OrgRuleMetadata {
    readonly kind: 'leaf-pattern';
    readonly unitSelector: OrgSelectorName | readonly OrgSelectorName[];
    readonly bucketBy: OrgUnitBucketName;
    readonly patterns: readonly OrgPatternSpec[];
}

/**
 * Count-based composed rule.
 *
 * Intended for the common case where child groups fill roles and counts such as
 * Company, Battalion, Regiment, Wing, Cluster, and similar formations.
 */
export interface OrgComposedCountRule extends OrgRuleMetadata {
    readonly kind: 'composed-count';
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly childBucketBy?: OrgGroupBucketName;
    readonly childMatchBucketBy?: OrgGroupBucketName;
    readonly requireRegularForPromotion?: boolean;
    readonly alternativeCompositions?: readonly OrgComposedCountAlternativeSpec[];
}

export interface OrgCIFormationRule extends OrgRuleMetadata {
    readonly kind: 'ci-formation';
    readonly unitSelector: OrgSelectorName | readonly OrgSelectorName[];
    readonly fragmentType: OrgType;
    readonly fragmentTier: number;
    readonly entries: readonly OrgCIFormationEntry[];
    readonly requireRegularForPromotion?: boolean;
}

/**
 * Declarative pattern-based composed rule.
 *
 * Intended for advanced group composition that depends on aggregated child or
 * descendant facts, but still avoids arbitrary subset-search callbacks.
 */
export interface OrgComposedPatternRule extends OrgRuleMetadata {
    readonly kind: 'composed-pattern';
    readonly childRoles: readonly OrgChildRoleSpec[];
    readonly bucketBy: OrgUnitBucketName;
    readonly patterns: readonly OrgPatternSpec[];
    readonly childBucketBy?: OrgGroupBucketName;
    readonly childMatchBucketBy?: OrgGroupBucketName;
    readonly constraints?: readonly OrgConstraintSpec[];
}

export type OrgRuleDefinition =
    | OrgLeafCountRule
    | OrgLeafPatternRule
    | OrgCIFormationRule
    | OrgComposedCountRule
    | OrgComposedPatternRule;

/**
 * Named selector/bucket registry for scripter-authored org definitions.
 *
 * The goal is that most new faction rules refer to selector and bucket names,
 * not ad hoc callbacks inside definitions files.
 */
export interface OrgRuleRegistry {
    readonly unitSelectors: Readonly<Partial<Record<OrgSelectorName, (facts: UnitFacts) => boolean>>>;
    readonly unitBuckets: Readonly<Partial<Record<OrgUnitBucketName, (facts: UnitFacts) => OrgBucketValue>>>;
    readonly groupBuckets: Readonly<Partial<Record<OrgGroupBucketName, (facts: GroupFacts) => OrgBucketValue>>>;
}

/**
 * Future org definition shape for the count-based solver.
 *
 * This lives alongside the legacy OrgDefinition during migration. The existing
 * public API can continue to accept legacy rules until the new solver fully
 * replaces the old path.
 */
export interface OrgDefinitionSpec {
    readonly rules: readonly OrgRuleDefinition[];
    readonly registry: OrgRuleRegistry;
    readonly distanceFactor: number;
    readonly minDistance: number;
    readonly groupDistanceFactor: number;
    readonly groupMinDistance: number;
}
