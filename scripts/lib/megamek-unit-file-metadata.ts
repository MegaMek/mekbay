import fs from 'node:fs';
import path from 'node:path';

const MEK_WEIGHT_LIMITS = [15, 35, 55, 75, 100, 135] as const;
const VEHICLE_WEIGHT_LIMITS = [0, 39, 59, 79, 100, 300] as const;
const AEROSPACE_WEIGHT_LIMITS = [0, 45, 70, 100] as const;

export interface MegaMekUnitNameOptions {
    motionType?: string;
    isIndustrialMek?: boolean;
}

export interface MegaMekUnitFileMetadata {
    uuid?: string;
    unitType: string;
    chassis: string;
    model: string;
    unitName: string;
    mulId?: number;
    sources: string[];
    publishedRSSources: string[];
    introYear?: number;
    weightClass?: number;
    isClanTech: boolean;
    isStarLeague: boolean;
    source: string;
    role?: string;
    techBase: 'IS' | 'Clan' | 'Mixed (IS Chassis)' | 'Mixed (Clan Chassis)';
    movementMode?: string;
    bfsAssetType?: 'Vehicle' | 'Conventional Infantry' | 'Battle Armor';
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isCanonicalUuid(value: string | undefined): value is string {
    return value !== undefined && UUID_PATTERN.test(value);
}

function parseYear(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const raw = String(value).trim();
    const match = raw.match(/^(\d{4})/);
    return match ? Number.parseInt(match[1], 10) : undefined;
}

function parseMulId(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsedId = Number.parseInt(String(value).trim(), 10);
    return Number.isFinite(parsedId) && parsedId > 0 ? parsedId : undefined;
}

export function splitMegaMekSourceList(sourceList: string | undefined): string[] {
    if (!sourceList) {
        return [];
    }

    return sourceList
        .split(/[\r\n,]+/u)
        .map((source) => source.trim())
        .filter((source) => source.length > 0);
}

function buildChassisName(chassis: string, clanName: string): string {
    if (!chassis || !clanName) {
        return chassis;
    }

    const expectedSuffix = `(${clanName})`;
    if (chassis.includes(expectedSuffix)) {
        return chassis;
    }

    return `${chassis} ${expectedSuffix}`;
}

function normalizeMetadataUnitTypeName(rawUnitType: string, context: string, motionType?: string): string {
    const normalized = rawUnitType.trim();
    const normalizedMotionType = motionType?.trim().toLowerCase();

    switch (normalized) {
        case 'Mek':
        case 'BattleArmor':
        case 'Infantry':
        case 'ProtoMek':
        case 'VTOL':
        case 'Naval':
        case 'Gun Emplacement':
        case 'Conventional Fighter':
        case 'AeroSpaceFighter':
        case 'Aero':
        case 'Small Craft':
        case 'Dropship':
        case 'Jumpship':
        case 'Warship':
        case 'Space Station':
        case 'Handheld Weapon':
        case 'Mobile Structure':
        case 'Advanced Building':
            return normalized;
        case 'Battle Armor':
            return 'BattleArmor';
        case 'Protomek':
        case 'ProtoMech':
            return 'ProtoMek';
        case 'GunEmplacement':
            return 'Gun Emplacement';
        case 'ConvFighter':
            return 'Conventional Fighter';
        case 'Aerospace Fighter':
        case 'AerospaceFighter':
            return 'AeroSpaceFighter';
        case 'SmallCraft':
            return 'Small Craft';
        case 'DropShip':
            return 'Dropship';
        case 'JumpShip':
            return 'Jumpship';
        case 'SpaceStation':
            return 'Space Station';
        case 'HandheldWeapon':
            return 'Handheld Weapon';
        case 'MobileStructure':
            return 'Mobile Structure';
        case 'AdvancedBuilding':
            return 'Advanced Building';
        case 'Tank':
        case 'SupportTank':
        case 'LargeSupportTank':
            if (normalizedMotionType === 'hydrofoil'
                || normalizedMotionType === 'submarine'
                || normalizedMotionType === 'naval') {
                return 'Naval';
            }
            return 'Tank';
        case 'SupportVTOL':
            return 'VTOL';
        case 'FixedWingSupport':
            return 'Conventional Fighter';
        case 'BuildingEntity':
            return 'Advanced Building';
        default:
            throw new Error(`[MegaMek] unknown unit type "${rawUnitType}" in ${context}`);
    }
}

function normalizeMetadataNameUnitTypeName(rawUnitType: string, context: string): string {
    const normalized = rawUnitType.trim();

    switch (normalized) {
        case 'Mek':
        case 'BattleArmor':
        case 'Infantry':
        case 'ProtoMek':
        case 'VTOL':
        case 'Naval':
        case 'Tank':
        case 'SupportTank':
        case 'LargeSupportTank':
        case 'SupportVTOL':
        case 'FixedWingSupport':
        case 'Gun Emplacement':
        case 'Conventional Fighter':
        case 'AeroSpaceFighter':
        case 'Aero':
        case 'Small Craft':
        case 'Dropship':
        case 'Jumpship':
        case 'Warship':
        case 'Space Station':
        case 'Handheld Weapon':
        case 'Mobile Structure':
        case 'Advanced Building':
        case 'BuildingEntity':
            return normalized;
        case 'Battle Armor':
            return 'BattleArmor';
        case 'Protomek':
        case 'ProtoMech':
            return 'ProtoMek';
        case 'GunEmplacement':
            return 'Gun Emplacement';
        case 'ConvFighter':
            return 'Conventional Fighter';
        case 'Aerospace Fighter':
        case 'AerospaceFighter':
            return 'AeroSpaceFighter';
        case 'SmallCraft':
            return 'Small Craft';
        case 'DropShip':
            return 'Dropship';
        case 'JumpShip':
            return 'Jumpship';
        case 'SpaceStation':
            return 'Space Station';
        case 'HandheldWeapon':
            return 'Handheld Weapon';
        case 'MobileStructure':
            return 'Mobile Structure';
        case 'AdvancedBuilding':
            return 'Advanced Building';
        default:
            throw new Error(`[MegaMek] unknown unit type "${rawUnitType}" in ${context}`);
    }
}

function normalizeMetadataUnitTypeFromDirectory(filePath: string, rootPath: string): string {
    const relativePath = path.relative(rootPath, filePath);
    const topLevelDir = relativePath.split(path.sep)[0]?.trim().toLowerCase();

    switch (topLevelDir) {
        case 'meks':
            return 'Mek';
        case 'vehicles':
        case 'tanks':
            return 'Tank';
        case 'battlearmor':
            return 'BattleArmor';
        case 'infantry':
            return 'Infantry';
        case 'protomeks':
            return 'ProtoMek';
        case 'vtol':
            return 'VTOL';
        case 'naval':
            return 'Naval';
        case 'gunemplacement':
        case 'gunemplacements':
        case 'ge':
            return 'Gun Emplacement';
        case 'convfighter':
            return 'Conventional Fighter';
        case 'fighters':
            return 'AeroSpaceFighter';
        case 'smallcraft':
            return 'Small Craft';
        case 'dropships':
            return 'Dropship';
        case 'jumpships':
            return 'Jumpship';
        case 'warship':
            return 'Warship';
        case 'spacestation':
            return 'Space Station';
        case 'handheld':
            return 'Handheld Weapon';
        case 'mobilestructure':
            return 'Mobile Structure';
        case 'advancedbuildings':
        case 'advancedbuilding':
            return 'Advanced Building';
        default:
            throw new Error(`[MegaMek] cannot derive unit type from path ${filePath}`);
    }
}

function deriveWeightClass(unitType: string, tonnage: number): number | undefined {
    if (!Number.isFinite(tonnage) || tonnage <= 0) {
        return undefined;
    }

    if (unitType === 'Mek') {
        for (let index = 0; index < MEK_WEIGHT_LIMITS.length - 1; index += 1) {
            if (tonnage <= MEK_WEIGHT_LIMITS[index]) {
                return index;
            }
        }
        return MEK_WEIGHT_LIMITS.length - 1;
    }

    if (unitType === 'Tank' || unitType === 'Naval' || unitType === 'VTOL') {
        for (let index = 1; index < VEHICLE_WEIGHT_LIMITS.length - 1; index += 1) {
            if (tonnage <= VEHICLE_WEIGHT_LIMITS[index]) {
                return index;
            }
        }
        return VEHICLE_WEIGHT_LIMITS.length - 1;
    }

    if (unitType === 'AeroSpaceFighter' || unitType === 'Conventional Fighter' || unitType === 'Aero') {
        for (let index = 1; index < AEROSPACE_WEIGHT_LIMITS.length - 1; index += 1) {
            if (tonnage <= AEROSPACE_WEIGHT_LIMITS[index]) {
                return index;
            }
        }
        return AEROSPACE_WEIGHT_LIMITS.length - 1;
    }

    return undefined;
}

function getTaggedText(raw: string, tagName: string): string | undefined {
    const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = raw.match(new RegExp(`<${escapedTagName}>([\\s\\S]*?)</${escapedTagName}>`, 'i'));
    return match?.[1]?.trim();
}

function parseBlkTechFlags(rawType: string): { isClanTech: boolean; isStarLeague: boolean } {
    const normalizedType = rawType.trim().toLowerCase();
    const isClanTech = normalizedType.includes('clan') || normalizedType.includes('mixed');
    const isStarLeague = !isClanTech
        && (normalizedType.includes('advanced') || normalizedType.includes('experimental') || normalizedType.includes('unofficial'));

    return { isClanTech, isStarLeague };
}

function parseMtfTechFlags(techBase: string, rulesLevel: number | undefined): { isClanTech: boolean; isStarLeague: boolean } {
    const normalizedTechBase = techBase.trim().toLowerCase();
    const isClanTech = normalizedTechBase.includes('clan') || normalizedTechBase.includes('mixed');
    const isStarLeague = !isClanTech && rulesLevel !== undefined && rulesLevel >= 3;

    return { isClanTech, isStarLeague };
}

function isIndustrialMekMetadata(model: string, structure?: string): boolean {
    const normalizedModel = model.trim().toLowerCase();
    const normalizedStructure = structure?.trim().toLowerCase() ?? '';
    return normalizedModel.includes('industrialmech') || normalizedStructure.includes('industrial');
}

function getMegaMekUnitNamePrefix(unitType: string, motionType?: string, isIndustrialMek = false): string {
    switch (unitType) {
        case 'Mek':
            return isIndustrialMek ? 'IM' : 'BM';
        case 'ProtoMek':
            return 'PM';
        case 'Mobile Structure':
            return 'MS';
        case 'Tank':
        case 'VTOL':
        case 'Naval':
        case 'Advanced Building':
        case 'BuildingEntity':
            return 'CV';
        case 'SupportTank':
        case 'LargeSupportTank':
        case 'SupportVTOL':
        case 'FixedWingSupport':
        case 'Gun Emplacement':
            return 'SV';
        case 'BattleArmor':
            return 'BA';
        case 'Infantry':
            return 'CI';
        case 'Space Station':
            return 'SS';
        case 'Warship':
            return 'WS';
        case 'Jumpship':
            return 'JS';
        case 'Dropship':
            return motionType?.trim().toLowerCase() === 'spheroid' ? 'DS' : 'DA';
        case 'Small Craft':
            return 'SC';
        case 'Conventional Fighter':
            return 'CF';
        case 'AeroSpaceFighter':
        case 'Aero':
            return 'AF';
        default:
            return '';
    }
}

export function buildMegaMekUnitName(unitType: string, chassis: string, model: string, options?: MegaMekUnitNameOptions): string {
    const prefix = getMegaMekUnitNamePrefix(unitType, options?.motionType, options?.isIndustrialMek ?? false);
    return `${prefix}${chassis}_${model}`
        .replace(/[^a-zA-Z0-9_]/gu, '')
        .replace(/_+/gu, '_')
        .replace(/^_+|_+$/gu, '');
}

function parseBlkUnitFileMetadata(raw: string, filePath: string): MegaMekUnitFileMetadata | undefined {
    const rawUnitType = getTaggedText(raw, 'UnitType') ?? '';
    const motionType = getTaggedText(raw, 'motion_type');
    const unitType = normalizeMetadataUnitTypeName(rawUnitType, filePath, motionType);
    const nameUnitType = normalizeMetadataNameUnitTypeName(rawUnitType, filePath);
    const chassis = getTaggedText(raw, 'Name') ?? '';
    const model = getTaggedText(raw, 'Model') ?? '';
    if (!chassis) {
        return undefined;
    }

    const parsedWeightClass = Number.parseInt(getTaggedText(raw, 'weightclass') ?? '', 10);
    const tonnage = Number.parseFloat(getTaggedText(raw, 'tonnage') ?? '');
    const weightClass = Number.isFinite(parsedWeightClass)
        ? parsedWeightClass
        : deriveWeightClass(unitType, tonnage);
    const techFlags = parseBlkTechFlags(getTaggedText(raw, 'type') ?? '');
    const source = getTaggedText(raw, 'source') ?? '';

    return {
        uuid: getTaggedText(raw, 'UUID'),
        unitType,
        chassis,
        model,
        unitName: buildMegaMekUnitName(nameUnitType, chassis, model, { motionType }),
        mulId: parseMulId(getTaggedText(raw, 'mul id:')),
        sources: splitMegaMekSourceList(source),
        publishedRSSources: splitMegaMekSourceList(getTaggedText(raw, 'published')),
        introYear: parseYear(getTaggedText(raw, 'year')),
        weightClass,
        isClanTech: techFlags.isClanTech,
        isStarLeague: techFlags.isStarLeague,
        source,
        role: parseRole(getTaggedText(raw, 'role')),
        techBase: parseTechBase(getTaggedText(raw, 'type') ?? ''),
        movementMode: parseMovementMode(motionType),
        bfsAssetType: toBfsAssetType(unitType),
    };
}

function parseMtfUnitFileMetadata(raw: string, filePath: string, rootPath: string): MegaMekUnitFileMetadata | undefined {
    const fields = new Map<string, string>();
    for (const line of raw.split(/\r?\n/u)) {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();
        if (value && !fields.has(key)) {
            fields.set(key, value);
        }
    }

    const unitType = normalizeMetadataUnitTypeFromDirectory(filePath, rootPath);
    const baseChassis = fields.get('chassis') ?? '';
    const clanName = fields.get('clanname') ?? '';
    const chassis = buildChassisName(baseChassis, clanName);
    if (!chassis) {
        return undefined;
    }

    const unitNameChassis = clanName ? baseChassis : chassis;
    const model = fields.get('model') ?? '';
    const isIndustrialMek = unitType === 'Mek' && isIndustrialMekMetadata(model, fields.get('structure'));
    const rulesLevel = Number.parseInt(fields.get('rules level') ?? '', 10);
    const tonnage = Number.parseFloat(fields.get('mass') ?? '');
    const techFlags = parseMtfTechFlags(fields.get('techbase') ?? '', Number.isFinite(rulesLevel) ? rulesLevel : undefined);
    const source = fields.get('source') ?? '';

    return {
        uuid: fields.get('uuid'),
        unitType,
        chassis,
        model,
        unitName: buildMegaMekUnitName(unitType, unitNameChassis, model, { isIndustrialMek }),
        mulId: parseMulId(fields.get('mul id')),
        sources: splitMegaMekSourceList(source),
        publishedRSSources: splitMegaMekSourceList(fields.get('published')),
        introYear: parseYear(fields.get('era')),
        weightClass: deriveWeightClass(unitType, tonnage),
        isClanTech: techFlags.isClanTech,
        isStarLeague: techFlags.isStarLeague,
        source,
        role: parseRole(fields.get('role')),
        techBase: parseTechBase(fields.get('techbase') ?? ''),
        movementMode: parseMovementMode(fields.get('motion type') ?? fields.get('movement mode')),
        bfsAssetType: toBfsAssetType(unitType),
    };
}

export function parseMegaMekUnitFileMetadata(raw: string, filePath: string, unitFilesRoot: string): MegaMekUnitFileMetadata | undefined {
    switch (path.extname(filePath).toLowerCase()) {
        case '.blk':
            return parseBlkUnitFileMetadata(raw, filePath);
        case '.mtf':
            return parseMtfUnitFileMetadata(raw, filePath, unitFilesRoot);
        default:
            throw new Error(`[MegaMek] unsupported unit file extension in ${filePath}`);
    }
}

export function readMegaMekUnitFileMetadata(filePath: string, unitFilesRoot: string): MegaMekUnitFileMetadata | undefined {
    const raw = fs.readFileSync(filePath, 'utf8');
    return parseMegaMekUnitFileMetadata(raw, filePath, unitFilesRoot);
}

function parseTechBase(value: string): MegaMekUnitFileMetadata['techBase'] {
    const normalized = value.trim().toLowerCase();
    if (normalized.includes('mixed')) {
        return normalized.includes('clan') ? 'Mixed (Clan Chassis)' : 'Mixed (IS Chassis)';
    }
    return normalized.includes('clan') ? 'Clan' : 'IS';
}

function parseRole(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized.toUpperCase().replace(/[\s-]+/gu, '_') : undefined;
}

function parseMovementMode(value: string | undefined): string | undefined {
    switch (value?.trim().toLowerCase().replace(/[\s_-]+/gu, '')) {
        case 'tracked': return 'TRACKED';
        case 'wheeled': return 'WHEELED';
        case 'hover': return 'HOVER';
        case 'vtol': return 'VTOL';
        case 'wige': return 'WIGE';
        case 'leg': return 'INF_LEG';
        case 'jump': return 'INF_JUMP';
        case 'motorized': return 'INF_MOTORIZED';
        case 'umu': return 'INF_UMU';
        default: return undefined;
    }
}

function toBfsAssetType(unitType: string): MegaMekUnitFileMetadata['bfsAssetType'] {
    switch (unitType) {
        case 'Tank':
        case 'VTOL':
        case 'Naval':
            return 'Vehicle';
        case 'Infantry':
            return 'Conventional Infantry';
        case 'BattleArmor':
            return 'Battle Armor';
        default:
            return undefined;
    }
}
