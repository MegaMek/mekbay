import {
    STANDARD_CARD_GEOMETRY,
    buildStandardLayout,
    getStandardCriticalRows,
    wrapSvgText,
} from './standard-layout.model';
import { CARD_LAYOUT_GEOMETRY } from './card-layout.geometry';

describe('standard Alpha Strike SVG layout', () => {
    it('uses the shared card body inset and frame gap', () => {
        expect(STANDARD_CARD_GEOMETRY.contentLeft).toBe(CARD_LAYOUT_GEOMETRY.bodyInset);
        expect(STANDARD_CARD_GEOMETRY.contentRight).toBe(CARD_LAYOUT_GEOMETRY.bodyRight);
        expect(STANDARD_CARD_GEOMETRY.contentBottom).toBe(CARD_LAYOUT_GEOMETRY.bodyBottom);

        const layout = buildStandardLayout({
            specialsText: '',
            usesHeat: true,
            hasCriticalTable: true,
        });
        expect((layout.critical?.x ?? 0) - (layout.general.x + layout.general.width)).toBe(CARD_LAYOUT_GEOMETRY.frameGap);
        expect(layout.damage.y - (layout.general.y + layout.general.height)).toBe(CARD_LAYOUT_GEOMETRY.frameGap);
        expect(layout.mainBottom).toBe(CARD_LAYOUT_GEOMETRY.bodyBottom);
    });

    it('stacks the main row against the footer when SPECIALS are absent', () => {
        const layout = buildStandardLayout({
            specialsText: '',
            usesHeat: true,
            hasCriticalTable: true,
        });

        expect(layout.specials).toBeNull();
        expect(layout.mainBottom).toBe(STANDARD_CARD_GEOMETRY.contentBottom);
        expect(layout.armor.y + layout.armor.height).toBe(layout.mainBottom);
        expect(layout.critical?.y).toBe(layout.mainBottom - (layout.critical?.height ?? 0));
    });

    it('grows multiline SPECIALS upward and moves the main row by the same amount', () => {
        const measureText = (text: string): number => text.length * 20;
        const short = buildStandardLayout({
            specialsText: 'SPECIAL: CASE',
            usesHeat: true,
            hasCriticalTable: true,
            measureText,
        });
        const long = buildStandardLayout({
            specialsText: 'SPECIAL: AECM C3M2 CASEII IF1 LG MHQ10 OMNI TAG TUR IF1 MHQ10 TAG',
            usesHeat: true,
            hasCriticalTable: true,
            measureText,
        });

        expect(long.specialsLines.length).toBeGreaterThan(short.specialsLines.length);
        const growth = (long.specials?.height ?? 0) - (short.specials?.height ?? 0);
        expect(short.mainBottom - long.mainBottom).toBe(growth);
        expect(short.general.y - long.general.y).toBe(growth);
    });

    it('moves damage and general frames down when heat is omitted', () => {
        const withHeat = buildStandardLayout({
            specialsText: '',
            usesHeat: true,
            hasCriticalTable: false,
        });
        const withoutHeat = buildStandardLayout({
            specialsText: '',
            usesHeat: false,
            hasCriticalTable: false,
        });

        expect(withoutHeat.heat).toBeNull();
        expect(withoutHeat.damage.y - withHeat.damage.y).toBe(
            STANDARD_CARD_GEOMETRY.heatHeight + CARD_LAYOUT_GEOMETRY.frameGap,
        );
        expect(withoutHeat.general.y - withHeat.general.y).toBe(
            STANDARD_CARD_GEOMETRY.heatHeight + CARD_LAYOUT_GEOMETRY.frameGap,
        );
    });

    it('uses an injectable font measurement function for deterministic wrapping', () => {
        const measured: string[] = [];
        const lines = wrapSvgText('SPECIAL: ONE TWO THREE', 120, 30, 900, (text, font) => {
            measured.push(font);
            return text.length * 12;
        });

        expect(lines).toEqual(['SPECIAL:', 'ONE TWO', 'THREE']);
        expect(measured.every(font => font.includes('Roboto'))).toBeTrue();
        expect(measured.every(font => !font.includes('Roboto Condensed'))).toBeTrue();
    });

    it('grows the armor frame when armor pips wrap before the structure row', () => {
        const singleRows = buildStandardLayout({
            specialsText: '',
            usesHeat: true,
            hasCriticalTable: true,
            armorPips: 12,
            structurePips: 8,
        });
        const wrappedArmor = buildStandardLayout({
            specialsText: '',
            usesHeat: true,
            hasCriticalTable: true,
            armorPips: 21,
            structurePips: 9,
        });

        expect(wrappedArmor.armor.height).toBeGreaterThan(singleRows.armor.height);
        expect(wrappedArmor.armor.y).toBeLessThan(singleRows.armor.y);
        expect(wrappedArmor.mainBottom).toBe(singleRows.mainBottom);
    });

    it('derives a two-line SPECIALS card with wrapped armor from shared geometry', () => {
        const layout = buildStandardLayout({
            specialsText: 'SPECIAL: AECM C3M2 CASEII IF1 LG MHQ10 OMNI TAG TUR IF1 MHQ10 TAG',
            usesHeat: true,
            hasCriticalTable: true,
            armorPips: 15,
            structurePips: 10,
            criticalHeight: 218,
            measureText: (text) => text.length * 20,
        });

        const leftWidth = Math.round(
            (CARD_LAYOUT_GEOMETRY.bodyWidth - CARD_LAYOUT_GEOMETRY.frameGap)
            * STANDARD_CARD_GEOMETRY.leftColumnRatio,
        );
        const rightX = CARD_LAYOUT_GEOMETRY.bodyInset + leftWidth + CARD_LAYOUT_GEOMETRY.frameGap;
        const specialsHeight = STANDARD_CARD_GEOMETRY.specialsPaddingY * 2
            + 2 * STANDARD_CARD_GEOMETRY.specialsLineHeight;
        const specialsY = STANDARD_CARD_GEOMETRY.contentBottom - specialsHeight;
        const mainBottom = specialsY - CARD_LAYOUT_GEOMETRY.frameGap;
        const wrappedArmorHeight = 13 + 3 * STANDARD_CARD_GEOMETRY.pipRowHeight;
        const armorY = mainBottom - wrappedArmorHeight;
        const heatY = armorY - CARD_LAYOUT_GEOMETRY.frameGap - STANDARD_CARD_GEOMETRY.heatHeight;
        const damageY = heatY - CARD_LAYOUT_GEOMETRY.frameGap - STANDARD_CARD_GEOMETRY.damageHeight;
        const generalY = damageY - CARD_LAYOUT_GEOMETRY.frameGap - STANDARD_CARD_GEOMETRY.generalHeight;

        expect(layout.general).toEqual({
            x: CARD_LAYOUT_GEOMETRY.bodyInset,
            y: generalY,
            width: leftWidth,
            height: STANDARD_CARD_GEOMETRY.generalHeight,
        });
        expect(layout.damage?.y).toBe(damageY);
        expect(layout.heat?.y).toBe(heatY);
        expect(layout.armor?.y).toBe(armorY);
        expect(layout.critical).toEqual({
            x: rightX,
            y: mainBottom - 218,
            width: CARD_LAYOUT_GEOMETRY.bodyRight - rightX,
            height: 218,
        });
        expect(layout.specials).toEqual({
            x: CARD_LAYOUT_GEOMETRY.bodyInset,
            y: specialsY,
            width: CARD_LAYOUT_GEOMETRY.bodyWidth,
            height: specialsHeight,
        });
    });

    it('defines native critical rows for every standard card variant', () => {
        expect(getStandardCriticalRows('mek').map(row => row.key)).toEqual(['engine', 'fire-control', 'mp', 'weapons']);
        expect(getStandardCriticalRows('vehicle').map(row => row.key)).toEqual(['engine', 'fire-control', 'weapons']);
        expect(getStandardCriticalRows('protomek').map(row => row.key)).toEqual(['fire-control', 'mp', 'weapons']);
        expect(getStandardCriticalRows('aerofighter').map(row => row.key)).toEqual(['engine', 'fire-control', 'weapons']);
        expect(getStandardCriticalRows('emplacement').map(row => row.key)).toEqual(['weapons']);
        expect(getStandardCriticalRows('none')).toEqual([]);
    });
});