import type { FactionEraDisplayInfo } from '../../utils/force-namer.util';

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function smoothIntensity(value: number): number {
    const clamped = clamp(value, 0, 1);
    return clamped * clamped * (3 - (2 * clamped));
}

export function buildFactionEraTitle(eraItem: FactionEraDisplayInfo): string {
    const range = `${eraItem.era.years.from ?? '?'}-${eraItem.era.years.to ?? 'present'}`;
    const markers: string[] = [];

    if (eraItem.isBeforeReferenceYear) {
        markers.push('before highest intro year');
    }

    return `${eraItem.era.name} (${range}) - ${(eraItem.matchPercentage * 100).toFixed(0)}% match${markers.length ? `, ${markers.join(', ')}` : ''}`;
}

export function getFactionEraIconFilter(eraItem: FactionEraDisplayInfo): string {
    if (!eraItem.isAvailable) {
        return 'none';
    }

    if (eraItem.isBeforeReferenceYear) {
        return 'opacity(0.8)';
    }

    const intensity = smoothIntensity(eraItem.matchPercentage);
    const sepia = 0.35 + (intensity * 0.65);
    const saturate = 1 + (intensity * 9);
    const hueRotate = 344;
    const glowAlpha = 0 + (intensity * 1);
    const glowBlur = 0 + (intensity * 2);

    return [
        `sepia(${sepia})`,
        `saturate(${saturate})`,
        `hue-rotate(${hueRotate}deg)`,
        `drop-shadow(0 0 ${glowBlur}px rgba(214, 162, 74, ${glowAlpha}))`
    ].join(' ');
}