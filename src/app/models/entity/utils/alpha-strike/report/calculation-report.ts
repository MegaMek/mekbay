// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later
// Author: Drake

export interface CalculationReportLine {
  readonly kind: 'line';
  readonly type: string;
  readonly calculation: string;
  readonly result: string;
}

export interface CalculationReportHeader {
  readonly kind: 'header' | 'subHeader';
  readonly text: string;
}

export interface CalculationReportResultSeparator {
  readonly kind: 'resultSeparator';
}

export type CalculationReportEvent =
  | CalculationReportLine
  | CalculationReportHeader
  | CalculationReportResultSeparator;

/** Receives calculation events without coupling calculations to a presentation format. */
export interface CalculationReportSink {
  addLine(type?: string | null, calculation?: string | null, result?: string | null): this;
  addNumericLine(
    type: string | null,
    calculation: string | null,
    resultPrefix: string | null,
    result: number,
  ): this;
  addResultLine(type?: string | null, calculation?: string | null, result?: string | null): this;
  addNumericResultLine(
    type: string | null,
    calculation: string | null,
    resultPrefix: string | null,
    result: number,
  ): this;
  addHeader(text: string): this;
  addSubHeader(text: string): this;
  addEmptyLine(): this;
}

/** Java-compatible rounding used by calculation-report numeric result overloads. */
export function formatRoundedReportResult(prefix: string | null, value: number): string {
  assertFinite(value);
  return `${prefix ?? ''}${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: true,
  }).format(value)}`;
}

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError('Calculation report values must be finite.');
  }
}

/** Stores calculation report events. */
export class CalculationReportBuilder implements CalculationReportSink {
  private readonly committedEvents: CalculationReportEvent[] = [];

  events(): readonly CalculationReportEvent[] {
    return [...this.committedEvents];
  }

  addLine(
    type: string | null = '',
    calculation: string | null = '',
    result: string | null = '',
  ): this {
    this.committedEvents.push({
      kind: 'line',
      type: type ?? '',
      calculation: calculation ?? '',
      result: result ?? '',
    });
    return this;
  }

  addNumericLine(
    type: string | null,
    calculation: string | null,
    resultPrefix: string | null,
    result: number,
  ): this {
    return this.addLine(type, calculation, formatRoundedReportResult(resultPrefix, result));
  }

  addResultLine(
    type: string | null = '',
    calculation: string | null = '',
    result: string | null = '',
  ): this {
    this.committedEvents.push({ kind: 'resultSeparator' });
    return this.addLine(type, calculation, result);
  }

  addNumericResultLine(
    type: string | null,
    calculation: string | null,
    resultPrefix: string | null,
    result: number,
  ): this {
    return this.addResultLine(type, calculation, formatRoundedReportResult(resultPrefix, result));
  }

  addHeader(text: string): this {
    this.committedEvents.push({ kind: 'header', text });
    return this;
  }

  addSubHeader(text: string): this {
    this.committedEvents.push({ kind: 'subHeader', text });
    return this;
  }

  addEmptyLine(): this {
    return this.addLine();
  }

}

/** No-op sink used when callers do not request a report. */
class NullCalculationReport implements CalculationReportSink {
  addLine(): this { return this; }
  addNumericLine(): this { return this; }
  addResultLine(): this { return this; }
  addNumericResultLine(): this { return this; }
  addHeader(): this { return this; }
  addSubHeader(): this { return this; }
  addEmptyLine(): this { return this; }
}

export const NULL_CALCULATION_REPORT: CalculationReportSink = new NullCalculationReport();
