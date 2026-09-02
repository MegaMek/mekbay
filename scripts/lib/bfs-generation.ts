import fs from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import {
    convertEmplacementRow,
    convertLinkedRow,
    readAerospaceCsv,
    readEmplacementCsv,
    readGroundCsv,
    type AerospaceCsvRow,
    type BfsDocument,
    type BfsManifestEntry,
    type EmplacementManifestEntry,
    type LinkedManifestEntry,
} from './bfs-converter';
import { parseRenderedBfs, renderBfsYaml } from './bfs-yaml';
import { isCanonicalUuid, readMegaMekUnitFileMetadata, type MegaMekUnitFileMetadata } from './megamek-unit-file-metadata';
import { listUnitFilesRecursive, normalizeRelativePath } from './unit-file-discovery';

export interface BfsManifest {
    version: 1;
    expected: { ground: number; emplacements: number; aerospaceBlocked: number };
    entries: BfsManifestEntry[];
}

export interface BfsGenerationOptions {
    csvRoot: string;
    unitFilesRoot: string;
    manifestPath: string;
    reportPath: string;
}

export interface PlannedBfsFile {
    relativePath: string;
    absolutePath: string;
    content: string;
    document: BfsDocument;
    entry: BfsManifestEntry;
    linkedMetadata?: MegaMekUnitFileMetadata;
}

export interface BfsGenerationPlan {
    files: PlannedBfsFile[];
    aerospace: AerospaceCsvRow[];
    reportContent: string;
    reportPath: string;
    changedPaths: string[];
    unchangedPaths: string[];
}

const MANIFEST_ROOT_KEYS = new Set(['version', 'expected', 'entries']);
const COMMON_ENTRY_KEYS = new Set(['dataset', 'csvName', 'uuid', 'cardTitle', 'cardSubtitle', 'provenance']);
const LINKED_ENTRY_KEYS = new Set([...COMMON_ENTRY_KEYS, 'unitFile', 'outputFile', 'linkedUnitId']);
const EMPLACEMENT_ENTRY_KEYS = new Set([...COMMON_ENTRY_KEYS, 'outputFile', 'chassis', 'model']);

function requireRecord(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }
    return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) {
            throw new Error(`${label} has unknown field '${key}'.`);
        }
    }
}

function requireString(record: Record<string, unknown>, key: string, label: string, allowBlank = false): string {
    const value = record[key];
    if (typeof value !== 'string' || (!allowBlank && value.trim().length === 0)) {
        throw new Error(`${label}.${key} must be ${allowBlank ? 'a string' : 'a nonblank string'}.`);
    }
    return value;
}

