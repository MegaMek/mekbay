// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

import type {
  CalculationReportEvent,
  CalculationReportHeader,
  CalculationReportLine,
} from './calculation-report';

export interface TextCalculationReportOptions {
  readonly eol?: '\n' | '\r\n';
}

const COLUMN_SPACING = 3;

/** Renders structured calculation events using MegaMek's global column layout. */
export function renderTextCalculationReport(
  events: readonly CalculationReportEvent[],
  options: TextCalculationReportOptions = {},
): string {
  const eol = options.eol ?? '\n';
  if (events.length === 0) return '';

  const lines = events.filter((event): event is CalculationReportLine => event.kind === 'line');
  const maxTypeWidth = maxLength(lines.map(line => line.type));
  const maxCalculationWidth = maxLength(lines.map(line => line.calculation));
  const maxResultWidth = maxLength(lines.map(line => line.result));
  const maxHeaderWidth = maxLength(events
    .filter((event): event is CalculationReportHeader =>
      event.kind === 'header' || event.kind === 'subHeader')
    .map(event => event.text));
  const width = Math.max(
    maxTypeWidth + maxCalculationWidth + maxResultWidth + COLUMN_SPACING * 3,
    maxHeaderWidth,
  );
  const calculationStart = COLUMN_SPACING * 2 + maxTypeWidth;

  return events.map(event => {
    switch (event.kind) {
      case 'line':
        return renderLine(event, width, calculationStart);
      case 'header':
        return `${event.text}${eol}${'-'.repeat(event.text.length)}`;
      case 'subHeader':
        return event.text;
      case 'resultSeparator':
        return `${' '.repeat(width - maxResultWidth)}${'-'.repeat(maxResultWidth)}`;
    }
  }).join(eol) + eol;
}

function renderLine(line: CalculationReportLine, width: number, calculationStart: number): string {
  const beforeCalculation = calculationStart - line.type.length - COLUMN_SPACING;
  const beforeResult = width - line.result.length - calculationStart - line.calculation.length;
  return `${' '.repeat(COLUMN_SPACING)}${line.type}${' '.repeat(beforeCalculation)}`
    + `${line.calculation}${' '.repeat(beforeResult)}${line.result}`;
}

function maxLength(values: readonly string[]): number {
  return Math.max(1, ...values.map(value => value.length));
}
