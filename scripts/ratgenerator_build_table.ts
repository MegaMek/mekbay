import fs from 'node:fs';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import { load as loadYaml } from 'js-yaml';

interface DateRange {
    start?: number;
    end?: number;
}

interface UniverseFactionRecord {
    id: string;
    name: string;
    ratingLevels: string[];
    fallBackFactions: string[];
    yearsActive: DateRange[];
}

interface MegaMekEra {
    code: string;
    name: string;
    startYear?: number;
    endYear?: number;
    mulId?: number;
}

interface ParsedAvailabilityRating {
    rating: string;
    value: number;
}

interface AvailabilityRecord {
    faction: string;
    era: number;
    startYear: number;
    availability: number;
    ratingAdjustment: -1 | 0 | 1;
    byRating: ParsedAvailabilityRating[];
}

interface UnitSummaryRecord {
    id: number;
    chassis: string;
    model: string;
    year: number;
}

interface ChassisRecordData {
    key: string;
    sortKey: string;
    chassis: string;
    unitType: string;
    omniType?: 'IS' | 'Clan';
    includedFactions: JavaLikeHashSet<string>;
    modelKeys: JavaLikeHashSet<string>;
    availabilityByEra: Map<number, Map<string, AvailabilityRecord>>;
}

interface ModelRecordData {
    key: string;
    chassisKey: string;
    chassis: string;
    model: string;
    unitType: string;
    omniType?: 'IS' | 'Clan';
    includedFactions: JavaLikeHashSet<string>;
    availabilityByEra: Map<number, Map<string, AvailabilityRecord>>;
    mulId: number;
    introYear: number;
}

interface BuildOptions {
    mmDataRoot?: string;
    unitFilesRoot?: string;
    nameChangesFilePath?: string;
    outputFilePath?: string;
}

interface BuildResult {
    csv: string;
    outputFilePath: string;
}

interface HashNode<T> {
    hash: number;
    value: T;
    next?: HashNode<T>;
}

const APP_ROOT = path.resolve(__dirname, '..');
const OUTPUT_FILE_NAME = 'ratgenerator.csv';
const DEFAULT_OUTPUT_FILE = path.join(APP_ROOT, 'public', 'assets', OUTPUT_FILE_NAME);
const GENERAL_FACTION = 'General';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
});

class JavaLikeHashSet<T> {
    private table: Array<HashNode<T> | undefined> = new Array(16);
    private sizeValue = 0;
    private threshold = 12;

    public constructor(
        private readonly hashFn: (value: T) => number,
        private readonly equalsFn: (left: T, right: T) => boolean = Object.is,
    ) {}

    public add(value: T): boolean {
        const hash = JavaLikeHashSet.spread(this.hashFn(value));
        const bucketIndex = (this.table.length - 1) & hash;
        const firstNode = this.table[bucketIndex];

        if (!firstNode) {
            this.table[bucketIndex] = { hash, value };
            this.growAfterInsert();
            return true;
        }

        let current = firstNode;
        while (true) {
            if (current.hash === hash && this.equalsFn(current.value, value)) {
                return false;
            }
            if (!current.next) {
                current.next = { hash, value };
                this.growAfterInsert();
                return true;
            }
            current = current.next;
        }
    }

    public values(): T[] {
        const ordered: T[] = [];
        for (const bucket of this.table) {
            let current = bucket;
            while (current) {
                ordered.push(current.value);
                current = current.next;
            }
        }
        return ordered;
    }

    private growAfterInsert(): void {
        this.sizeValue += 1;
        if (this.sizeValue > this.threshold) {
            this.resize();
        }
    }

    private resize(): void {
        const oldTable = this.table;
        const oldCapacity = oldTable.length;
        const newCapacity = oldCapacity * 2;
        const newTable: Array<HashNode<T> | undefined> = new Array(newCapacity);

        for (const bucket of oldTable) {
            if (!bucket) {
                continue;
            }

            if (!bucket.next) {
                newTable[(newCapacity - 1) & bucket.hash] = bucket;
                continue;
            }

            let lowHead: HashNode<T> | undefined;
            let lowTail: HashNode<T> | undefined;
            let highHead: HashNode<T> | undefined;
            let highTail: HashNode<T> | undefined;
            let current: HashNode<T> | undefined = bucket;

            while (current) {
                const next: any = current.next;
                current.next = undefined;
                if ((current.hash & oldCapacity) === 0) {
                    if (!lowHead) {
                        lowHead = current;
                    } else if (lowTail) {
                        lowTail.next = current;
                    }
                    lowTail = current;
                } else {
                    if (!highHead) {
                        highHead = current;
                    } else if (highTail) {
                        highTail.next = current;
                    }
                    highTail = current;
                }
                current = next;
            }

            const lowIndex = JavaLikeHashSet.bucketIndex(lowHead, oldCapacity);
            const highIndex = lowIndex + oldCapacity;
            if (lowHead) {
                newTable[lowIndex] = lowHead;
            }
            if (highHead) {
                newTable[highIndex] = highHead;
            }
        }

        this.table = newTable;
        this.threshold *= 2;
    }

