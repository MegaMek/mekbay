export interface PipRenderOptions {
    className?: string;
    fill?: string;
    inset?: number;
    minPipRadius?: number;
    pipGap?: number;
    pipRadius?: number;
    useCanonPipRadius?: boolean;
    stroke?: string;
    strokeWidthRatio?: number;
    shape?: 'circle' | 'diamond';
}

export interface PipRow {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface PipPoint {
    readonly x: number;
    readonly y: number;
}

export interface PipBounds {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface PipGroupLayout {
    readonly width: number;
    readonly height: number;
    readonly radius?: number;
    readonly stroke?: number;
    readonly points: readonly (readonly [number, number])[];
}