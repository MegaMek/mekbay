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
  startTentativeSection(): void;
  endTentativeSection(): void;
  discardTentativeSection(): void;
  finalizeTentativeSection(keepSection: boolean): void;
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

/** Formats only necessary decimal places, up to the three used by MegaMek reports. */
export function formatForReport(value: number): string {
  assertFinite(value);
  const timesThousand = javaRound(value * 1000);
  const digits = timesThousand % 1000 === 0 ? 0
    : timesThousand % 100 === 0 ? 1
    : timesThousand % 10 === 0 ? 2
    : 3;
  return value.toFixed(digits);
}

function javaRound(value: number): number {
  return Math.floor(value + 0.5);
}

function assertFinite(value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError('Calculation report values must be finite.');
  }
}

/** Stores report events, including Java-compatible tentative sections. */
export class CalculationReportBuilder implements CalculationReportSink {
  private readonly committedEvents: CalculationReportEvent[] = [];
  private tentativeEvents: CalculationReportEvent[] | null = null;

  events(): readonly CalculationReportEvent[] {
    return [...this.committedEvents];
  }

  addLine(
    type: string | null = '',
    calculation: string | null = '',
    result: string | null = '',
  ): this {
    this.targetEvents().push({
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
    this.targetEvents().push({ kind: 'resultSeparator' });
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
    this.targetEvents().push({ kind: 'header', text });
    return this;
  }

  addSubHeader(text: string): this {
    this.targetEvents().push({ kind: 'subHeader', text });
    return this;
  }

  addEmptyLine(): this {
    return this.addLine();
  }

  startTentativeSection(): void {
    this.tentativeEvents ??= [];
  }

  endTentativeSection(): void {
    if (this.tentativeEvents === null) return;
    this.committedEvents.push(...this.tentativeEvents);
    this.tentativeEvents = null;
  }

  discardTentativeSection(): void {
    if (this.tentativeEvents === null) return;
    this.tentativeEvents = null;
  }

  finalizeTentativeSection(keepSection: boolean): void {
    if (keepSection) this.endTentativeSection();
    else this.discardTentativeSection();
  }

  private targetEvents(): CalculationReportEvent[] {
    return this.tentativeEvents ?? this.committedEvents;
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
  startTentativeSection(): void { /* Intentionally empty. */ }
  endTentativeSection(): void { /* Intentionally empty. */ }
  discardTentativeSection(): void { /* Intentionally empty. */ }
  finalizeTentativeSection(): void { /* Intentionally empty. */ }
}

export const NULL_CALCULATION_REPORT: CalculationReportSink = new NullCalculationReport();