    private static bucketIndex<T>(node: HashNode<T> | undefined, maskBase: number): number {
        if (!node) {
            return 0;
        }
        return (maskBase - 1) & node.hash;
    }

    private static spread(hash: number): number {
        return (hash ^ (hash >>> 16)) | 0;
    }
}

export class RatGeneratorTableBuilder {
    private readonly factions = new Map<string, UniverseFactionRecord>();
    private readonly chassis = new Map<string, ChassisRecordData>();
    private readonly chassisKeys = RatGeneratorTableBuilder.createStringSet();
    private readonly models = new Map<string, ModelRecordData>();
    private readonly eras: number[] = [];
    private readonly unitSummaryByKey = new Map<string, UnitSummaryRecord>();
    private readonly unitSummaryByNormalizedKey = new Map<string, UnitSummaryRecord>();
    private readonly unitSummaryByNormalizedModel = new Map<string, UnitSummaryRecord | null>();
    private readonly unitSummaryByNormalizedChassis = new Map<string, UnitSummaryRecord | null>();
    private readonly unitSummaryCandidatesByNormalizedModel = new Map<string, UnitSummaryRecord[]>();

    public constructor(
        private readonly mmDataRoot: string,
        private readonly unitFilesRoot: string,
        private readonly nameChangesFilePath: string,
    ) {}

    public async load(): Promise<void> {
        this.loadFactions();
        this.loadEras();
        await this.loadUnitSummaries();
        this.loadForceGeneratorData();
    }

    public findChassisAvailabilityRecord(
        era: number,
        chassisKey: string,
        factionKey: string,
        year: number,
    ): AvailabilityRecord | null {
        const eraAvailability = this.chassis.get(chassisKey)?.availabilityByEra.get(era);
        if (!eraAvailability) {
            return null;
        }

        const resolved = this.resolveAvailabilityForFaction(eraAvailability, factionKey);
        if (resolved && year >= resolved.startYear) {
            return resolved;
        }

        return null;
    }

    public findModelAvailabilityRecord(
        era: number,
        modelKey: string,
        factionKey: string,
        year?: number,
    ): AvailabilityRecord | null {
        const eraAvailability = this.models.get(modelKey)?.availabilityByEra.get(era);
        if (!eraAvailability) {
            return null;
        }

        const resolved = this.resolveAvailabilityForFaction(eraAvailability, factionKey);
        if (!resolved) {
            return null;
        }

        if (year === undefined || year >= resolved.startYear) {
            return resolved;
        }

        return null;
    }

    public mergeFactionAvailability(factionKey: string, values: AvailabilityRecord[]): AvailabilityRecord | null {
        if (values.length === 0) {
            return null;
        }

        let totalWeight = 0;
        let totalAdjustment = 0;
        for (const value of values) {
            totalWeight += RatGeneratorTableBuilder.calcAvailabilityWeight(value.availability);
            totalAdjustment += value.ratingAdjustment;
        }

        return {
            faction: factionKey,
            era: values[0].era,
            startYear: values[0].startYear,
            availability: Math.trunc(RatGeneratorTableBuilder.calcAvailabilityFromWeight(totalWeight / values.length)),
            ratingAdjustment: totalAdjustment === 0 ? 0 : totalAdjustment > 0 ? 1 : -1,
            byRating: [],
        };
    }

    public buildCsv(): string {
        const header = [
            'Chassis',
            'Model',
            'Model/Chassis Data',
            'MUL ID',
            'Unit Type',
            'Intro Date',
            'Faction ID',
            'Faction',
            ...this.eras.map(String),
        ].join(';');

        const lines = [header];

        for (const chassisKey of this.chassisKeys.values()) {
            const chassisRecord = this.chassis.get(chassisKey);
            if (!chassisRecord) {
                continue;
            }

            for (const faction of chassisRecord.includedFactions.values()) {
                lines.push(this.buildChassisCsvLine(chassisRecord, faction));
            }

            for (const modelKey of chassisRecord.modelKeys.values()) {
                const modelRecord = this.models.get(modelKey);
                if (!modelRecord) {
                    continue;
                }

                for (const faction of modelRecord.includedFactions.values()) {
                    lines.push(this.buildModelCsvLine(modelRecord, faction));
                }
            }
        }

        return `${lines.join('\n')}\n`;
    }

