import { layoutRecordSheetAmmo } from './record-sheet-ammo.util';

describe('record sheet ammo layout', () => {
    const measure = (text: string) => text.length;

    it('takes no rows when there is no ammo', () => {
        expect(layoutRecordSheetAmmo([], 40, measure)).toEqual({ lines: [], widths: [], scale: 1 });
    });

    it('keeps naturally fitting ammo in one uncompressed row', () => {
        const layout = layoutRecordSheetAmmo(['(LRM 10) 12', '(MG) 100'], 40, measure);

        expect(layout.lines).toEqual(['Ammo: (LRM 10) 12, (MG) 100']);
        expect(layout.widths).toEqual([27]);
        expect(layout.scale).toBe(1);
    });

    it('uses acceptable compression before adding another row', () => {
        const layout = layoutRecordSheetAmmo(['(LRM 10) 12', '(MG) 100'], 23, measure);

        expect(layout.lines).toEqual(['Ammo: (LRM 10) 12, (MG) 100']);
        expect(layout.scale).toBeCloseTo(23 / 27);
        expect(layout.scale).toBeGreaterThanOrEqual(0.82);
    });

    it('adds the fewest rows and balances their content using one compression scale', () => {
        const entries = ['(AAA) 5', '(BBB) 5', '(CCC) 5', '(DDD) 5', '(EEE) 5', '(FFF) 5'];
        const layout = layoutRecordSheetAmmo(entries, 27, measure);

        expect(layout.lines).toEqual(['Ammo: (AAA) 5, (BBB) 5, (CCC) 5,', '(DDD) 5, (EEE) 5, (FFF) 5']);
        expect(layout.widths).toEqual([32, 25]);
        expect(layout.scale).toBeCloseTo(27 / 32);
        expect(layout.scale).toBeGreaterThanOrEqual(0.82);
        expect(layout.widths.every(width => width * layout.scale <= 27)).toBeTrue();
        expect(layout.lines.join(' ')).toBe(`Ammo: ${entries.join(', ')}`);
    });

    it('balances rows even when greedy wrapping would pack more into the first row', () => {
        const layout = layoutRecordSheetAmmo(
            ['(AAA) 5', '(BBB) 5', '(CCC) 5', '(DDD) 5', '(EEE) 5', '(FFF) 5'],
            34,
            measure,
        );

        expect(layout.widths).toEqual([32, 25]);
        expect(layout.scale).toBe(1);
    });

    it('uses actual measured widths to balance rows', () => {
        const proportionalMeasure = (text: string) => Array.from(text)
            .reduce((width, character) => width + (character === 'W' ? 4 : 1), 0);
        const entries = ['(WW) 5', '(i) 5', '(i) 5', '(i) 5'];
        const layout = layoutRecordSheetAmmo(entries, 20, proportionalMeasure);

        expect(layout.lines).toEqual(['Ammo: (WW) 5,', '(i) 5, (i) 5, (i) 5']);
        expect(layout.widths).toEqual([19, 19]);
        expect(layout.scale).toBe(1);
    });

    it('splits an oversized entry at words without omitting text', () => {
        const entries = ['(Extremely Long Range Missile Ammo) 120', '(MG) 100'];
        const layout = layoutRecordSheetAmmo(entries, 20, measure);

        expect(layout.lines.length).toBeGreaterThan(1);
        expect(layout.lines.join(' ')).toBe(`Ammo: ${entries.join(', ')}`);
        expect(layout.lines.every(line => !line.includes('...'))).toBeTrue();
        expect(layout.scale).toBeGreaterThanOrEqual(0.82);
        expect(layout.widths.every(width => width * layout.scale <= 20)).toBeTrue();
    });

    it('splits an oversized word at characters while preserving every character', () => {
        const entry = '(ABCDEFGHIJKLMNOPQRSTUVWXYZ) 5';
        const layout = layoutRecordSheetAmmo([entry], 10, measure);

        expect(layout.lines.length).toBeGreaterThan(1);
        expect(layout.lines.join('').replace(/\s/gu, '')).toBe(`Ammo:${entry}`.replace(/\s/gu, ''));
        expect(layout.scale).toBeGreaterThanOrEqual(0.82);
        expect(layout.widths.every(width => width * layout.scale <= 10)).toBeTrue();
    });

    it('supports a different prefix without changing row compression', () => {
        expect(layoutRecordSheetAmmo(['(MG) 100'], 20, measure, 'Ammo carried:').lines)
            .toEqual(['Ammo carried: (MG) 100']);
    });
});
