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
 */

import type { ASUnitTypeCode, Unit } from '../../models/units.model';
import type {
    CIMoveClass,
    CIMoveClassBucketValue,
    CIMoveClassTag,
    CIMoveClassTrooperBucketValue,
    FlightTypeBucketValue,
    DerivedUnitClassKey,
    GroupFacts,
    GroupSizeResult,
    GroupUnitAllocation,
    OrgGroupProvenance,
    InfantryTrooperBucketValue,
    OrgChildTypeCountKey,
    OrgBucketValue,
    OrgRuleRegistry,
    OrgUnitBucketName,
    PromotionBasicBucketValue,
    PromotionWithUnitKindsBucketValue,
    TransportBucketValue,
    UnitClassKey,
    UnitFactTag,
    UnitNumericScalarName,
    UnitFacts,
} from './org-types';

const ORG_UNIT_BUCKET_NAMES: readonly OrgUnitBucketName[] = [
    'classKey',
    'ciMoveClass',
    'ciMoveClassTroopers',
    'flightType',
    'infantryTroopers',
    'transport',
];

const ORG_UNIT_TYPE_CODES: readonly ASUnitTypeCode[] = [
    'AF',
    'BA',
    'BD',
    'BM',
    'CF',
    'CI',
    'CV',
    'DA',
    'DS',
    'IM',
    'JS',
    'MS',
    'PM',
    'SC',
    'SS',
    'SV',
    'WS',
];

function createUnitTypeSelectors(): Partial<Record<ASUnitTypeCode, (facts: UnitFacts) => boolean>> {
    return Object.fromEntries(
        ORG_UNIT_TYPE_CODES.map((unitType) => [
            unitType,
            (facts: UnitFacts) => getNormalizedOrgUnitType(facts.unit) === unitType,
        ]),
    ) as Partial<Record<ASUnitTypeCode, (facts: UnitFacts) => boolean>>;
}

function isAero(unit: Unit): boolean {
    return unit.type === 'Aero';
}

function isBM(unit: Unit): boolean {
    return unit.type === 'Mek';
}

function isCV(unit: Unit): boolean {
    return unit.type === 'Tank' || unit.type === 'VTOL' || unit.type === 'Naval';
}

function isBA(unit: Unit): boolean {
    return unit.type === 'Infantry' && unit.subtype === 'Battle Armor';
}

function isCI(unit: Unit): boolean {
    return unit.type === 'Infantry' && unit.subtype !== 'Battle Armor';
}

function isPM(unit: Unit): boolean {
    return unit.type === 'ProtoMek';
}

export function getNormalizedOrgUnitType(unit: Unit): Unit['as']['TP'] {
    return unit.as.TP;
}

export function getCIMoveClass(unit: Unit): CIMoveClass | null {
    if (!isCI(unit)) {
        return null;
    }
    
    if (unit.moveType === 'Motorized SCUBA') return 'scuba';
    
    if (unit.subtype === 'Conventional Infantry') {
        if (unit.moveType === 'Jump') return 'jump';
        return 'foot';
    }

    if (unit.subtype === 'Motorized Conventional Infantry') {
        return 'motorized';
    }

    if (unit.subtype === 'Mechanized Conventional Infantry') {
        switch (unit.moveType) {
            case 'VTOL':
            case 'Microcopter':
                return 'mechanized-vtol';
            case 'Hover':
                return 'mechanized-hover';
            case 'Submarine':
                return 'mechanized-submarine';
            case 'Wheeled':
                return 'mechanized-wheeled';
            case 'Tracked':
            default:
                return 'mechanized-tracked';
        }
    }

    // Fallbacks just in case
    if (unit.moveType === 'Jump') return 'jump';
    return 'foot';
}

function getCIMoveClassTag(unit: Unit): CIMoveClassTag | null {
    const moveClass = getCIMoveClass(unit);
    return moveClass ? `ci:${moveClass}` as CIMoveClassTag : null;
}

function hasSpecial(unit: Unit, special: string): boolean {
    return unit.as?.specials?.includes(special) ?? false;
}

function incrementCount<Key extends string>(map: Map<Key, number>, key: Key, amount = 1): void {
    map.set(key, (map.get(key) ?? 0) + amount);
}

let nextUnitFactId = 0;
let nextGroupFactId = 0;

function allocateUnitFactId(): number {
    const factId = nextUnitFactId;
    nextUnitFactId += 1;
    return factId;
}

