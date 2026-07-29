import { FORCE_TAG_MAX_COUNT, HEAT_SCHEMA, sanitizeForceTagLabels, sanitizeForceTags, TURN_STATE_SCHEMA } from './force-serialization';
import { Sanitizer } from '../utils/sanitizer.util';

describe('force tag sanitization', () => {
    const manyTags = [
        '11', '12', '123', '13', '133', '14', '15', '16', '17', '18', '19', '233',
        '24', '25', '26', '27', '28', '29', '30', '31', '32', '33', '34', '35',
        '36', '37', '38', '39', '40', '41', '443', 'a', 'aa', 'b', 'bbbb', 'c',
        'cccc', 'd', 'e', 'er', 'f', 'g', 'zz',
    ];

    it('keeps all force tag labels for global catalogs', () => {
        const labels = sanitizeForceTagLabels(manyTags);

        expect(labels.length).toBe(manyTags.length);
        expect(labels).toContain('aa');
        expect(labels).toContain('zz');
    });

    it('still applies the per-force tag count limit to assigned force tags', () => {
        const tags = sanitizeForceTags(manyTags);

        expect(tags).toEqual(manyTags.slice(0, FORCE_TAG_MAX_COUNT));
        expect(tags).not.toContain('aa');
        expect(tags).not.toContain('zz');
    });
});

describe('heat state sanitization', () => {
    it('discards malformed optional values instead of creating a zero target', () => {
        expect(Sanitizer.sanitize({ current: 4, previous: 3, next: 'invalid', heatsinksOff: Infinity }, HEAT_SCHEMA)).toEqual({
            current: 4,
            previous: 3,
        });

        expect(Sanitizer.sanitize({
            moveDistance: 'invalid',
            dmgReceived: Number.NaN,
            weaponsHeat: Number.POSITIVE_INFINITY,
        }, TURN_STATE_SCHEMA)).toEqual({});
    });

    it('normalizes valid optional numeric values to non-negative values', () => {
        expect(Sanitizer.sanitize({ current: 4, previous: 3, next: '7', heatsinksOff: -2 }, HEAT_SCHEMA)).toEqual({
            current: 4,
            previous: 3,
            next: 7,
            heatsinksOff: 0,
        });
    });
});