import fs from 'node:fs';
import path from 'node:path';

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeRelativePath(rootPath: string, filePath: string): string {
    return path.relative(rootPath, filePath).split(path.sep).join('/');
}

export function listUnitFilesRecursive(rootPath: string): string[] {
    const root = path.resolve(rootPath);
    const rootStats = fs.statSync(root);
    if (!rootStats.isDirectory()) {
        throw new Error(`${root} is not a directory.`);
    }

    const files: string[] = [];
    const visit = (directory: string): void => {
        const entries = fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
            } else if (entry.isFile() && /\.(?:mtf|blk)$/iu.test(entry.name)) {
                files.push(entryPath);
            }
        }
    };

    visit(root);
    return files.sort((left, right) => compareText(normalizeRelativePath(root, left), normalizeRelativePath(root, right)));
}