function allocateGroupFactId(): number {
    const groupFactId = nextGroupFactId;
    nextGroupFactId += 1;
    return groupFactId;
}

export function getUnitClassKey(unit: Unit): UnitClassKey {
    if (isBA(unit)) return 'BA';
    if (isCI(unit)) return unit.subtype === 'Mechanized Conventional Infantry' ? 'CI:mechanized' : 'CI';
    if (isBM(unit)) return unit.omni === 1 ? 'BM:omni' : 'BM';
    if (isCV(unit)) return unit.omni === 1 ? 'CV:omni' : 'CV';
    if (isAero(unit)) return unit.omni === 1 ? 'AF:omni' : 'AF';
    if (isPM(unit)) return 'PM';
    return unit.type.toLowerCase() as DerivedUnitClassKey;
}

function getInfantryTrooperBucketValue(facts: UnitFacts): InfantryTrooperBucketValue {
    if (isCI(facts.unit)) return `CI:${facts.scalars.troopers}`;
    return 'not-infantry';
}

function getCIMoveClassBucketValue(facts: UnitFacts): CIMoveClassBucketValue {
    const moveClass = getCIMoveClass(facts.unit);
    return moveClass ? `CI:${moveClass}` as CIMoveClassBucketValue : 'not-ci';
}

function getCIMoveClassTrooperBucketValue(facts: UnitFacts): CIMoveClassTrooperBucketValue {
    const moveClass = getCIMoveClass(facts.unit);
    if (!moveClass) {
        return 'not-ci';
    }

    return `CI:${moveClass}:${facts.scalars.troopers}` as CIMoveClassTrooperBucketValue;
}

function hasFlightMoveType(unit: Unit): boolean {
    return unit.as.MVm?.['a'] !== undefined || unit.as.MVm?.['v'] !== undefined || unit.as.MVm?.['g'] !== undefined;
}

function isFlightEligible(facts: UnitFacts): boolean {
    const unitType = getNormalizedOrgUnitType(facts.unit);
    return unitType === 'AF'
        || unitType === 'CF'
        || ((unitType === 'SV' || unitType === 'CV') && hasFlightMoveType(facts.unit));
}

function getFlightTypeBucketValue(facts: UnitFacts): FlightTypeBucketValue {
    if (!isFlightEligible(facts)) {
        return 'not-flight';
    }

    return `flight:${facts.unit.as.TP}`;
}

function getTransportBucketValue(facts: UnitFacts): TransportBucketValue {
    if (facts.unit.as.TP === 'BA') {
        const hasMec = facts.tags.has('transport.mec');
        const hasXmec = facts.tags.has('transport.xmec');
        if (hasMec && hasXmec) return 'BA:mec+xmec';
        if (hasXmec) return 'BA:xmec';
        if (hasMec) return 'BA:mec';
    }

    return facts.classKey;
}

function getPromotionBasicBucketValue(facts: GroupFacts): PromotionBasicBucketValue {
    return [
        facts.type ?? 'null',
        facts.countsAsType ?? 'null',
        facts.tag ?? '',
    ].join('|') as PromotionBasicBucketValue;
}

function getPromotionWithUnitKindsBucketValue(
    facts: GroupFacts,
): PromotionWithUnitKindsBucketValue {
    return [
        facts.type ?? 'null',
        facts.countsAsType ?? 'null',
        facts.tag ?? '',
        `BM:${facts.unitTypeCounts.get('BM') ?? 0}`,
        `CV:${facts.unitTypeCounts.get('CV') ?? 0}`,
        `AF:${facts.unitTypeCounts.get('AF') ?? 0}`,
        `CF:${facts.unitTypeCounts.get('CF') ?? 0}`,
        `BA:${facts.unitTypeCounts.get('BA') ?? 0}`,
        `CI:${facts.unitTypeCounts.get('CI') ?? 0}`,
        `PM:${facts.unitTypeCounts.get('PM') ?? 0}`,
    ].join('|') as PromotionWithUnitKindsBucketValue;
}

function getGroupCIMoveClassBucketValue(facts: GroupFacts): CIMoveClassBucketValue {
    if ((facts.unitTypeCounts.get('CI') ?? 0) <= 0) {
        return 'not-ci';
    }

    const moveClassTags = Array.from(facts.unitTagCounts.entries())
        .filter(([tag, count]) => count > 0 && tag.startsWith('ci:'))
        .map(([tag]) => tag as CIMoveClassTag);

    if (moveClassTags.length !== 1) {
        return 'mixed-ci';
    }

    return `CI:${moveClassTags[0].slice('ci:'.length)}` as CIMoveClassBucketValue;
}

