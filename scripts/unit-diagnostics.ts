import type { BattleValueDetail } from '../src/app/models/entity/utils/battle-value/bv-calculator';
import type { EntityCostReport } from '../src/app/models/entity/utils/cost/cost-report';

export function formatDiagnosticNumber(value: number): string {
  return Number.isInteger(value)
    ? value.toLocaleString('en-US')
    : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

export function formatCostReport(report: EntityCostReport): string[] {
  const lines = report.steps.map(step => {
    const operation = step.amount !== undefined
      ? `${step.amount >= 0 ? '+' : '-'} ${formatDiagnosticNumber(Math.abs(step.amount))}`
      : `× ${formatDiagnosticNumber(step.factor)}`;
    return `${step.type}: ${operation} => ${formatDiagnosticNumber(step.subtotal)}`;
  });
  lines.push(`Total: ${formatDiagnosticNumber(report.total)}`);
  return lines;
}

export function formatBattleValueDetails(
  details: readonly BattleValueDetail[],
  depth = 0,
): string[] {
  const indent = '  '.repeat(depth);
  return details.flatMap(detail => {
    const values = [
      detail.calculation,
      detail.delta !== undefined ? `Δ ${formatDiagnosticNumber(detail.delta)}` : undefined,
      detail.total !== undefined ? `total ${formatDiagnosticNumber(detail.total)}` : undefined,
    ].filter((value): value is string => value !== undefined);
    const line = `${indent}${detail.type}${values.length > 0 ? `: ${values.join(' | ')}` : ''}`;
    return [line, ...formatBattleValueDetails(detail.details ?? [], depth + 1)];
  });
}