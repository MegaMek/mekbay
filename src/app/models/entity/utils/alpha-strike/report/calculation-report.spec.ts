import {
  CalculationReportBuilder,
  NULL_CALCULATION_REPORT,
  formatForReport,
  formatRoundedReportResult,
} from './calculation-report';
import { renderTextCalculationReport } from './text-calculation-report-renderer';

describe('CalculationReportBuilder', () => {
  it('records every report event and normalizes null columns', () => {
    const report = new CalculationReportBuilder();

    report.addHeader('Header')
      .addSubHeader('Section:')
      .addLine(null, 'calculation', null)
      .addEmptyLine()
      .addResultLine('Total', 'round normal', '12');

    expect(report.events()).toEqual([
      { kind: 'header', text: 'Header' },
      { kind: 'subHeader', text: 'Section:' },
      { kind: 'line', type: '', calculation: 'calculation', result: '' },
      { kind: 'line', type: '', calculation: '', result: '' },
      { kind: 'resultSeparator' },
      { kind: 'line', type: 'Total', calculation: 'round normal', result: '12' },
    ]);
  });

  it('commits a tentative section in order', () => {
    const report = new CalculationReportBuilder();
    report.addLine('Before');
    report.startTentativeSection();
    report.addLine('Tentative');
    report.startTentativeSection();
    report.addLine('Still tentative');
    report.endTentativeSection();
    report.endTentativeSection();
    report.addLine('After');

    expect(report.events().map(event => event.kind === 'line' ? event.type : event.kind))
      .toEqual(['Before', 'Tentative', 'Still tentative', 'After']);
  });

  it('discards a tentative section without affecting committed events', () => {
    const report = new CalculationReportBuilder();
    report.addLine('Before');
    report.startTentativeSection();
    report.addResultLine('Discarded', '', '1');
    report.finalizeTentativeSection(false);
    report.discardTentativeSection();

    expect(report.events()).toEqual([
      { kind: 'line', type: 'Before', calculation: '', result: '' },
    ]);
  });

  it('keeps a tentative section through finalization', () => {
    const report = new CalculationReportBuilder();
    report.startTentativeSection();
    report.addLine('Kept');
    report.finalizeTentativeSection(true);

    expect(report.events()).toEqual([
      { kind: 'line', type: 'Kept', calculation: '', result: '' },
    ]);
  });

  it('returns a defensive copy of committed events', () => {
    const report = new CalculationReportBuilder();
    report.addLine('Original');
    const events = report.events() as unknown[];
    events.length = 0;

    expect(report.events()).toHaveSize(1);
  });

  it('supports a reusable no-op report sink', () => {
    expect(() => {
      NULL_CALCULATION_REPORT.addHeader('Ignored').addLine('Ignored');
      NULL_CALCULATION_REPORT.startTentativeSection();
      NULL_CALCULATION_REPORT.finalizeTentativeSection(true);
    }).not.toThrow();
  });
});

describe('calculation report number formatting', () => {
  it('formats numeric result columns with US grouping and one decimal', () => {
    expect(formatRoundedReportResult('= ', 1234.56)).toBe('= 1,234.6');
    expect(formatRoundedReportResult(null, 0)).toBe('0.0');
  });

  it('formats only significant report decimals up to thousandths', () => {
    expect([12, 12.3, 12.34, 12.345, 12.3456].map(formatForReport))
      .toEqual(['12', '12.3', '12.34', '12.345', '12.346']);
  });

  it('rejects non-finite numeric values', () => {
    expect(() => formatForReport(Number.NaN)).toThrowError(RangeError);
    expect(() => formatRoundedReportResult('', Number.POSITIVE_INFINITY)).toThrowError(RangeError);
  });
});

describe('renderTextCalculationReport', () => {
  it('uses global widths, headers, separators, padded blank lines, and a trailing newline', () => {
    const report = new CalculationReportBuilder();
    report.addHeader('Header')
      .addSubHeader('Section:')
      .addLine('A', 'x + y', '1')
      .addEmptyLine()
      .addResultLine('Long', '', '123');

    expect(renderTextCalculationReport(report.events())).toBe([
      'Header',
      '------',
      'Section:',
      '   A      x + y     1',
      '                     ',
      '                  ---',
      '   Long           123',
      '',
    ].join('\n'));
  });

  it('allows a late line to widen every earlier line', () => {
    const report = new CalculationReportBuilder();
    report.addLine('A', '', '1').addLine('Long type', 'calculation', 'result');

    const [first] = renderTextCalculationReport(report.events()).split('\n');

    expect(first).toBe('   A                              1');
  });

  it('uses a header as the minimum report width', () => {
    const report = new CalculationReportBuilder();
    report.addHeader('A much wider header').addResultLine('', '', '1');

    expect(renderTextCalculationReport(report.events())).toBe([
      'A much wider header',
      '-------------------',
      `${' '.repeat(18)}-`,
      `${' '.repeat(18)}1`,
      '',
    ].join('\n'));
  });

  it('renders independent header underlines and explicit CRLF endings', () => {
    const report = new CalculationReportBuilder();
    report.addHeader('One').addHeader('Longer');

    expect(renderTextCalculationReport(report.events(), { eol: '\r\n' }))
      .toBe('One\r\n---\r\nLonger\r\n------\r\n');
  });

  it('renders an empty report as an empty string', () => {
    expect(renderTextCalculationReport([])).toBe('');
  });
});
