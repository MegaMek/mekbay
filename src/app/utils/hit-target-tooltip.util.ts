import type { TooltipLine } from '../components/tooltip/tooltip.component';
import type { ToHitModifierBreakdownEntry } from '../models/rules/game-rules';

export function modifierTooltipLines<T extends ToHitModifierBreakdownEntry>(
    entries: readonly T[],
    formatValue: (entry: T) => string,
): TooltipLine[] {
    return entries.map(entry => ({
        label: entry.label,
        value: formatValue(entry),
        ...(entry.priority !== undefined && { priority: entry.priority }),
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
    return lines
        .map((line, index) => ({ line, index }))
        .sort((left, right) => {
            const priorityDifference = (left.line.priority ?? 0) - (right.line.priority ?? 0);
            if (priorityDifference !== 0) return priorityDifference;
            const groupDifference = tooltipLineGroup(left.line) - tooltipLineGroup(right.line);
            return groupDifference !== 0 ? groupDifference : left.index - right.index;
        })
        .map(({ line }) => line);
}

function tooltipLineGroup(line: TooltipLine): number {
    if (line.kind === 'heat') return 2;
    if (line.weakened === true) return 1;
    return 0;
}