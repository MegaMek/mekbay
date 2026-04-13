import { formatSummaryMovement } from './pilot-abilities.model';

describe('formatSummaryMovement', () => {
    it('formats embedded movement placeholders in inches by default', () => {
        expect(formatSummaryMovement(['Move up to [[12]]']).at(0)).toBe('Move up to 12″');
    });

    it('formats embedded movement placeholders as hexes when requested', () => {
        expect(formatSummaryMovement(['Move up to [[12]]'], true).at(0)).toBe('Move up to 6<span class="hex-symbol">⬢</span>');
    });
});