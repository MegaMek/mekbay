export interface MegaMekEraRecord {
    code: string;
    name: string;
    startYear?: number;
    endYear?: number;
    mulId?: number;
    icon?: string;
}

export type MegaMekForceGeneratorTimeline = Record<string, number[]>;

export interface MegaMekEras {
    eras: MegaMekEraRecord[];
    forceGenerator: MegaMekForceGeneratorTimeline;
}