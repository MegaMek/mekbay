import { VESSEL_SPECIALS_GEOMETRY, buildVesselSpecialsLayout } from './vessel-layout.model';

describe('large vessel Alpha Strike SVG layout', () => {
    it('omits the SPECIAL frame for empty content', () => {
        const layout = buildVesselSpecialsLayout(0);

        expect(layout.frame).toBeNull();
        expect(layout.lineCount).toBe(0);
    });

    it('keeps one through three lines anchored to the same bottom edge', () => {
        const layouts = [1, 2, 3].map(buildVesselSpecialsLayout);

        for (const layout of layouts) {
            expect((layout.frame?.y ?? 0) + (layout.frame?.height ?? 0)).toBe(VESSEL_SPECIALS_GEOMETRY.bottom);
        }
    });

    it('increases frame height by one line height for each wrapped line', () => {
        const oneLine = buildVesselSpecialsLayout(1);
        const twoLines = buildVesselSpecialsLayout(2);
        const threeLines = buildVesselSpecialsLayout(3);

        expect((twoLines.frame?.height ?? 0) - (oneLine.frame?.height ?? 0)).toBe(VESSEL_SPECIALS_GEOMETRY.lineHeight);
        expect((threeLines.frame?.height ?? 0) - (twoLines.frame?.height ?? 0)).toBe(VESSEL_SPECIALS_GEOMETRY.lineHeight);
        expect(twoLines.frame?.height).toBeLessThan(threeLines.frame?.height ?? 0);
    });
});