    private buildChassisCsvLine(record: ChassisRecordData, faction: string): string {
        const columns: string[] = [
            RatGeneratorTableBuilder.csvFormulaString(record.chassis),
            '',
            'Chassis Data',
            '',
            record.unitType,
            '',
            'TBD',
            faction,
        ];

        return this.appendEraColumns(columns, record.availabilityByEra, faction);
    }

    private buildModelCsvLine(record: ModelRecordData, faction: string): string {
        const columns: string[] = [
            RatGeneratorTableBuilder.csvFormulaString(record.chassis),
            RatGeneratorTableBuilder.csvFormulaString(record.model),
            'Model Data',
            String(record.mulId),
            record.unitType,
            String(record.introYear),
            'TBD',
            faction,
        ];

        return this.appendEraColumns(columns, record.availabilityByEra, faction);
    }

    private appendEraColumns(
        columns: string[],
        availabilityByEra: Map<number, Map<string, AvailabilityRecord>>,
        faction: string,
    ): string {
        for (const era of this.eras) {
            const availability = availabilityByEra.get(era)?.get(faction);
            if (availability) {
                const availabilityCode = availability.startYear === availability.era
                    ? this.getAvailabilityCode(availability)
                    : `${this.getAvailabilityCode(availability)}:${availability.startYear}`;
                columns.push(RatGeneratorTableBuilder.csvFormulaString(availabilityCode));
            } else {
                columns.push(RatGeneratorTableBuilder.csvFormulaString(''));
            }
        }

        return `${columns.join(';')};`;
    }

    private getAvailabilityCode(record: AvailabilityRecord): string {
        if (record.byRating.length === 0) {
            if (record.ratingAdjustment === 0) {
                return String(record.availability);
            }
            return `${record.availability}${record.ratingAdjustment < 0 ? '-' : '+'}`;
        }

        return record.byRating
            .map((ratingEntry) => `!${ratingEntry.rating}:${ratingEntry.value}`)
            .join('');
    }

    private resolveAvailabilityForFaction(
        eraAvailability: Map<string, AvailabilityRecord>,
        factionKey: string,
        visited = new Set<string>(),
    ): AvailabilityRecord | null {
        const direct = eraAvailability.get(factionKey);
        if (direct) {
            return direct;
        }

        if (visited.has(factionKey)) {
            return null;
        }
        visited.add(factionKey);

        if (factionKey === GENERAL_FACTION) {
            return eraAvailability.get(GENERAL_FACTION) ?? null;
        }

        const faction = this.factions.get(factionKey);
        if (!faction) {
            return eraAvailability.get(GENERAL_FACTION) ?? null;
        }

        if (faction.fallBackFactions.length === 1) {
            return this.resolveAvailabilityForFaction(eraAvailability, faction.fallBackFactions[0], new Set(visited));
        }

        if (faction.fallBackFactions.length > 1) {
            const merged = faction.fallBackFactions
                .map((parentKey) => this.resolveAvailabilityForFaction(eraAvailability, parentKey, new Set(visited)))
                .filter((value): value is AvailabilityRecord => value !== null);
            return this.mergeFactionAvailability(factionKey, merged);
        }

        return eraAvailability.get(GENERAL_FACTION) ?? null;
    }

    private loadFactions(): void {
        const universeRoot = path.join(this.mmDataRoot, 'data', 'universe');
        this.loadFactionDirectory(path.join(universeRoot, 'factions'));
        this.loadFactionDirectory(path.join(universeRoot, 'commands'));
    }

    private loadFactionDirectory(dirPath: string): void {
        for (const fileName of RatGeneratorTableBuilder.listFiles(dirPath, '.yml')) {
            const raw = RatGeneratorTableBuilder.readYamlFile(path.join(dirPath, fileName)) as Record<string, unknown>;
            const id = String(raw.key || '');
            if (!id) {
                continue;
            }

            this.factions.set(id, {
                id,
                name: String(raw.name || id),
                ratingLevels: RatGeneratorTableBuilder.normalizeTextList(raw.ratingLevels),
                fallBackFactions: RatGeneratorTableBuilder.normalizeTextList(raw.fallBackFactions),
                yearsActive: RatGeneratorTableBuilder.parseYearsActive(raw.yearsActive),
            });
        }
    }

    private loadEras(): void {
        const erasPath = path.join(this.mmDataRoot, 'data', 'universe', 'eras.xml');
        const parsed = xmlParser.parse(fs.readFileSync(erasPath, 'utf8')) as { eras?: { era?: Array<Record<string, unknown>> | Record<string, unknown> } };
        const rawEras = RatGeneratorTableBuilder.ensureArray(parsed.eras?.era).map((era) => ({
            code: String(era.code),
            name: String(era.name),
            endYear: RatGeneratorTableBuilder.parseYear(era.end),
            mulId: era.mulid === undefined ? undefined : Number.parseInt(String(era.mulid), 10),
        }));

        let previousEnd: number | undefined;
        for (const era of rawEras) {
            const fullEra: MegaMekEra = {
                ...era,
                startYear: previousEnd === undefined ? undefined : previousEnd + 1,
            };
            previousEnd = era.endYear;
            void fullEra;
        }
    }

