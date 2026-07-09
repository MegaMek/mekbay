import {
    VESSEL_FRONT_GEOMETRY,
    VESSEL_REAR_GEOMETRY,
    VESSEL_SPECIALS_GEOMETRY,
    buildVesselSpecialsLayout,
} from './vessel-layout.model';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';

describe('large vessel Alpha Strike SVG layout', () => {
    it('uses the shared card body inset and frame gap', () => {
        expect(VESSEL_FRONT_GEOMETRY.leftX).toBe(CARD_LAYOUT_GEOMETRY.bodyInset);
        expect(VESSEL_FRONT_GEOMETRY.rightX - (
            VESSEL_FRONT_GEOMETRY.leftX + VESSEL_FRONT_GEOMETRY.leftWidth
        )).toBe(CARD_LAYOUT_GEOMETRY.frameGap);
        expect(VESSEL_FRONT_GEOMETRY.secondRowY - (
            VESSEL_FRONT_GEOMETRY.statsY + VESSEL_FRONT_GEOMETRY.statsHeight
        )).toBe(CARD_LAYOUT_GEOMETRY.frameGap);
        expect(VESSEL_FRONT_GEOMETRY.criticalY - (
            VESSEL_FRONT_GEOMETRY.secondRowY + VESSEL_FRONT_GEOMETRY.damageHeight
        )).toBe(CARD_LAYOUT_GEOMETRY.frameGap);
        expect(VESSEL_FRONT_GEOMETRY.mainBottom).toBe(CARD_LAYOUT_GEOMETRY.bodyBottom);
        expect(VESSEL_SPECIALS_GEOMETRY.bottom).toBe(CARD_LAYOUT_GEOMETRY.bodyBottom);
        expect(VESSEL_REAR_GEOMETRY.frameWidth * 2 + CARD_LAYOUT_GEOMETRY.frameGap)
            .toBe(CARD_LAYOUT_GEOMETRY.bodyWidth);
    });

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