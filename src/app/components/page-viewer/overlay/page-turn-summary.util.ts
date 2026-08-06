import type { PSRCheck, UnitHeatSource } from '../../../models/rules/unit-type-rules';
import type { SelectedInventoryWeaponHeat } from '../../../utils/inventory-control-heat.util';

export interface TurnSummaryHeatRow {
    readonly id: string;
    readonly label: string;
    readonly value: number;
    readonly selectedValue?: number;
    readonly selectedOnly?: boolean;
}

export function composeTurnSummaryHeatRows(
    sources: readonly UnitHeatSource[],
    selection: SelectedInventoryWeaponHeat
): TurnSummaryHeatRow[] {
    const rows = sources.map(source => ({ id: source.id, label: source.label, value: source.value }));
    if (!selection.hasSelection) return rows;

    const weaponsRow = rows.find(row => row.id === 'weapons');
    if (weaponsRow) {
        return rows.map(row => row === weaponsRow ? { ...row, selectedValue: selection.value } : row);
    }
    return [{
        id: 'selected-weapons',
        label: 'Selected Weapons',
        value: selection.value,
        selectedOnly: true,
    }, ...rows];
}

export function displayPsrModifiers(modifiers: readonly PSRCheck[]): Array<PSRCheck & { pilotCheck: number }> {
    return modifiers
        .filter((modifier): modifier is PSRCheck & { pilotCheck: number } =>
            modifier.pilotCheck !== undefined && modifier.pilotCheck !== 0
        )
        .map(modifier => ({
            ...modifier,
            reason: modifier.modifierReason ?? modifier.reason,
        }));
}

export function countActionablePsrChecks(
    checks: readonly Pick<PSRCheck, 'failureOutcome'>[],
    autoFall: boolean
): number {
    return autoFall ? checks.filter(check => check.failureOutcome !== 'Fall').length : checks.length;
}
