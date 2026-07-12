import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildRatGeneratorCsv } from './ratgenerator_build_table';

const APP_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(APP_ROOT, 'scripts', 'fixtures', 'ratgenerator_reference.csv');

function findFirstDiffLine(expected: string, actual: string): string {
    const expectedLines = expected.split('\n');
    const actualLines = actual.split('\n');
    const max = Math.max(expectedLines.length, actualLines.length);
    for (let index = 0; index < max; index += 1) {
        if (expectedLines[index] !== actualLines[index]) {
            return `line ${index + 1}\nexpected: ${expectedLines[index] ?? '<missing>'}\nactual:   ${actualLines[index] ?? '<missing>'}`;
        }
    }
    return 'unknown diff';
}

async function main(): Promise<void> {
    const expected = fs.readFileSync(FIXTURE_PATH, 'utf8').replace(/\r\n/g, '\n');
    const outputFilePath = path.join(APP_ROOT, 'tmp', 'ratgenerator.test.csv');
    const { csv } = await buildRatGeneratorCsv({ outputFilePath });
    const actual = csv.replace(/\r\n/g, '\n');

    assert.equal(
        actual,
        expected,
        `Generated CSV differs from fixture at ${findFirstDiffLine(expected, actual)}`,
    );

    console.log('[ratgenerator] fixture parity passed');
}

main().catch((error: unknown) => {
    console.error('[ratgenerator] fixture parity failed', error);
    process.exitCode = 1;
});