    private async loadUnitSummaries(): Promise<void> {
        for (const rootPath of this.getUnitFileRoots()) {
            const unitFilePaths = RatGeneratorTableBuilder.listFilesRecursive(rootPath, ['.blk', '.mtf']);
            for (const filePath of unitFilePaths) {
                const unitSummary = this.readUnitSummaryFromFile(filePath);
                if (unitSummary) {
                    this.indexUnitSummary(unitSummary);
                }
            }
        }

        const aliases = this.loadNameChangeAliases();
        for (const [previousName, replacementName] of aliases) {
            const resolvedName = RatGeneratorTableBuilder.resolveAliasName(replacementName, aliases);
            const unitSummary = this.unitSummaryByKey.get(resolvedName)
                ?? this.unitSummaryByNormalizedKey.get(RatGeneratorTableBuilder.normalizeLookupKey(resolvedName));
            if (!unitSummary || this.unitSummaryByKey.has(previousName)) {
                continue;
            }

            this.unitSummaryByKey.set(previousName, unitSummary);

            const normalizedPreviousName = RatGeneratorTableBuilder.normalizeLookupKey(previousName);
            if (normalizedPreviousName && !this.unitSummaryByNormalizedKey.has(normalizedPreviousName)) {
                this.unitSummaryByNormalizedKey.set(normalizedPreviousName, unitSummary);
            }
        }
    }

    private getUnitFileRoots(): string[] {
        const roots = [this.unitFilesRoot];
        const siblingMbUnitFilesRoot = path.join(path.dirname(this.unitFilesRoot), 'mbunitfiles');
        if (siblingMbUnitFilesRoot !== this.unitFilesRoot && fs.existsSync(siblingMbUnitFilesRoot)) {
            roots.push(siblingMbUnitFilesRoot);
        }
        return roots;
    }

    private readUnitSummaryFromFile(filePath: string): UnitSummaryRecord | undefined {
        const raw = fs.readFileSync(filePath, 'utf8');
        const extension = path.extname(filePath).toLowerCase();
        if (extension === '.blk') {
            return RatGeneratorTableBuilder.parseBlkUnitSummary(raw);
        }
        if (extension === '.mtf') {
            return RatGeneratorTableBuilder.parseMtfUnitSummary(raw);
        }
        return undefined;
    }

    private indexUnitSummary(unitSummary: UnitSummaryRecord): void {
        const key = RatGeneratorTableBuilder.buildModelKey(unitSummary.chassis, unitSummary.model);
        if (this.unitSummaryByKey.has(key)) {
            return;
        }

        this.unitSummaryByKey.set(key, unitSummary);

        const normalizedKey = RatGeneratorTableBuilder.normalizeLookupKey(key);
        if (!this.unitSummaryByNormalizedKey.has(normalizedKey)) {
            this.unitSummaryByNormalizedKey.set(normalizedKey, unitSummary);
        }

        RatGeneratorTableBuilder.addUniqueLookup(
            this.unitSummaryByNormalizedModel,
            RatGeneratorTableBuilder.normalizeLookupKey(unitSummary.model),
            unitSummary,
        );
        RatGeneratorTableBuilder.addUniqueLookup(
            this.unitSummaryByNormalizedChassis,
            RatGeneratorTableBuilder.normalizeLookupKey(unitSummary.chassis),
            unitSummary,
        );

        const normalizedModel = RatGeneratorTableBuilder.normalizeLookupKey(unitSummary.model);
        if (normalizedModel) {
            const candidates = this.unitSummaryCandidatesByNormalizedModel.get(normalizedModel) ?? [];
            candidates.push(unitSummary);
            this.unitSummaryCandidatesByNormalizedModel.set(normalizedModel, candidates);
        }
    }

    private loadNameChangeAliases(): Map<string, string> {
        const aliasMap = new Map<string, string>();
        const raw = fs.readFileSync(this.nameChangesFilePath, 'utf8');

        for (const line of raw.split(/\r?\n/u)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const separatorIndex = trimmed.indexOf('|');
            if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
                continue;
            }

            const previousName = trimmed.slice(0, separatorIndex).trim();
            const replacementName = trimmed.slice(separatorIndex + 1).trim();
            if (previousName && replacementName) {
                aliasMap.set(previousName, replacementName);
            }
        }

