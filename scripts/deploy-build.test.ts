// Copyright (C) 2026 The MegaMek Team
// SPDX-License-Identifier: GPL-3.0-or-later

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
    buildLftpDeployScript,
    type LftpDeployScriptOptions,
} from './deploy-build';

function createScript(overrides: Partial<LftpDeployScriptOptions> = {}): string {
    return buildLftpDeployScript({
        ftpUser: 'user',
        ftpPassword: 'password',
        ftpHost: 'ftp.example.test',
        remoteDirectory: './mekbay',
        browserDirectory: './dist/browser',
        licensesFile: './missing-license-file',
        ...overrides,
    });
}

test('publishes content before unit manifest, asset manifest, and entry points', () => {
    const script = createScript();
    const contentPhase = script.indexOf('--exclude-glob=online-assets/generated/units-manifest.json');
    const manifestPhase = script.indexOf('--file=units-manifest.json');
    const topManifestPhase = script.indexOf('--file=assets-manifest.json');
    const entrypointPhase = script.indexOf('--file=index.html');

    assert.ok(contentPhase >= 0);
    assert.ok(manifestPhase > contentPhase);
    assert.ok(topManifestPhase > manifestPhase);
    assert.ok(entrypointPhase > topManifestPhase);
    assert.doesNotMatch(script, /--transfer-all/u);
    assert.match(script, /set xfer:use-temp-file yes/u);
    assert.match(script, /set ssl:verify-certificate yes/u);
    assert.doesNotMatch(script, /ssl:verify-certificate false/u);
    assert.match(script, /set ftp:use-site-utime yes/u);
    assert.match(script, /set ftp:use-site-utime2 yes/u);
    assert.match(script, /--upload-older/u);
    assert.doesNotMatch(script, /--delete(?:-first)?\b|\brm\s|\bmrm\s/u);
});

test('scheduled cleanup never deletes unit catalog assets', () => {
    const deployScript = createScript();
    assert.doesNotMatch(deployScript, /--delete(?:-first)?\b|\brm\s|\bmrm\s/u);

    const cleanupSource = fs.readFileSync(
        path.join(__dirname, 'cleanup-ftp-build-output.ts'),
        'utf8',
    );
    const cleanupCalls = [...cleanupSource.matchAll(/cleanupRemoteFiles\(\{([\s\S]*?)\n\s*\}\);/gu)]
        .map(match => match[1] ?? '');
    assert.equal(cleanupCalls.length, 2, 'only Angular bundles and sprites may be age-cleaned');
    for (const call of cleanupCalls) {
        assert.doesNotMatch(call, /core-unit|core-units|assets[\\/]units/iu);
    }
});

test('does not use deploy timestamps as repository content authority', () => {
    const script = createScript();
    assert.equal((script.match(/--upload-older/gu) ?? []).length, 4);
    assert.doesNotMatch(script, /--only-newer|--transfer-all/u);
});

test('includes the CSR entry point only when it exists', () => {
    assert.doesNotMatch(createScript(), /--file=index\.csr\.html/u);
    assert.match(createScript({ hasCsrIndex: true }), /--file=index\.csr\.html/u);
});

test('rejects unsafe remote paths', () => {
    assert.throws(
        () => createScript({ remoteDirectory: '../outside' }),
        /Unsafe FTP_REMOTE_DIR/u,
    );
    assert.throws(
        () => createScript({ remoteDirectory: './mekbay; rm' }),
        /Unsafe FTP_REMOTE_DIR/u,
    );
});

test('quotes credentials without exposing lftp commands', () => {
    const script = createScript({ ftpPassword: 'a";$`b' });
    assert.match(script, /user "user" "a\\";\\\$\\`b"/u);
});
