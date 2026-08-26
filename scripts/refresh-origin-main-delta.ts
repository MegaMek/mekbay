// SPDX-License-Identifier: GPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const LEDGER = path.join(ROOT, 'plans', 'entity-blueprint-runtime-origin-main-delta.md');
const UPSTREAM = process.argv[2] ?? 'origin/main';

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function existingRows(source: string): {
  commits: Map<string, string>;
  files: Map<string, string>;
  filesByTarget: Map<string, string>;
} {
  const commits = new Map<string, string>();
  const files = new Map<string, string>();
  const filesByTarget = new Map<string, string>();
  let section: 'commits' | 'files' | null = null;
  for (const line of source.split(/\r?\n/u)) {
    if (line.startsWith('## Non-merge commits')) section = 'commits';
    else if (line.startsWith('## Changed files')) section = 'files';
    else if (section === 'commits') {
      const match = /^- \[[ x]\] `([0-9a-f]+)`/u.exec(line);
      if (match) commits.set(match[1]!, line);
    } else if (section === 'files' && /^- \[[ x]\]/u.test(line)) {
      const tokens = [...line.matchAll(/`([^`]+)`/gu)].map(match => match[1]!);
      if (tokens.length < 2) continue;
      const key = tokens.join('\t');
      files.set(key, line);
      filesByTarget.set(tokens.at(-1)!, line);
    }
  }
  return { commits, files, filesByTarget };
}

function currentCommitRows(base: string, prior: Map<string, string>): string[] {
  const output = git(
    'log', '--reverse', '--no-merges', '--abbrev=8', '--format=%h%x09%s', `${base}..${UPSTREAM}`,
  );
  if (!output) return [];
  return output.split(/\r?\n/u).map(line => {
    const separator = line.indexOf('\t');
    const hash = line.slice(0, separator);
    const subject = line.slice(separator + 1);
    return prior.get(hash) ?? `- [ ] \`${hash}\` — ${subject} — **pending**`;
  });
}

function currentFileRows(
  base: string,
  prior: Map<string, string>,
  priorByTarget: Map<string, string>,
): string[] {
  const output = git('diff', '--name-status', '-M', `${base}..${UPSTREAM}`);
  if (!output) return [];
  return output.split(/\r?\n/u).map(line => {
    const [status, ...paths] = line.split('\t');
    const key = [status, ...paths].join('\t');
    const retained = prior.get(key) ?? priorByTarget.get(paths.at(-1)!);
    if (retained) return retained;
    const display = paths.map(file => `\`${file}\``).join(' → ');
    return `- [ ] \`${status}\` ${display} — **pending**`;
  });
}

function main(): void {
  const previous = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8') : '';
  const prior = existingRows(previous);
  const base = git('merge-base', 'HEAD', UPSTREAM);
  const tip = git('rev-parse', '--short=8', UPSTREAM);
  const commits = currentCommitRows(base, prior.commits);
  const files = currentFileRows(base, prior.files, prior.filesByTarget);
  const today = new Date().toISOString().slice(0, 10);
  const output = `# origin/main convergence delta closure ledger

This is the literal closure list for the production-parity requirement.
The source range is merge base \`${base}\`
through audited \`${UPSTREAM}\` tip \`${tip}\` on ${today}.

Each row must end as **ported** with direct V2 evidence or **unrelated** with
a concrete reason. **Pending** is a completion blocker. Refresh this file
against the then-current upstream tip before final closure.

## Non-merge commits (${commits.length})

${commits.join('\n')}

## Changed files (${files.length})

${files.join('\n')}
`;
  fs.writeFileSync(LEDGER, output);
  process.stdout.write(
    `Refreshed ${path.relative(ROOT, LEDGER)} at ${tip}: ${commits.length} commits, ${files.length} files.\n`,
  );
}

main();