        return aliasMap;
    }

    private findUnitSummary(chassis: string, model: string): UnitSummaryRecord | undefined {
        const modelKey = RatGeneratorTableBuilder.buildModelKey(chassis, model);
        return this.unitSummaryByKey.get(modelKey)
            ?? this.unitSummaryByNormalizedKey.get(RatGeneratorTableBuilder.normalizeLookupKey(modelKey))
            ?? this.findClosestUnitSummaryByModelAndChassis(chassis, model)
            ?? (model ? this.unitSummaryByNormalizedModel.get(RatGeneratorTableBuilder.normalizeLookupKey(model)) ?? undefined : undefined)
            ?? this.unitSummaryByNormalizedChassis.get(RatGeneratorTableBuilder.normalizeLookupKey(chassis)) ?? undefined;
    }

    private findClosestUnitSummaryByModelAndChassis(chassis: string, model: string): UnitSummaryRecord | undefined {
        const normalizedModel = RatGeneratorTableBuilder.normalizeLookupKey(model);
        if (!normalizedModel) {
            return undefined;
        }

        const candidates = this.unitSummaryCandidatesByNormalizedModel.get(normalizedModel);
        if (!candidates || candidates.length === 0) {
            return undefined;
        }
        if (candidates.length === 1) {
            return candidates[0];
        }

        const requestedTokens = RatGeneratorTableBuilder.tokenizeLookupKey(chassis);
        let bestCandidate: UnitSummaryRecord | undefined;
        let bestScore = Number.NEGATIVE_INFINITY;
        let bestScoreCount = 0;

        for (const candidate of candidates) {
            const candidateTokens = RatGeneratorTableBuilder.tokenizeLookupKey(candidate.chassis);
            const score = RatGeneratorTableBuilder.scoreLookupTokens(requestedTokens, candidateTokens);
            if (score > bestScore) {
                bestCandidate = candidate;
                bestScore = score;
                bestScoreCount = 1;
            } else if (score === bestScore) {
                bestScoreCount += 1;
            }
        }

        if (bestCandidate && bestScore > 0 && bestScoreCount === 1) {
            return bestCandidate;
        }

        return undefined;
    }

    private loadForceGeneratorData(): void {
        const forceGeneratorRoot = path.join(this.mmDataRoot, 'data', 'forcegenerator');
        const yearFiles = RatGeneratorTableBuilder.listFiles(forceGeneratorRoot, '.xml')
            .map((fileName) => fileName.replace(/\.xml$/i, ''))
            .filter((value) => /^\d+$/.test(value))
            .map((value) => Number.parseInt(value, 10))
            .sort((left, right) => left - right);

        this.eras.splice(0, this.eras.length, ...yearFiles);

        for (const year of yearFiles) {
            const filePath = path.join(forceGeneratorRoot, `${year}.xml`);
            const parsed = xmlParser.parse(fs.readFileSync(filePath, 'utf8')) as {
                ratgen?: {
                    units?: {
                        chassis?: Array<Record<string, unknown>> | Record<string, unknown>;
                    };
                };
            };

            for (const chassisNode of RatGeneratorTableBuilder.ensureArray(parsed.ratgen?.units?.chassis)) {
                this.parseChassisNode(year, chassisNode);
            }
        }
    }

    private parseChassisNode(era: number, chassisNode: Record<string, unknown>): void {
        const chassisName = String(chassisNode.name || '');
        const unitType = String(chassisNode.unitType || '');
        if (!chassisName || !unitType) {
            return;
        }

        const omniType = this.parseOmniType(chassisNode.omni);
        const chassisKey = RatGeneratorTableBuilder.buildChassisKey(chassisName, unitType, omniType);
        const chassisRecord = this.chassis.get(chassisKey) || {
            key: chassisKey,
            sortKey: chassisKey,
            chassis: chassisName,
            unitType,
            omniType,
            includedFactions: RatGeneratorTableBuilder.createStringSet(),
            modelKeys: RatGeneratorTableBuilder.createStringSet(),
            availabilityByEra: new Map<number, Map<string, AvailabilityRecord>>(),
        };
        this.chassisKeys.add(chassisKey);
        this.chassis.set(chassisKey, chassisRecord);

        this.addAvailabilityCodes(
            chassisRecord.availabilityByEra,
            chassisRecord.includedFactions,
            chassisKey,
            era,
            RatGeneratorTableBuilder.getNodeText(chassisNode.availability),
        );

        for (const rawModelNode of RatGeneratorTableBuilder.ensureArray(chassisNode.model)) {
            if (!rawModelNode || typeof rawModelNode !== 'object') {
                continue;
            }
            this.parseModelNode(era, chassisRecord, rawModelNode as Record<string, unknown>);
        }
    }

    private parseModelNode(era: number, chassisRecord: ChassisRecordData, modelNode: Record<string, unknown>): void {
        const modelName = String(modelNode.name || '');
        const modelKey = RatGeneratorTableBuilder.buildModelKey(chassisRecord.chassis, modelName);
        const unitSummary = this.findUnitSummary(chassisRecord.chassis, modelName);
        if (!unitSummary) {
            console.warn(`[ratgenerator] missing unit summary for ${modelKey}`);
            return;
        }

        const modelRecord = this.models.get(modelKey) || {
            key: modelKey,
            chassisKey: chassisRecord.key,
            chassis: chassisRecord.chassis,
            model: modelName,
            unitType: chassisRecord.unitType,
            omniType: chassisRecord.omniType,
            includedFactions: RatGeneratorTableBuilder.createStringSet(),
            availabilityByEra: new Map<number, Map<string, AvailabilityRecord>>(),
            mulId: unitSummary.id,
            introYear: unitSummary.year,
        };
        this.models.set(modelKey, modelRecord);
        chassisRecord.modelKeys.add(modelKey);

        this.addAvailabilityCodes(
            modelRecord.availabilityByEra,
            modelRecord.includedFactions,
            modelKey,
            era,
            RatGeneratorTableBuilder.getNodeText(modelNode.availability),
        );
    }

    private addAvailabilityCodes(
        target: Map<number, Map<string, AvailabilityRecord>>,
        includedFactions: JavaLikeHashSet<string>,
        unitKey: string,
        era: number,
        rawAvailability: string | undefined,
    ): void {
        if (!rawAvailability) {
            return;
        }

        let eraMap = target.get(era);
        if (!eraMap) {
            eraMap = new Map<string, AvailabilityRecord>();
            target.set(era, eraMap);
        }

        for (const code of rawAvailability.split(',').map((entry) => entry.trim()).filter(Boolean)) {
            const availability = RatGeneratorTableBuilder.parseAvailability(unitKey, era, code);
            if (availability.faction !== GENERAL_FACTION && !this.factions.has(availability.faction)) {
                console.warn(`[ratgenerator] invalid faction ${availability.faction} in ${unitKey} (${era})`);
                continue;
            }

            includedFactions.add(availability.faction);
            eraMap.set(availability.faction, availability);
        }
    }

    private parseOmniType(raw: unknown): 'IS' | 'Clan' | undefined {
        if (raw === undefined || raw === null) {
            return undefined;
        }

        return String(raw).toUpperCase() === 'IS' ? 'IS' : 'Clan';
    }

    private static calcAvailabilityWeight(value: number): number {
        return Math.pow(2, value / 2);
    }

    private static calcAvailabilityFromWeight(weight: number): number {
        if (weight <= 0) {
            return 0;
        }
        return 2 * Math.log2(weight);
    }

    private static parseAvailability(unitKey: string, era: number, code: string): AvailabilityRecord {
        if (code.includes('!')) {
            const [faction, ...ratingParts] = code.split('!');
            const byRating: ParsedAvailabilityRating[] = [];
            let highestAvailability = 0;

            for (const ratingPart of ratingParts) {
                const separatorIndex = ratingPart.indexOf(':');
                if (separatorIndex <= 0) {
                    throw new Error(`Unsupported availability code for ${unitKey} in ${era}: ${code}`);
                }
                const rating = ratingPart.slice(0, separatorIndex);
                const value = Number.parseInt(ratingPart.slice(separatorIndex + 1), 10);
                highestAvailability = Math.max(highestAvailability, value);
                byRating.push({ rating, value });
            }

            return {
                faction,
                era,
                startYear: era,
                availability: highestAvailability,
                ratingAdjustment: 0,
                byRating,
            };
        }

        const parts = code.split(':');
        if (parts.length < 2 || parts.length > 3) {
            throw new Error(`Unsupported availability code for ${unitKey} in ${era}: ${code}`);
        }

        let ratingAdjustment: -1 | 0 | 1 = 0;
        let availabilityValue = parts[1];
        if (availabilityValue.endsWith('+')) {
            ratingAdjustment = 1;
            availabilityValue = availabilityValue.slice(0, -1);
        } else if (availabilityValue.endsWith('-')) {
            ratingAdjustment = -1;
            availabilityValue = availabilityValue.slice(0, -1);
        }

        return {
            faction: parts[0],
            era,
            startYear: parts[2] ? Number.parseInt(parts[2], 10) : era,
            availability: Number.parseInt(availabilityValue, 10),
            ratingAdjustment,
            byRating: [],
        };
    }

    private static csvFormulaString(value: string): string {
        const excelFormula = `="${value}"`;
        const csvEscaped = excelFormula.replace(/"/g, '""');
        return `"${csvEscaped}"`;
    }

    private static buildChassisKey(chassis: string, unitType: string, omniType?: 'IS' | 'Clan'): string {
        const base = `${chassis}[${unitType}]`;
        if (!omniType) {
            return base;
        }
        return `${base}${omniType === 'IS' ? 'ISOmni' : 'ClanOmni'}`;
    }

    private static buildModelKey(chassis: string, model: string): string {
        return `${chassis} ${model}`.trim();
    }

    private static normalizeLookupKey(value: string): string {
        return value
            .normalize('NFKD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/['’`"\[\]\(\)\-]/g, ' ')
            .replace(/\bclass\b/gi, ' ')
            .trim()
            .replace(/\s+/g, ' ')
            .toLowerCase();
    }

    private static tokenizeLookupKey(value: string): string[] {
        return RatGeneratorTableBuilder.normalizeLookupKey(value)
            .split(' ')
            .filter(Boolean);
    }

    private static scoreLookupTokens(requestedTokens: string[], candidateTokens: string[]): number {
        if (requestedTokens.length === 0 || candidateTokens.length === 0) {
            return 0;
        }

        const candidateTokenSet = new Set(candidateTokens);
        let shared = 0;
        for (const token of requestedTokens) {
            if (candidateTokenSet.has(token)) {
                shared += 1;
            }
        }

        let prefixMatches = 0;
        const prefixLimit = Math.min(requestedTokens.length, candidateTokens.length);
        for (let index = 0; index < prefixLimit; index += 1) {
            if (requestedTokens[index] !== candidateTokens[index]) {
                break;
            }
            prefixMatches += 1;
        }

        return (prefixMatches * 100) + (shared * 10) - Math.abs(requestedTokens.length - candidateTokens.length);
    }

    private static addUniqueLookup(
        index: Map<string, UnitSummaryRecord | null>,
        key: string,
        unitSummary: UnitSummaryRecord,
    ): void {
        if (!key) {
            return;
        }

        if (!index.has(key)) {
            index.set(key, unitSummary);
            return;
        }

        const existing = index.get(key);
        if (existing && existing.id !== unitSummary.id) {
            index.set(key, null);
        }
    }

    private static createStringSet(): JavaLikeHashSet<string> {
        return new JavaLikeHashSet<string>(RatGeneratorTableBuilder.javaStringHashCode);
    }

    private static javaStringHashCode(value: string): number {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = ((31 * hash) + value.charCodeAt(index)) | 0;
        }
        return hash;
    }

    private static ensureArray<T>(value: T | T[] | undefined | null): T[] {
        if (value === undefined || value === null) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }

    private static listFiles(dirPath: string, extension: string): string[] {
        return fs.readdirSync(dirPath)
            .filter((name) => name.toLowerCase().endsWith(extension.toLowerCase()))
            .sort((left, right) => left.localeCompare(right));
    }

    private static listFilesRecursive(dirPath: string, extensions: string[]): string[] {
        const normalizedExtensions = extensions.map((extension) => extension.toLowerCase());
        const files: string[] = [];

        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                files.push(...RatGeneratorTableBuilder.listFilesRecursive(fullPath, normalizedExtensions));
                continue;
            }

            if (normalizedExtensions.includes(path.extname(entry.name).toLowerCase())) {
                files.push(fullPath);
            }
        }

        return files;
    }

    private static readYamlFile(filePath: string): Record<string, unknown> {
        const parsed = loadYaml(fs.readFileSync(filePath, 'utf8'));
        if (!parsed || typeof parsed !== 'object') {
            throw new Error(`Invalid YAML data in ${filePath}`);
        }
        return parsed as Record<string, unknown>;
    }

    private static parseYearsActive(rawRanges: unknown): DateRange[] {
        return RatGeneratorTableBuilder.ensureArray(rawRanges)
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
            .map((range) => ({
                start: RatGeneratorTableBuilder.parseYear(range.start),
                end: RatGeneratorTableBuilder.parseYear(range.end),
            }));
    }

    private static normalizeTextList(value: unknown): string[] {
        return RatGeneratorTableBuilder.ensureArray(value)
            .flatMap((entry) => {
                if (typeof entry === 'string') {
                    return entry.split(',');
                }
                if (entry && typeof entry === 'object' && '#text' in entry) {
                    const text = (entry as Record<string, unknown>)['#text'];
                    if (typeof text === 'string') {
                        return text.split(',');
                    }
                }
                return [];
            })
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    private static parseYear(value: unknown): number | undefined {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }

        const match = String(value).trim().match(/^(\d{4})/);
        return match ? Number.parseInt(match[1], 10) : undefined;
    }

    private static getNodeText(node: unknown): string | undefined {
        if (typeof node === 'string') {
            return node.trim();
        }
        if (node && typeof node === 'object' && '#text' in (node as Record<string, unknown>)) {
            const value = (node as Record<string, unknown>)['#text'];
            return typeof value === 'string' ? value.trim() : undefined;
        }
        return undefined;
    }

    private static parseBlkUnitSummary(raw: string): UnitSummaryRecord | undefined {
        const chassis = RatGeneratorTableBuilder.getTaggedText(raw, 'Name') ?? '';
        const model = RatGeneratorTableBuilder.getTaggedText(raw, 'Model') ?? '';
        const parsedId = Number.parseInt(RatGeneratorTableBuilder.getTaggedText(raw, 'mul id:') ?? '', 10);
        const id = Number.isFinite(parsedId) ? parsedId : -1;
        const year = RatGeneratorTableBuilder.parseYear(RatGeneratorTableBuilder.getTaggedText(raw, 'year'));
        if (!chassis || year === undefined) {
            return undefined;
        }

        return {
            id,
            chassis,
            model,
            year,
        };
    }

    private static parseMtfUnitSummary(raw: string): UnitSummaryRecord | undefined {
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

        const baseChassis = fields.get('chassis') ?? '';
        const clanName = fields.get('clanname') ?? '';
        const chassis = baseChassis && clanName && !baseChassis.includes('(')
            ? `${baseChassis} (${clanName})`
            : baseChassis;
        const model = fields.get('model') ?? '';
        const parsedId = Number.parseInt(fields.get('mul id') ?? '', 10);
        const id = Number.isFinite(parsedId) ? parsedId : -1;
        const year = RatGeneratorTableBuilder.parseYear(fields.get('era'));
        if (!chassis || year === undefined) {
            return undefined;
        }

        return {
            id,
            chassis,
            model,
            year,
        };
    }

    private static getTaggedText(raw: string, tagName: string): string | undefined {
        const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const match = raw.match(new RegExp(`<${escapedTagName}>([\\s\\S]*?)</${escapedTagName}>`, 'i'));
        return match?.[1]?.trim();
    }

    private static resolveAliasName(name: string, aliases: Map<string, string>): string {
        let currentName = name;
        const visited = new Set<string>();

        while (!visited.has(currentName)) {
            visited.add(currentName);
            const nextName = aliases.get(currentName);
            if (!nextName) {
                break;
            }
            currentName = nextName;
        }

        return currentName;
    }
}

function resolveExistingPath(label: string, candidates: string[]): string {
    for (const candidate of candidates) {
        const resolved = path.resolve(APP_ROOT, candidate);
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }
    throw new Error(`Could not resolve ${label}. Tried: ${candidates.join(', ')}`);
}

function resolveMmDataRoot(override?: string): string {
    if (override) {
        return path.resolve(APP_ROOT, override);
    }

    return resolveExistingPath('MM data root', [
        process.env.MM_DATA_PATH || '',
        '../mm-data',
        '../../mm-data',
    ].filter(Boolean));
}

function resolveUnitFilesRoot(override?: string): string {
    if (override) {
        return path.resolve(APP_ROOT, override);
    }

    return resolveExistingPath('unit files root', [
        process.env.SVGEXPORT_UNITFILES_PATH || '',
        '../svgexport/unitfiles',
        '../../svgexport/unitfiles',
    ].filter(Boolean));
}

function resolveNameChangesFilePath(override?: string): string {
    if (override) {
        return path.resolve(APP_ROOT, override);
    }

    return resolveExistingPath('name changes file', [
        process.env.MEK_NAME_CHANGES_PATH || '',
        '../mm-data/data/mekfiles/name_changes.txt',
        '../../mm-data/data/mekfiles/name_changes.txt',
    ].filter(Boolean));
}

export async function buildRatGeneratorCsv(options: BuildOptions = {}): Promise<BuildResult> {
    const mmDataRoot = resolveMmDataRoot(options.mmDataRoot);
    const unitFilesRoot = resolveUnitFilesRoot(options.unitFilesRoot);
    const nameChangesFilePath = resolveNameChangesFilePath(options.nameChangesFilePath);
    const outputFilePath = options.outputFilePath
        ? path.resolve(APP_ROOT, options.outputFilePath)
        : DEFAULT_OUTPUT_FILE;

    const builder = new RatGeneratorTableBuilder(mmDataRoot, unitFilesRoot, nameChangesFilePath);
    await builder.load();
    const csv = builder.buildCsv();

    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
    fs.writeFileSync(outputFilePath, csv, 'utf8');

    return {
        csv,
        outputFilePath,
    };
}

async function run(): Promise<void> {
    const result = await buildRatGeneratorCsv();
    console.log(`[ratgenerator] wrote ${result.outputFilePath}`);
}

if (typeof require !== 'undefined' && require.main === module) {
    run().catch((error: unknown) => {
        console.error('[ratgenerator] failed to build CSV', error);
        process.exitCode = 1;
    });
}