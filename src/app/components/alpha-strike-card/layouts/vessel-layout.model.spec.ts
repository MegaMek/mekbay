import {
    VESSEL_FRONT_GEOMETRY,
    VESSEL_REAR_GEOMETRY,
    VESSEL_SPECIALS_GEOMETRY,
    VESSEL_REAR_SPECIALS_GEOMETRY,
    buildVesselRearSpecialsLayout,
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

    it('centers spaced rear critical pip clusters on their column boundaries', () => {
        const columnWidth = (
            VESSEL_REAR_GEOMETRY.frameWidth
            - VESSEL_REAR_GEOMETRY.tableXOffset
            - VESSEL_REAR_GEOMETRY.tableRightInset
            - VESSEL_REAR_GEOMETRY.rowLabelWidth
        ) / 4;
        const clusterStart = (columnWidth - 3 * VESSEL_REAR_GEOMETRY.critPipSpacing) / 2;
        const previousLastPip = clusterStart + 3 * VESSEL_REAR_GEOMETRY.critPipSpacing;
        const nextFirstPip = columnWidth + clusterStart;

        expect((previousLastPip + nextFirstPip) / 2).toBeCloseTo(columnWidth);
        expect(VESSEL_REAR_GEOMETRY.critPipSpacing)
            .toBeGreaterThan(2 * VESSEL_REAR_GEOMETRY.critPipRadius + 3);
        expect(VESSEL_REAR_GEOMETRY.captionXOffset).toBeGreaterThan(25);
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

    it('wraps and reduces rear arc specials to fit the fixed SPE band', () => {
        const layout = buildVesselRearSpecialsLayout(
            ['PNT3', 'FLK2/2/1', 'ARTAIS-1', 'TAG'],
            150,
        );
        const lineCount = Math.max(...layout.tokens.map(token => token.line)) + 1;

        expect(lineCount).toBeGreaterThan(1);
        expect(layout.fontSize).toBeLessThanOrEqual(VESSEL_REAR_SPECIALS_GEOMETRY.maxFontSize);
        expect(lineCount * layout.lineHeight).toBeLessThanOrEqual(VESSEL_REAR_SPECIALS_GEOMETRY.height);
    });
});