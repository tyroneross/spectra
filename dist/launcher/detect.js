// src/launcher/detect.ts
//
// Inspect a repo directory and decide how to launch it.
//
// SPDX-License-Identifier: Apache-2.0
// © 2026 Tyrone Ross, Jr <tyrone.ross.work@gmail.com>
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LauncherError } from './types.js';
export function detectRepoKind(repoPath) {
    if (!existsSync(repoPath)) {
        throw new LauncherError(`Repo path does not exist: ${repoPath}`, 'Provide an absolute path to a repository directory.');
    }
    const s = statSync(repoPath);
    if (!s.isDirectory()) {
        throw new LauncherError(`Not a directory: ${repoPath}`, 'Provide a directory, not a file.');
    }
    // 1) Node-based web (Next.js / Vite) via package.json
    const pkgPath = join(repoPath, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
            const scripts = pkg.scripts ?? {};
            if ('next' in deps) {
                // Prefer `dev` script if present; fall back to `next dev`
                const startCommand = 'dev' in scripts
                    ? ['npm', 'run', 'dev']
                    : ['npx', 'next', 'dev'];
                return { kind: 'web-next', startCommand };
            }
            if ('vite' in deps) {
                const startCommand = 'dev' in scripts
                    ? ['npm', 'run', 'dev']
                    : ['npx', 'vite'];
                return { kind: 'web-vite', startCommand };
            }
        }
        catch (err) {
            throw new LauncherError(`Failed to parse package.json: ${err instanceof Error ? err.message : String(err)}`, 'Ensure package.json is valid JSON.');
        }
    }
    // 2) macOS native via *.xcodeproj or *.xcworkspace
    const entries = readdirSync(repoPath);
    const xcworkspace = entries.find((e) => e.endsWith('.xcworkspace'));
    const xcodeproj = entries.find((e) => e.endsWith('.xcodeproj'));
    if (xcworkspace || xcodeproj) {
        return { kind: 'macos', xcodeTarget: join(repoPath, xcworkspace ?? xcodeproj) };
    }
    // 3) Static web — index.html at root
    const indexHtml = join(repoPath, 'index.html');
    if (existsSync(indexHtml)) {
        return { kind: 'web-static', staticEntry: indexHtml };
    }
    throw new LauncherError(`Could not detect a launchable surface at ${repoPath}`, 'Expected: package.json with next/vite, a .xcodeproj/.xcworkspace, or an index.html at the root.');
}
//# sourceMappingURL=detect.js.map