import { fitRectWithinBounds } from './as-card-export.util';

describe('fitRectWithinBounds', () => {
    it('uses the full target when the aspect ratio already matches', () => {
        expect(fitRectWithinBounds(1120, 800, 1400, 1000)).toEqual({
            x: 0,
            y: 0,
            width: 1400,
            height: 1000,
        });
    });

    it('pads vertically when the target is taller than the card ratio', () => {
        expect(fitRectWithinBounds(1120, 800, 1200, 1200)).toEqual({
            x: 0,
            y: 171,
            width: 1200,
            height: 857,
        });
    });

    it('pads horizontally when the target is wider than the card ratio', () => {
        expect(fitRectWithinBounds(1120, 800, 1600, 800)).toEqual({
            x: 240,
            y: 0,
            width: 1120,
            height: 800,
        });
    });
});