function optionalString(record: Record<string, unknown>, key: string, label: string): string | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${label}.${key} must be a nonblank string when present.`);
    }
    return value;
}

function parseManifestEntry(value: unknown, index: number): BfsManifestEntry {
    const label = `manifest.entries[${index}]`;
    const record = requireRecord(value, label);
    const dataset = requireString(record, 'dataset', label);
    requireExactKeys(record, dataset === 'ground' ? LINKED_ENTRY_KEYS : EMPLACEMENT_ENTRY_KEYS, label);
    const common = {
        csvName: requireString(record, 'csvName', label),
        uuid: requireString(record, 'uuid', label),
        cardTitle: optionalString(record, 'cardTitle', label),
        cardSubtitle: optionalString(record, 'cardSubtitle', label),
        provenance: requireString(record, 'provenance', label),
    };
    if (!isCanonicalUuid(common.uuid)) {
        throw new Error(`${label}.uuid is not a canonical RFC UUID.`);
    }
    if (common.provenance !== 'existing' && common.provenance !== 'new') {
        throw new Error(`${label}.provenance must be existing or new.`);
    }
    if (dataset === 'ground') {
        const linkedUnitId = requireString(record, 'linkedUnitId', label);
        if (!isCanonicalUuid(linkedUnitId)) {
            throw new Error(`${label}.linkedUnitId is not a canonical RFC UUID.`);
        }
        return {
            dataset,
            ...common,
            provenance: common.provenance,
            unitFile: requireString(record, 'unitFile', label),
            outputFile: optionalString(record, 'outputFile', label),
            linkedUnitId,
        } as LinkedManifestEntry;
    }
    if (dataset === 'emplacement') {
        return {
            dataset,
            ...common,
            provenance: common.provenance,
            outputFile: requireString(record, 'outputFile', label),
            chassis: requireString(record, 'chassis', label),
            model: requireString(record, 'model', label, true),
        } as EmplacementManifestEntry;
    }
    throw new Error(`${label}.dataset must be ground or emplacement.`);
}

export function readBfsManifest(manifestPath: string): BfsManifest {
    const root = requireRecord(load(fs.readFileSync(manifestPath, 'utf8')), 'manifest');
    requireExactKeys(root, MANIFEST_ROOT_KEYS, 'manifest');
    if (root['version'] !== 1) {
        throw new Error('manifest.version must be 1.');
    }
    const expected = requireRecord(root['expected'], 'manifest.expected');
    requireExactKeys(expected, new Set(['ground', 'emplacements', 'aerospaceBlocked']), 'manifest.expected');
    for (const field of ['ground', 'emplacements', 'aerospaceBlocked']) {
        if (!Number.isInteger(expected[field]) || (expected[field] as number) < 0) {
            throw new Error(`manifest.expected.${field} must be a nonnegative integer.`);
        }
    }
    if (!Array.isArray(root['entries'])) {
        throw new Error('manifest.entries must be an array.');
    }
    return {
        version: 1,
        expected: expected as unknown as BfsManifest['expected'],
        entries: root['entries'].map(parseManifestEntry),
    };
}

function resolveContained(rootPath: string, relativePath: string, label: string): string {
    if (path.isAbsolute(relativePath)) {
        throw new Error(`${label} must be relative.`);
    }
    const segments = relativePath.replace(/\\/gu, '/').split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(`${label} must not contain empty, current-directory, or parent-directory segments.`);
    }
    const root = path.resolve(rootPath);
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`${label} escapes ${root}.`);
    }

    const realRoot = fs.realpathSync(root);
    let existingAncestor = resolved;
    while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) {
            throw new Error(`${label} has no existing ancestor beneath ${root}.`);
        }
        existingAncestor = parent;
    }
    const realAncestor = fs.realpathSync(existingAncestor);
    const realResolved = path.resolve(realAncestor, path.relative(existingAncestor, resolved));
    const realRelative = path.relative(realRoot, realResolved);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new Error(`${label} escapes ${realRoot} through a symbolic link.`);
    }
    return realResolved;
}

function key(dataset: string, csvName: string): string {
    return `${dataset}\u0000${csvName}`;
}

function ensureUnique<T>(items: readonly T[], getValue: (item: T) => string, label: string): void {
    const seen = new Map<string, T>();
    for (const item of items) {
        const value = getValue(item).toLowerCase();
        if (seen.has(value)) {
            throw new Error(`Duplicate ${label}: ${getValue(item)}.`);
        }
        seen.set(value, item);
    }
}

function linkedOutputPath(entry: LinkedManifestEntry): string {
    return entry.outputFile ?? entry.unitFile.replace(/\.(?:mtf|blk)$/iu, '.bfs');
}

function readExistingBfsUuid(filePath: string): string | undefined {
    try {
        const value = load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown> | undefined;
        return typeof value?.['uuid'] === 'string' ? value['uuid'] : undefined;
    } catch (error) {
        throw new Error(`Cannot inspect existing BFS file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function listBfsFiles(rootPath: string): string[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bfs')) {
                files.push(entryPath);
            }
        }
    };
    visit(rootPath);
    return files;
}

function markdown(value: string | undefined): string {
    return (value ?? '—')
        .replace(/\\/gu, '\\\\')
        .replace(/([\[\]()])/gu, '\\$1')
        .replace(/\|/gu, '\\|')
        .replace(/[\r\n]+/gu, ' ');
}

function displayUnitName(metadata: MegaMekUnitFileMetadata): string {
    return `${metadata.chassis}${metadata.model ? ` ${metadata.model}` : ''}`;
}