export function compileUnitFacts(unit: Unit, index?: number): UnitFacts {
    const tags = new Set<UnitFactTag>();

    tags.add(getUnitClassKey(unit));

    if (isAero(unit)) tags.add('aero');
    if (unit.omni === 1) tags.add('omni');
    if (hasSpecial(unit, 'MEC')) tags.add('transport.mec');
    if (hasSpecial(unit, 'XMEC')) tags.add('transport.xmec');
    const ciMoveClassTag = getCIMoveClassTag(unit);
    if (ciMoveClassTag) tags.add(ciMoveClassTag);

    return {
        unit,
        factId: allocateUnitFactId(),
        classKey: getUnitClassKey(unit),
        tags,
        scalars: {
            id: unit.id,
            tons: unit.tons,
            pv: unit.pv,
            bv: unit.bv,
            troopers: unit.internal || 0,
            omni: unit.omni === 1,
            isAero: isAero(unit),
            isBM: isBM(unit),
            isCV: isCV(unit),
            isBA: isBA(unit),
            isCI: isCI(unit),
            isPM: isPM(unit),
            hasMEC: hasSpecial(unit, 'MEC'),
            hasXMEC: hasSpecial(unit, 'XMEC'),
        },
    };
}

export function compileUnitFactsList(units: ReadonlyArray<Unit>): UnitFacts[] {
    return units.map((unit, index) => compileUnitFacts(unit, index));
}

export function buildUnitFactsMap(units: ReadonlyArray<Unit>): WeakMap<Unit, UnitFacts> {
    const factsMap = new WeakMap<Unit, UnitFacts>();

    for (const [index, unit] of units.entries()) {
        factsMap.set(unit, compileUnitFacts(unit, index));
    }

    return factsMap;
}

export function collectGroupUnits(group: GroupSizeResult): Unit[] {
    const result: Unit[] = [];

    if (group.unitAllocations) {
        result.push(...group.unitAllocations.map((allocation) => allocation.unit));
    }

    if (group.units) {
        result.push(...group.units);
    }

    if (group.children) {
        for (const child of group.children) {
            result.push(...collectGroupUnits(child));
        }
    }

    return result;
}

function getGroupUnitAllocations(group: GroupSizeResult): GroupUnitAllocation[] | null {
    if (group.unitAllocations && group.unitAllocations.length > 0) {
        return [...group.unitAllocations];
    }

    if (group.units && group.units.length > 0) {
        return group.units.map((unit) => ({ unit, troopers: unit.internal || 0 }));
    }

    return null;
}

function getGroupProvenance(group: GroupSizeResult): OrgGroupProvenance {
    return group.provenance ?? 'produced-group';
}

