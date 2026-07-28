import type { TooltipLine } from '../components/tooltip/tooltip.component';

export function orderHitTargetTooltipLines(lines: readonly TooltipLine[]): TooltipLine[] {
    const regular: TooltipLine[] = [];
    const negative: TooltipLine[] = [];
    const heat: TooltipLine[] = [];

    for (const line of lines) {
        if (line.kind === 'heat') {
            heat.push(line);
        } else if (line.negative === true) {
            negative.push(line);
        } else {
            regular.push(line);
        }
    }

    return [...regular, ...negative, ...heat];
}