export function renderBfsGenerationReport(files: readonly PlannedBfsFile[], aerospace: readonly AerospaceCsvRow[]): string {
    const existing = files.filter((file) => file.entry.provenance === 'existing').length;
    const linked = files.filter((file) => file.entry.dataset === 'ground').length;
    const lines = [
        '# Battlefield Support generation report',
        '',
        'This report is generated deterministically from the reviewed CSV inputs and conversion manifest.',
        '',
        '## Summary',
        '',
        `- Supported definitions: **${files.length}** (${files.length - existing} new, ${existing} existing)`,
        `- Linked MTF/BLK definitions: **${linked}**`,
        `- Standalone emplacements: **${files.length - linked}**`,
        `- Aerospace rows blocked: **${aerospace.length}**`,
        '',
        '## Generated definitions',
        '',
        '| BFS name | MTF/BLK name | Status | BFS path | Asset UUID | Linked source | Linked UUID |',
        '|---|---|---|---|---|---|---|',
    ];
    for (const file of files) {
        const metadata = file.linkedMetadata;
        lines.push(`| ${markdown(file.entry.csvName)} | ${markdown(metadata ? displayUnitName(metadata) : undefined)} | ${file.entry.provenance} | ${markdown(file.relativePath)} | ${file.document.uuid} | ${markdown(file.entry.dataset === 'ground' ? file.entry.unitFile : undefined)} | ${markdown(file.document.linkedUnitId)} |`);
    }
    lines.push(
        '',
        '## Aerospace schema blockers',
        '',
        'No aerospace files were emitted. The current `BFSAssetType` has no aerospace category, and the YAML schema cannot represent Size, Fuel, categorical Range, or authoritative aerospace TMM/movement semantics.',
        '',
        '| CSV unit | Type | Size | Range | Fuel | Source | Result |',
        '|---|---|---:|---|---:|---|---|',
    );
    for (const row of aerospace) {
        lines.push(`| ${markdown(row.name)} | ${markdown(row.type)} | ${row.size} | ${markdown(row.range)} | ${row.fuel} | ${markdown(row.source)} | Blocked: unsupported schema |`);
    }
    return `${lines.join('\n')}\n`;
}

