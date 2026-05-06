import { FORCE_TAG_MAX_COUNT, sanitizeForceTagLabels, sanitizeForceTags } from './force-serialization';

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