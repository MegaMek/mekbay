import type { Unit, UnitComponent } from '../models/units.model';

type WeightedRangeUnit = Pick<Unit, 'subtype' | 'internal' | 'comp'>;

interface WeightedRangeContribution {
    damage: number | null;
    quantity: number;
    range: number;
}

function getComponentMaxRange(component: Pick<UnitComponent, 'r'>): number {
    if (!component.r) {
        return 0;
    }

    let maxRange = 0;
    for (const range of component.r.split('/')) {
        const parsedRange = parseInt(range, 10) || 0;
        if (parsedRange > maxRange) {
            maxRange = parsedRange;
        }
    }

    return maxRange;
}

function parseNumericDamage(value: string | undefined): number | null {
    if (!value) {
        return null;
    }

    const trimmedValue = value.trim();
    if (trimmedValue.length === 0) {
        return null;
    }

    const numericValue = Number(trimmedValue);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function getComponentDamage(unit: Pick<Unit, 'subtype' | 'internal'>, component: UnitComponent): number | null {
    const parsedDamage = parseNumericDamage(component.md);
    if (parsedDamage === null) {
        return null;
    }

    if (unit.subtype === 'Battle Armor' && component.l !== 'SSW' && component.p < 1) {
        return parsedDamage * unit.internal;
    }

    return parsedDamage;
}

function roundToHundredths(value: number): number {
    return Math.round(value * 100) / 100;
}

function roundToRangeBracket(value: number, ranges: number[]): number {
    const sortedRanges = Array.from(new Set(ranges)).sort((left, right) => left - right);
    if (sortedRanges.length === 0) {
        return 0;
    }

    let roundedRange = sortedRanges[0];
    let smallestDistance = Math.abs(value - roundedRange);
    for (const range of sortedRanges.slice(1)) {
        const distance = Math.abs(value - range);
        if (distance < smallestDistance || (distance === smallestDistance && range > roundedRange)) {
            roundedRange = range;
            smallestDistance = distance;
        }
    }

    return roundedRange;
}

export function getMaxRangeFromComponents(components: UnitComponent[]): number {
    let maxRange = 0;

    for (const component of components) {
        const componentMaxRange = getComponentMaxRange(component);
        if (componentMaxRange > maxRange) {
            maxRange = componentMaxRange;
        }
    }

    return maxRange;
}

export function calculateWeightedMaxRange(unit: WeightedRangeUnit): number {
    const contributions: WeightedRangeContribution[] = [];

    for (const component of unit.comp) {
        const range = getComponentMaxRange(component);
        if (range <= 0) {
            continue;
        }

        contributions.push({
            damage: getComponentDamage(unit, component),
            quantity: component.q || 1,
            range,
        });
    }

    if (contributions.length === 0) {
        return 0;
    }

    let numericDamageTotal = 0;
    let numericWeaponCount = 0;
    for (const contribution of contributions) {
        if (contribution.damage === null) {
            continue;
        }

        numericDamageTotal += contribution.damage * contribution.quantity;
        numericWeaponCount += contribution.quantity;
    }

    const averageNumericDamage = numericWeaponCount > 0
        ? numericDamageTotal / numericWeaponCount
        : 0;

    let totalWeight = 0;
    let weightedRangeTotal = 0;
    for (const contribution of contributions) {
        const damage = contribution.damage ?? averageNumericDamage;
        const weight = damage * contribution.quantity;
        if (weight <= 0) {
            continue;
        }

        totalWeight += weight;
        weightedRangeTotal += contribution.range * weight;
    }

    if (totalWeight <= 0) {
        return 0;
    }

    const weightedRange = roundToHundredths(weightedRangeTotal / totalWeight);
    return roundToRangeBracket(weightedRange, contributions.map(contribution => contribution.range));
}