export function buildBfsGenerationPlan(options: BfsGenerationOptions): BfsGenerationPlan {
    const manifest = readBfsManifest(options.manifestPath);
    const groundRows = readGroundCsv(path.join(options.csvRoot, 'Battlefield Support Assets - BSAs.csv'));
    const emplacementRows = readEmplacementCsv(path.join(options.csvRoot, 'Battlefield Support Assets - Emplacements.csv'));
    const aerospace = readAerospaceCsv(path.join(options.csvRoot, 'Battlefield Support Assets - Aerospace.csv'));
    if (groundRows.length !== manifest.expected.ground
        || emplacementRows.length !== manifest.expected.emplacements
        || aerospace.length !== manifest.expected.aerospaceBlocked) {
        throw new Error(`CSV counts changed: ground=${groundRows.length}, emplacements=${emplacementRows.length}, aerospace=${aerospace.length}.`);
    }
    if (manifest.entries.length !== groundRows.length + emplacementRows.length) {
        throw new Error(`Manifest has ${manifest.entries.length} entries; expected ${groundRows.length + emplacementRows.length}.`);
    }

    ensureUnique(manifest.entries, (entry) => key(entry.dataset, entry.csvName), 'manifest CSV key');
    ensureUnique(manifest.entries, (entry) => entry.uuid, 'asset UUID');
    ensureUnique(manifest.entries.filter((entry): entry is LinkedManifestEntry => entry.dataset === 'ground'), (entry) => entry.unitFile, 'linked source file');
    for (const entry of manifest.entries) {
        if (entry.dataset === 'ground' && entry.outputFile) {
            const sourceDirectory = path.posix.dirname(entry.unitFile.replace(/\\/gu, '/')).toLowerCase();
            const outputDirectory = path.posix.dirname(entry.outputFile.replace(/\\/gu, '/')).toLowerCase();
            if (outputDirectory !== sourceDirectory) {
                throw new Error(`${entry.csvName} linked output must be beside its source file.`);
            }
        }
    }

    const manifestByKey = new Map(manifest.entries.map((entry) => [key(entry.dataset, entry.csvName), entry]));
    const planned: PlannedBfsFile[] = [];
    const addPlan = (entry: BfsManifestEntry, document: BfsDocument, relativePath: string, linkedMetadata?: MegaMekUnitFileMetadata): void => {
        const normalizedRelativePath = relativePath.split('\\').join('/');
        if (!normalizedRelativePath.toLowerCase().endsWith('.bfs')) {
            throw new Error(`${entry.csvName} output must use the .bfs extension.`);
        }
        const absolutePath = resolveContained(options.unitFilesRoot, normalizedRelativePath, `${entry.csvName} outputFile`);
        const content = renderBfsYaml(document);
        parseRenderedBfs(content);
        planned.push({ relativePath: normalizedRelativePath, absolutePath, content, document, entry, linkedMetadata });
    };

    for (const row of groundRows) {
        const entry = manifestByKey.get(key('ground', row.name));
        if (!entry || entry.dataset !== 'ground') {
            throw new Error(`Missing ground manifest entry for '${row.name}'.`);
        }
        const unitFilePath = resolveContained(options.unitFilesRoot, entry.unitFile, `${row.name} unitFile`);
        if (!fs.existsSync(unitFilePath)) {
            throw new Error(`${row.name} linked source does not exist: ${entry.unitFile}.`);
        }
        const metadata = readMegaMekUnitFileMetadata(unitFilePath, options.unitFilesRoot);
        if (!metadata) {
            throw new Error(`${row.name} linked source has no parseable chassis: ${entry.unitFile}.`);
        }
        if (metadata.movementMode !== row.movement.mode) {
            throw new Error(`${row.name} CSV movement ${row.movement.mode} conflicts with ${entry.unitFile} movement ${metadata.movementMode ?? 'unknown'}.`);
        }
        addPlan(entry, convertLinkedRow(row, entry, metadata), linkedOutputPath(entry), metadata);
    }
    for (const row of emplacementRows) {
        const entry = manifestByKey.get(key('emplacement', row.name));
        if (!entry || entry.dataset !== 'emplacement') {
            throw new Error(`Missing emplacement manifest entry for '${row.name}'.`);
        }
        if (entry.outputFile.replace(/\\/gu, '/').split('/')[0]?.toLowerCase() !== 'battlefieldsupport') {
            throw new Error(`${row.name} standalone output must be under battlefieldsupport/.`);
        }
        addPlan(entry, convertEmplacementRow(row, entry), entry.outputFile);
    }

    ensureUnique(planned, (file) => file.relativePath, 'output path');
    const plannedPaths = new Set(planned.map((file) => path.resolve(file.absolutePath).toLowerCase()));
    const sourceUuidOwners = new Map<string, string>();
    for (const sourceFile of listUnitFilesRecursive(options.unitFilesRoot)) {
        const metadata = readMegaMekUnitFileMetadata(sourceFile, options.unitFilesRoot);
        if (metadata?.uuid) {
            const uuid = metadata.uuid.toLowerCase();
            const relativeSourcePath = normalizeRelativePath(options.unitFilesRoot, sourceFile);
            const existingOwner = sourceUuidOwners.get(uuid);
            if (sourceUuidOwners.has(uuid)) {
                throw new Error(`MTF/BLK UUID ${metadata.uuid} is duplicated by ${existingOwner} and ${relativeSourcePath}.`);
            }
            sourceUuidOwners.set(uuid, relativeSourcePath);
        }
    }
    for (const file of planned) {
        if (sourceUuidOwners.has(file.document.uuid.toLowerCase())) {
            throw new Error(`${file.entry.csvName} asset UUID collides with an MTF/BLK UUID: ${file.document.uuid}.`);
        }
    }
    const assetUuidOwners = new Map(planned.map((file) => [file.document.uuid.toLowerCase(), file.absolutePath]));
    for (const existingPath of listBfsFiles(options.unitFilesRoot)) {
        const existingUuid = readExistingBfsUuid(existingPath)?.toLowerCase();
        const normalizedPath = path.resolve(existingPath).toLowerCase();
        if (!plannedPaths.has(normalizedPath) && existingUuid && assetUuidOwners.has(existingUuid)) {
            throw new Error(`Asset UUID ${existingUuid} already belongs to unplanned BFS file ${normalizeRelativePath(options.unitFilesRoot, existingPath)}.`);
        }
        if (plannedPaths.has(normalizedPath)) {
            const plannedFile = planned.find((file) => path.resolve(file.absolutePath).toLowerCase() === normalizedPath)!;
            if (existingUuid !== plannedFile.document.uuid.toLowerCase()) {
                throw new Error(`Existing BFS UUID mismatch at ${plannedFile.relativePath}.`);
            }
        }
    }

    const reportContent = renderBfsGenerationReport(planned, aerospace);
    const changedPaths: string[] = [];
    const unchangedPaths: string[] = [];
    for (const output of [...planned.map((file) => ({ path: file.absolutePath, content: file.content })), { path: options.reportPath, content: reportContent }]) {
        if (fs.existsSync(output.path) && fs.readFileSync(output.path, 'utf8') === output.content) {
            unchangedPaths.push(output.path);
        } else {
            changedPaths.push(output.path);
        }
    }
    return { files: planned, aerospace, reportContent, reportPath: options.reportPath, changedPaths, unchangedPaths };
}

function writeAtomic(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
        }
    }
}

export function writeBfsGenerationPlan(plan: BfsGenerationPlan): void {
    for (const file of plan.files) {
        if (!fs.existsSync(file.absolutePath) || fs.readFileSync(file.absolutePath, 'utf8') !== file.content) {
            writeAtomic(file.absolutePath, file.content);
        }
    }
    if (!fs.existsSync(plan.reportPath) || fs.readFileSync(plan.reportPath, 'utf8') !== plan.reportContent) {
        writeAtomic(plan.reportPath, plan.reportContent);
    }
}
