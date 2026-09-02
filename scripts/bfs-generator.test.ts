import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    parseDamage,
    parseMovement,
    parseProfile,
    parseRange,
    parseSpecials,
    readAerospaceCsv,
    readEmplacementCsv,
    readGroundCsv,
    type BfsDocument,
} from './lib/bfs-converter';
import { buildBfsGenerationPlan, readBfsManifest, writeBfsGenerationPlan } from './lib/bfs-generation';
import { BFS_LICENSE_HEADER, parseRenderedBfs, renderBfsYaml, validateBfsDocument } from './lib/bfs-yaml';
import { parseCsv, parseCsvRows, requireCsvColumnCount, requireCsvHeader } from './lib/csv';
import { isCanonicalUuid, parseMegaMekUnitFileMetadata } from './lib/megamek-unit-file-metadata';
import { listUnitFilesRecursive, normalizeRelativePath } from './lib/unit-file-discovery';

const { resolveMmDataRoot } = require('./lib/script-paths') as typeof import('./lib/script-paths');

const appRoot = path.resolve(__dirname, '..');
const mmDataRoot = resolveMmDataRoot(appRoot);
const csvRoot = path.join(mmDataRoot, 'BFS_CSV');
const unitFilesRoot = path.join(mmDataRoot, 'data', 'mekfiles');
const manifestPath = path.join(appRoot, 'scripts', 'bfs', 'bfs-conversion-manifest.yaml');
const reportPath = path.join(csvRoot, 'BFS-generation-report.md');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mekbay-bfs-generator-'));

function fixtureDocument(): BfsDocument {
    return {
        uuid: '019f5efd-5a93-78c3-b4f2-dd83804af175',
        linkedUnitId: '019f583e-e2c6-7b99-a188-ba0759db128e',
        chassis: 'Maxim Heavy Hover Transport',
        model: '',
        assetType: 'Vehicle',
        cardTitle: 'Maxim',
        cardSubtitle: 'Hover Transport',
        year: 2689,
        techBase: 'IS',
        source: 'BattleTech: Mercenaries',
        movement: { mp: 8, mode: 'HOVER' },
        tmm: 3,
        range: [3, 6, 9],
        skill: { standard: 6, veteran: 5 },
        damage: { perHit: 5, hits: 4 },
        destroyCheck: 7,
        threshold: 5,
        cost: { standard: 23, veteran: 27 },
        specials: ['APC1', 'IF2'],
        role: 'STRIKER',
    };
}