export function compileGroupFacts(
    group: GroupSizeResult,
    unitFactsMap?: WeakMap<Unit, UnitFacts>,
    groupUnitCache?: WeakMap<GroupSizeResult, Unit[]>,
): GroupFacts {
    const childTypeCounts = new Map<OrgChildTypeCountKey, number>();
    const unitTypeCounts = new Map<Unit['as']['TP'], number>();
    const unitClassCounts = new Map<UnitClassKey, number>();
    const unitTagCounts = new Map<UnitFactTag, number>();
    const unitScalarSums = new Map<UnitNumericScalarName, number>();
    const descendantUnitBucketCounts = new Map<OrgUnitBucketName, Map<OrgBucketValue, number>>();

    for (const bucketName of ORG_UNIT_BUCKET_NAMES) {
        descendantUnitBucketCounts.set(bucketName, new Map<OrgBucketValue, number>());
    }

    for (const child of group.children ?? []) {
        incrementCount(childTypeCounts, child.type ?? 'null');
        if (child.countsAsType) {
            incrementCount(childTypeCounts, `countsAs:${child.countsAsType}` as OrgChildTypeCountKey);
        }
        if (child.tag) {
            incrementCount(childTypeCounts, `tag:${child.tag}` as OrgChildTypeCountKey);
        }
    }

    const directAllocations = getGroupUnitAllocations(group);
    const groupUnits = directAllocations?.map((allocation) => allocation.unit)
        ?? groupUnitCache?.get(group)
        ?? collectGroupUnits(group);
    if (groupUnitCache && !groupUnitCache.has(group)) {
        groupUnitCache.set(group, groupUnits);
    }

    const allocations = directAllocations ?? groupUnits.map((unit) => ({ unit, troopers: unit.internal || 0 }));

    for (const [index, allocation] of allocations.entries()) {
        const facts = unitFactsMap?.get(allocation.unit) ?? compileUnitFacts(allocation.unit, index);
        const normalizedUnitType = getNormalizedOrgUnitType(facts.unit);

        incrementCount(unitTypeCounts, normalizedUnitType);
        incrementCount(unitClassCounts, facts.classKey);
        for (const tag of facts.tags) {
            incrementCount(unitTagCounts, tag);
        }
        for (const [key, value] of Object.entries(facts.scalars)) {
            if (typeof value === 'number') {
                const numericValue = key === 'troopers' ? allocation.troopers : value;
                incrementCount(unitScalarSums, key as UnitNumericScalarName, numericValue);
            }
        }

        incrementCount(descendantUnitBucketCounts.get('classKey')!, facts.classKey);
        incrementCount(descendantUnitBucketCounts.get('ciMoveClass')!, getCIMoveClassBucketValue(facts));
        incrementCount(descendantUnitBucketCounts.get('ciMoveClassTroopers')!, getCIMoveClassTrooperBucketValue(facts));
        incrementCount(descendantUnitBucketCounts.get('flightType')!, getFlightTypeBucketValue(facts));
        incrementCount(descendantUnitBucketCounts.get('infantryTroopers')!, getInfantryTrooperBucketValue(facts));
        incrementCount(descendantUnitBucketCounts.get('transport')!, getTransportBucketValue(facts));
    }

    return {
        groupFactId: allocateGroupFactId(),
        group,
        type: group.type,
        countsAsType: group.countsAsType,
        modifierKey: group.modifierKey,
        tier: group.tier,
        provenance: getGroupProvenance(group),
        tag: group.tag,
        priority: group.priority,
        directChildCount: group.children?.length ?? 0,
        childTypeCounts,
        unitTypeCounts,
        unitClassCounts,
        unitTagCounts,
        unitScalarSums,
        descendantUnitBucketCounts,
    };
}

export function compileGroupFactsList(
    groups: ReadonlyArray<GroupSizeResult>,
    unitFactsMap?: WeakMap<Unit, UnitFacts>,
    groupUnitCache?: WeakMap<GroupSizeResult, Unit[]>,
): GroupFacts[] {
    return groups.map((group) => compileGroupFacts(group, unitFactsMap, groupUnitCache));
}

export function createOrgRuleRegistry(
    registry?: Partial<OrgRuleRegistry>,
): OrgRuleRegistry {
    return {
        unitSelectors: {
            all: () => true,
            aero: (facts) => facts.tags.has('aero'),
            flightEligible: (facts) => isFlightEligible(facts),
            infantry: (facts) => isBA(facts.unit) || isCI(facts.unit),
            nonInfantry: (facts) => !isBA(facts.unit) && !isCI(facts.unit),
            nonConventionalInfantry: (facts) => !isCI(facts.unit) && !facts.tags.has('aero'),
            nonAero: (facts) => !facts.tags.has('aero'),
            omni: (facts) => facts.tags.has('omni'),
            transportMec: (facts) => facts.tags.has('transport.mec'),
            transportXmec: (facts) => facts.tags.has('transport.xmec'),
            ...createUnitTypeSelectors(),
            ...registry?.unitSelectors,
        },
        unitBuckets: {
            classKey: (facts) => facts.classKey,
            ciMoveClass: (facts) => getCIMoveClassBucketValue(facts),
            ciMoveClassTroopers: (facts) => getCIMoveClassTrooperBucketValue(facts),
            flightType: (facts) => getFlightTypeBucketValue(facts),
            infantryTroopers: (facts) => getInfantryTrooperBucketValue(facts),
            transport: (facts) => getTransportBucketValue(facts),
            ...registry?.unitBuckets,
        },
        groupBuckets: {
            ciMoveClass: (facts) => getGroupCIMoveClassBucketValue(facts),
            promotionBasic: (facts) => getPromotionBasicBucketValue(facts),
            promotionWithUnitKinds: (facts) => getPromotionWithUnitKindsBucketValue(facts),
            ...registry?.groupBuckets,
        },
    };
}

export const DEFAULT_ORG_RULE_REGISTRY: OrgRuleRegistry = createOrgRuleRegistry();