import { parseInventoryComponentReference } from './inventory-component-reference.model';
import type { UnitComponent } from './units.model';

export interface InventoryAmmoCapacityInput {
    readonly entryId: string;
    readonly components: readonly UnitComponent[];
    readonly maximumShotsPerBin: number;
    readonly storedTotalAmmo?: number;
}

/** Resolves aggregate component ammunition and distributes any remainder to the first bins. */
export function resolveInventoryOriginalAmmoTotal(input: InventoryAmmoCapacityInput): number {
    const reference = parseInventoryComponentReference(input.entryId);
    const component = reference ? input.components[reference.componentIndex] : undefined;
    const binCount = Math.max(1, component?.q ?? 1);
    const aggregateTotal = component?.q2
        || input.maximumShotsPerBin * binCount
        || input.storedTotalAmmo
        || 0;

    if (reference?.binIndex == null) return aggregateTotal;
    return distributeInventoryAmmoTotal(aggregateTotal, binCount, reference.binIndex);
}

export function distributeInventoryAmmoTotal(
    aggregateTotal: number,
    binCount: number,
    binIndex: number,
): number {
    const normalizedBinCount = Math.max(1, Math.trunc(binCount));
    const baseBinAmmo = Math.floor(aggregateTotal / normalizedBinCount);
    const extraBinAmmo = aggregateTotal % normalizedBinCount;
    return baseBinAmmo + (binIndex < extraBinAmmo ? 1 : 0);
}
