import type { TooltipLine } from '../components/tooltip/tooltip.component';
import type { ToHitModifierBreakdownEntry } from '../models/rules/game-rules';

export function modifierTooltipLines<T extends ToHitModifierBreakdownEntry>(
    entries: readonly T[],
    formatValue: (entry: T) => string,
): TooltipLine[] {
    return entries.map(entry => ({
        label: entry.label,
        value: formatValue(entry),
        ...(entry.weakened && { weakened: true }),
        ...(entry.kind && { kind: entry.kind }),
    }));
}

export function orderedModifierTooltipLines<T extends ToHitModifierBreakdownEntry>(
    entries: readonly T[],
    formatValue: (entry: T) => string,
): TooltipLine[] {
    return orderHitTargetTooltipLines(modifierTooltipLines(entries, formatValue));
}

export function orderHitTargetTooltipLines(lines: readonly TooltipLine[]): TooltipLine[] {
    const regular: TooltipLine[] = [];
    const weakened: TooltipLine[] = [];
    const heat: TooltipLine[] = [];

    for (const line of lines) {
        if (line.kind === 'heat') {
            heat.push(line);
        } else if (line.weakened === true) {
            weakened.push(line);
        } else {
            regular.push(line);
        }
    }

    return [...regular, ...weakened, ...heat];
}