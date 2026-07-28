import type { ForceUnit } from '../models/force-unit.model';
import {
    formatForceUnitBVPV,
    formatForceUnitsBVPV,
    formatForceViewerBVPV,
} from './force-viewer-bv-pv-display.util';

describe('force viewer BV/PV display', () => {
    function forceUnit(adjusted: number, base: number): ForceUnit {
        return {
            getBv: () => adjusted,
            getPreSkillBv: () => base,
        } as unknown as ForceUnit;
    }

    it('formats the adjusted value', () => {
        expect(formatForceViewerBVPV(1_250, 1_000, 'adjusted')).toBe('1,250');
    });

    it('formats the pre-skill base value', () => {
        expect(formatForceViewerBVPV(1_250, 1_000, 'base')).toBe('1,000');
    });

    it('formats adjusted and base values in adjusted-first order', () => {
        expect(formatForceViewerBVPV(1_250, 1_000, 'both')).toBe('1,250 (1,000)');
    });

    it('suppresses the duplicate base value when both values are equal', () => {
        expect(formatForceViewerBVPV(1_000, 1_000, 'both')).toBe('1,000');
    });

    it('never compresses BV/PV values', () => {
        expect(formatForceUnitBVPV(forceUnit(12_600, 10_400), 'both')).toBe('12,600 (10,400)');
    });

    it('returns an empty value when no force unit is available', () => {
        expect(formatForceUnitBVPV(undefined, 'adjusted')).toBe('');
    });

    it('aggregates adjusted and pre-skill values independently', () => {
        const units = [forceUnit(1_250, 1_000), forceUnit(750, 800)];

        expect(formatForceUnitsBVPV(units, 'adjusted')).toBe('2,000');
        expect(formatForceUnitsBVPV(units, 'base')).toBe('1,800');
        expect(formatForceUnitsBVPV(units, 'both')).toBe('2,000 (1,800)');
    });

    it('formats an empty collection as zero', () => {
        expect(formatForceUnitsBVPV([], 'both')).toBe('0');
    });
});