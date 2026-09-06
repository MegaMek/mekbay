import { CanonPipRenderer } from './canon-pip-renderer';
import { PaperdollGenerator, type PaperdollOptions, type PaperdollPipCounts } from './paperdoll-generator';

const STRUCTURE_LOCATIONS = ['HD', 'CT', 'LT', 'RT', 'LA', 'RA', 'LL', 'RL'] as const;
export type MekStructureTonnage = number | Readonly<Record<string, number>>;

export interface MekPaperdollOptions extends Omit<PaperdollOptions, 'type' | 'canonicalPips'> {
    assetUrl?: string;
    /** Exact internal counts for superheavy and non-biped chassis. */
    structurePipCounts?: PaperdollPipCounts;
}

/** Mek-specific defaults and the authored biped map; each view has its own output. */
export class MekPaperdollGenerator {
    public static async createArmorPaperdoll(
        width: number,
        height: number,
        armor: PaperdollPipCounts,
        options: MekPaperdollOptions = {},
    ): Promise<SVGGElement> {
        return PaperdollGenerator.createPaperdoll(
            options.assetUrl ?? '/images/paperdolls/biped-armor.svg', width, height, { armor },
            { ...options, pipLayout: options.pipLayout ?? 'canon', canonicalPips: (type, location, w, h, pipOptions) =>
                type === 'armor' && typeof armor[location] === 'number'
                    ? CanonPipRenderer.createArmorPips(location, armor[location], w, h, pipOptions)
                    : null },
        );
    }

    public static createArmorRearPaperdoll(
        width: number,
        height: number,
        armor: PaperdollPipCounts,
        options: MekPaperdollOptions = {},
    ): Promise<SVGGElement> {
        return this.createArmorPaperdoll(width, height, armor, {
            ...options, assetUrl: options.assetUrl ?? '/images/paperdolls/biped-armor-back.svg',
        });
    }

    public static createStructurePaperdoll(
        width: number,
        height: number,
        tonnage: MekStructureTonnage,
        options: MekPaperdollOptions = {},
    ): Promise<SVGGElement> {
        const locationTonnage = (location: string): number | undefined =>
            typeof tonnage === 'number' ? tonnage : tonnage[location];
        const structure = options.structurePipCounts ?? Object.fromEntries(STRUCTURE_LOCATIONS.map(location =>
            [location, CanonPipRenderer.getStructurePipCount(locationTonnage(location) ?? 0, location)]));
        return PaperdollGenerator.createPaperdoll(
            options.assetUrl ?? '/images/paperdolls/biped-structure.svg', width, height, { structure },
            { ...options, type: 'structure', pipLayout: options.pipLayout ?? 'canon',
                canonicalPips: (type, location, w, h, pipOptions) => {
                    const mass = locationTonnage(location);
                    return type === 'structure' && typeof mass === 'number'
                        ? CanonPipRenderer.createStructurePips(mass, location, w, h, pipOptions)
                        : null;
                } },
        );
    }
}
