import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildRatGeneratorCsv } from './ratgenerator_build_table';

const APP_ROOT = path.resolve(__dirname, '..');
const ORACLE_PATH = path.join(APP_ROOT, 'scripts', 'oracles', 'ratgenerator-reference.json');

interface RatGeneratorOracle {
    readonly schemaVersion: 1;
    readonly sha256: string;
    readonly bytes: number;
    readonly lines: number;
    readonly rows: number;
    readonly warnings: {
        readonly count: number;
        readonly sha256: string;
    };
    readonly sentinels: readonly {
        readonly index: number;
        readonly value: string;
    }[];
}

async function main(): Promise<void> {
    const oracle = JSON.parse(fs.readFileSync(ORACLE_PATH, 'utf8')) as RatGeneratorOracle;
    assert.equal(oracle.schemaVersion, 1, 'Unsupported RAT generator oracle schema');
    assert.match(oracle.sha256, /^[0-9a-f]{64}$/u, 'Invalid RAT generator oracle digest');
    const outputFilePath = path.join(APP_ROOT, 'tmp', 'ratgenerator.test.csv');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    let csv: string;
    try {
        ({ csv } = await buildRatGeneratorCsv({ outputFilePath }));
    } finally {
        console.warn = originalWarn;
    }
    const actual = csv.replace(/\r\n/g, '\n');
    const lines = actual.split('\n');
    const rows = lines.at(-1) === '' ? lines.length - 2 : lines.length - 1;

    assert.equal(Buffer.byteLength(actual, 'utf8'), oracle.bytes, 'Generated CSV byte count changed');
    assert.equal(lines.length, oracle.lines, 'Generated CSV line count changed');
    assert.equal(rows, oracle.rows, 'Generated CSV data-row count changed');
    for (const sentinel of oracle.sentinels) {
        assert.equal(lines[sentinel.index], sentinel.value, `Generated CSV sentinel line ${sentinel.index + 1} changed`);
    }
    const digest = createHash('sha256').update(actual, 'utf8').digest('hex');
    assert.equal(digest, oracle.sha256, `Generated CSV digest changed (actual ${digest})`);
    const warningDigest = createHash('sha256').update(warnings.join('\n'), 'utf8').digest('hex');
    assert.equal(warnings.length, oracle.warnings.count, 'Generated warning count changed');
    assert.equal(warningDigest, oracle.warnings.sha256, `Generated warning digest changed (actual ${warningDigest})`);

    console.log(
        `[ratgenerator] compact oracle parity passed (${oracle.rows} data rows, ${oracle.warnings.count} reviewed warnings)`,
    );
}

main().catch((error: unknown) => {
    console.error('[ratgenerator] compact oracle parity failed', error);
    process.exitCode = 1;
});