try {
    assert.deepEqual(parseCsvRows('\uFEFFName,Value\r\n"Alpha, One","Quote ""Ace"""\r\n'), [
        ['Name', 'Value'], ['Alpha, One', 'Quote "Ace"'],
    ]);
    assert.deepEqual(parseCsv('A,B\n"line 1\nline 2",x\n').map((row) => row.rowNumber), [1, 2]);
    assert.throws(() => parseCsv('"unfinished'), /inside a quoted value/);
    assert.throws(() => parseCsv('bad"quote,x'), /quote inside an unquoted value/);
    assert.throws(() => parseCsv('"closed"tail,x'), /after a closing quote/);
    assert.throws(() => requireCsvHeader(['A'], ['B'], 'input.csv'), /unexpected CSV header/);
    assert.throws(() => requireCsvColumnCount({ cells: ['A'], rowNumber: 4 }, 2, 'input.csv'), /input.csv:4/);

    assert.deepEqual(parseProfile('07(8)', 'cost'), { standard: 7, veteran: 8 });
    assert.deepEqual(parseProfile('66', 'cost'), { standard: 66 });
    assert.deepEqual(parseProfile('-', 'skill', 6), { standard: 6 });
    assert.throws(() => parseProfile('1.5', 'cost'), /must be N or N\(V\)/);
    assert.throws(() => parseProfile('-1', 'cost'), /must be N or N\(V\)/);

    assert.deepEqual(parseMovement('2T', 'MP'), { mp: 2, mode: 'TRACKED' });
    assert.deepEqual(parseMovement('4W', 'MP'), { mp: 4, mode: 'WHEELED' });
    assert.deepEqual(parseMovement('8H', 'MP'), { mp: 8, mode: 'HOVER' });
    assert.deepEqual(parseMovement('9V', 'MP'), { mp: 9, mode: 'VTOL' });
    assert.deepEqual(parseMovement('3J', 'MP'), { mp: 3, mode: 'INF_JUMP' });
    assert.deepEqual(parseMovement('1F', 'MP'), { mp: 1, mode: 'INF_LEG' });
    assert.deepEqual(parseMovement('0', 'MP', true), { mp: 0, mode: 'NONE' });
    assert.throws(() => parseMovement('3', 'MP'), /suffix/);
    assert.throws(() => parseMovement('1T', 'MP', true), /must be 0/);

    assert.deepEqual(parseRange('3/6/9', 'Range'), [3, 6, 9]);
    assert.deepEqual(parseRange('Artillery', 'Range'), [-1, -1, -1]);
    assert.deepEqual(parseRange('Arrow', 'Range'), [-1, -1, -1]);
    assert.throws(() => parseRange('9/6/3', 'Range'), /ascending/);
    assert.deepEqual(parseDamage('5', 'Damage'), { perHit: 5, hits: 1 });
    assert.deepEqual(parseDamage('6x2', 'Damage'), { perHit: 6, hits: 2 });
    assert.deepEqual(parseDamage('-', 'Damage'), { perHit: 0, hits: 0 });
    assert.deepEqual(parseDamage('0', 'Damage'), { perHit: 0, hits: 0 });
    assert.throws(() => parseDamage('5x0', 'Damage'), /supported range/);

    assert.deepEqual(parseSpecials('-'), []);
    assert.deepEqual(parseSpecials('Crit-seeker,  IF2, Immobile*, No Turret'), [
        'Crit-Seeker', 'IF2', 'Immobile', 'No Turret',
    ]);
    assert.deepEqual(parseSpecials("Immobile*, +Unlike normal Assets, this remains one prose item."), [
        'Immobile', '+Unlike normal Assets, this remains one prose item.',
    ]);

    const rendered = renderBfsYaml(fixtureDocument());
    assert.ok(rendered.startsWith(BFS_LICENSE_HEADER));
    assert.equal(rendered.endsWith('\n'), true);
    assert.equal(rendered.endsWith('\n\n'), false);
    assert.deepEqual(parseRenderedBfs(rendered), fixtureDocument());
    assert.ok(rendered.indexOf('uuid:') < rendered.indexOf('linkedUnitId:'));
    assert.ok(rendered.indexOf('linkedUnitId:') < rendered.indexOf('chassis:'));
    assert.ok(rendered.indexOf('movement:') < rendered.indexOf('range:'));
    assert.ok(rendered.indexOf('range:') < rendered.indexOf('skill:'));
    assert.ok(rendered.indexOf('damage:') < rendered.indexOf('cost:'));
    assert.throws(() => validateBfsDocument({ ...fixtureDocument(), uuid: 'bad' }), /UUID/);
    assert.throws(() => validateBfsDocument({ ...fixtureDocument(), range: [-1, 2, 3] }), /range/);
    assert.throws(() => validateBfsDocument({
        ...fixtureDocument(), damage: { perHit: 5, hits: 0 },
    }), /both be zero/);
    assert.throws(() => parseRenderedBfs(`${rendered}unknown: 1\n`), /Unknown BFS field/);
    assert.throws(() => parseRenderedBfs(rendered.replace('  mode: "HOVER"', '  mode: "INVALID"')), /movement.mode/);
    assert.throws(() => parseRenderedBfs(rendered.replace('  mode: "HOVER"', '  mode: "HOVER"\n  extra: 1')), /Unknown movement field/);
    assert.throws(() => parseRenderedBfs(rendered.replace('skill:\n  standard: 6\n  veteran: 5', 'skill: 6')), /skill must be an object/);
    assert.throws(() => parseRenderedBfs(rendered.replace('  hits: 4', '  hits: "4"')), /damage.hits must be an integer/);
    assert.throws(() => parseRenderedBfs(rendered.replace('techBase: "IS"', 'techBase: "invalid"')), /techBase/);
    assert.throws(() => parseRenderedBfs(rendered.replace('role: "STRIKER"', 'role: "invalid"')), /role/);
    assert.throws(() => validateBfsDocument({ ...fixtureDocument(), range: [6, 3, 9] }), /ascending/);
    assert.throws(() => validateBfsDocument({ ...fixtureDocument(), specials: [1] } as unknown as BfsDocument), /specials/);

    const blk = `<UUID>019f583e-e2c6-7b99-a188-ba0759db128e</UUID>\n<UnitType>Tank</UnitType>\n<Name>Example</Name>\n<Model>X-1</Model>\n<year>3050</year>\n<type>Clan Level 2</type>\n<role>Missile Boat</role>\n<motion_type>Hover</motion_type>\n<source>TR:Test</source>`;
    const blkMetadata = parseMegaMekUnitFileMetadata(blk, path.join(unitFilesRoot, 'vehicles', 'Example.blk'), unitFilesRoot)!;
    assert.equal(blkMetadata.uuid, '019f583e-e2c6-7b99-a188-ba0759db128e');
    assert.equal(blkMetadata.chassis, 'Example');
    assert.equal(blkMetadata.model, 'X-1');
    assert.equal(blkMetadata.introYear, 3050);
    assert.equal(blkMetadata.techBase, 'Clan');
    assert.equal(blkMetadata.role, 'MISSILE_BOAT');
    assert.equal(blkMetadata.movementMode, 'HOVER');
    assert.equal(blkMetadata.bfsAssetType, 'Vehicle');
    assert.ok(isCanonicalUuid(blkMetadata.uuid));

    const mtf = 'Version:1.0\nuuid:019f583e-d705-7a89-aa1a-b1554faebbd2\nChassis:Stinger LAM\nModel:STG-A5\nEra:2686\nTechBase:Inner Sphere\nSource:TR:3085\nRole:Interceptor\n';
    const mtfMetadata = parseMegaMekUnitFileMetadata(mtf, path.join(unitFilesRoot, 'meks', 'LAMS', 'Stinger.mtf'), unitFilesRoot)!;
    assert.equal(mtfMetadata.uuid, '019f583e-d705-7a89-aa1a-b1554faebbd2');
    assert.equal(mtfMetadata.model, 'STG-A5');
    assert.equal(mtfMetadata.techBase, 'IS');
    assert.equal(mtfMetadata.bfsAssetType, undefined);
    assert.throws(() => parseMegaMekUnitFileMetadata('', 'fixture.txt', unitFilesRoot), /unsupported unit file extension/);

    const discoveryRoot = path.join(temporaryRoot, 'discovery');
    fs.mkdirSync(path.join(discoveryRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(discoveryRoot, 'b.MTF'), '');
    fs.writeFileSync(path.join(discoveryRoot, 'nested', 'a.blk'), '');
    fs.writeFileSync(path.join(discoveryRoot, 'ignored.txt'), '');
    assert.deepEqual(listUnitFilesRecursive(discoveryRoot).map((file) => normalizeRelativePath(discoveryRoot, file)), [
        'b.MTF', 'nested/a.blk',
    ]);
    assert.throws(() => listUnitFilesRecursive(path.join(discoveryRoot, 'missing')), /ENOENT/);

    const groundRows = readGroundCsv(path.join(csvRoot, 'Battlefield Support Assets - BSAs.csv'));
    const emplacementRows = readEmplacementCsv(path.join(csvRoot, 'Battlefield Support Assets - Emplacements.csv'));
    const aerospaceRows = readAerospaceCsv(path.join(csvRoot, 'Battlefield Support Assets - Aerospace.csv'));
    assert.equal(groundRows.length, 119);
    assert.equal(emplacementRows.length, 41);
    assert.equal(aerospaceRows.length, 141);
    assert.equal(groundRows.find((row) => row.name === 'Savannah Master Hovercraft (Interdictor)')?.skill.standard, 6);
    assert.ok(emplacementRows.every((row) => row.movement.mode === 'NONE' && row.specials.includes('Immobile')));
    assert.equal(aerospaceRows.some((row) => row.name === 'IS'), false, 'summary footer rows must not parse as units');

    const malformedAerospacePath = path.join(temporaryRoot, 'malformed-aerospace.csv');
    fs.writeFileSync(malformedAerospacePath, `${[
        'Name', 'Type', 'Size', 'Skill', 'Check', 'Thrust', 'Damage', 'Range', 'Thresh', 'Fuel', 'Cost', 'Special', 'Source',
    ].join(',')}\n,IS,1,5,5,1,1x1,Short,2,1,10,--,Test\n`);
    assert.throws(() => readAerospaceCsv(malformedAerospacePath), /data but no aerospace unit name/);

    const manifest = readBfsManifest(manifestPath);
    assert.equal(manifest.entries.length, 160);
    assert.equal(new Set(manifest.entries.map((entry) => entry.uuid)).size, 160);
    assert.equal(manifest.entries.filter((entry) => entry.dataset === 'ground').length, 119);
    assert.equal(manifest.entries.filter((entry) => entry.dataset === 'emplacement').length, 41);
    assert.equal(manifest.entries.filter((entry) => entry.provenance === 'existing').length, 6);

    const plan = buildBfsGenerationPlan({ csvRoot, unitFilesRoot, manifestPath, reportPath });
    assert.equal(plan.files.length, 160);
    assert.equal(plan.aerospace.length, 141);
    assert.equal(new Set(plan.files.map((file) => file.document.uuid)).size, 160);
    assert.equal(plan.files.filter((file) => file.document.linkedUnitId).length, 119);
    assert.equal(plan.files.filter((file) => !file.document.linkedUnitId).length, 41);
    assert.ok(plan.files.every((file) => isCanonicalUuid(file.document.uuid)));
    assert.ok(plan.files.every((file) => parseRenderedBfs(file.content).uuid === file.document.uuid));
    assert.match(plan.reportContent, /Supported definitions: \*\*160\*\*/);
    assert.match(plan.reportContent, /Aerospace rows blocked[^\n]+\*\*141\*\*/);
    assert.match(
        plan.reportContent,
        /\| BFS name \| MTF\/BLK name \| Status \| BFS path \| Asset UUID \| Linked source \| Linked UUID \|/,
    );
    assert.match(
        plan.reportContent,
        /\| APC \\\(Hover\\\) \| Armored Personnel Carrier \\\(Hover\\\) \| new \|/,
        'BFS and linked source names must be adjacent for direct comparison',
    );
    assert.match(
        plan.reportContent,
        /Elemental III BA \\\[AP Gauss\\\]\\\(Sqd5\\\)\.blk/,
        'Markdown-sensitive filename punctuation must be escaped',
    );
    assert.doesNotMatch(plan.reportContent, /\[AP Gauss\]\(Sqd5\)/, 'source paths must not become Markdown links');
    assert.equal(plan.reportContent, plan.reportContent.replace(/\r\n/gu, '\n'));
    const regenerated = buildBfsGenerationPlan({ csvRoot, unitFilesRoot, manifestPath, reportPath });
    assert.deepEqual(regenerated.files.map((file) => file.content), plan.files.map((file) => file.content));
    assert.equal(regenerated.reportContent, plan.reportContent);

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const assertManifestRejected = (name: string, content: string, expected: RegExp): void => {
        const candidatePath = path.join(temporaryRoot, `${name}.yaml`);
        fs.writeFileSync(candidatePath, content);
        assert.throws(
            () => buildBfsGenerationPlan({ csvRoot, unitFilesRoot, manifestPath: candidatePath, reportPath }),
            expected,
        );
    };
    assertManifestRejected(
        'linked-output-location',
        manifestContent.replace(
            "outputFile: 'battlearmor/3058Uu/Elemental Battle Armor [MG] (Sqd5).bfs'",
            "outputFile: 'vehicles/Elemental Battle Armor [MG] (Sqd5).bfs'",
        ),
        /linked output must be beside its source file/,
    );
    assertManifestRejected(
        'standalone-prefix',
        manifestContent.replace('battlefieldsupport/Castle Brian Emplacement 1.bfs', 'battlefieldsupported/Castle Brian Emplacement 1.bfs'),
        /standalone output must be under battlefieldsupport/,
    );
    assertManifestRejected(
        'standalone-traversal',
        manifestContent.replace('battlefieldsupport/Castle Brian Emplacement 1.bfs', 'battlefieldsupport/../Castle Brian Emplacement 1.bfs'),
        /must not contain.*parent-directory segments/,
    );

    const isolatedUnitFilesRoot = path.join(temporaryRoot, 'isolated-mekfiles');
    for (const entry of manifest.entries) {
        if (entry.dataset === 'ground') {
            const source = path.join(unitFilesRoot, entry.unitFile);
            const destination = path.join(isolatedUnitFilesRoot, entry.unitFile);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(source, destination);
        }
    }
    const firstLinkedEntry = manifest.entries.find((entry) => entry.dataset === 'ground')!;
    const duplicateSourcePath = path.join(isolatedUnitFilesRoot, 'duplicate', 'duplicate.blk');
    fs.mkdirSync(path.dirname(duplicateSourcePath), { recursive: true });
    fs.copyFileSync(path.join(unitFilesRoot, firstLinkedEntry.unitFile), duplicateSourcePath);
    assert.throws(
        () => buildBfsGenerationPlan({ csvRoot, unitFilesRoot: isolatedUnitFilesRoot, manifestPath, reportPath }),
        /MTF\/BLK UUID .* is duplicated/,
    );
    fs.unlinkSync(duplicateSourcePath);
    const firstOutputPath = path.join(
        isolatedUnitFilesRoot,
        firstLinkedEntry.outputFile ?? firstLinkedEntry.unitFile.replace(/\.(?:mtf|blk)$/iu, '.bfs'),
    );
    fs.writeFileSync(firstOutputPath, rendered);
    assert.throws(
        () => buildBfsGenerationPlan({ csvRoot, unitFilesRoot: isolatedUnitFilesRoot, manifestPath, reportPath }),
        /Existing BFS UUID mismatch/,
    );

    const writeRoot = path.join(temporaryRoot, 'write');
    const writtenBfsPath = path.join(writeRoot, 'asset.bfs');
    const writtenReportPath = path.join(writeRoot, 'report.md');
    const writePlan = {
        ...plan,
        files: [{ ...plan.files[0], absolutePath: writtenBfsPath, content: 'asset content\n' }],
        reportPath: writtenReportPath,
        reportContent: 'report content\n',
    };
    writeBfsGenerationPlan(writePlan);
    fs.writeFileSync(writtenBfsPath, 'stale asset\n');
    fs.writeFileSync(writtenReportPath, 'stale report\n');
    writeBfsGenerationPlan(writePlan);
    writeBfsGenerationPlan(writePlan);
    assert.equal(fs.readFileSync(writtenBfsPath, 'utf8'), 'asset content\n');
    assert.equal(fs.readFileSync(writtenReportPath, 'utf8'), 'report content\n');
    assert.deepEqual(fs.readdirSync(writeRoot).sort(), ['asset.bfs', 'report.md']);

    console.log(`BFS generator tests passed (${plan.files.length} supported, ${plan.aerospace.length} aerospace blocked).`);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
