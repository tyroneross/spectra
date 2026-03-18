import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const PROJECT_MARKERS = ['.git', 'package.json', '.spectra']

export function findProjectRoot(startDir: string): string | null {
  let dir = startDir
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (existsSync(join(dir, marker))) {
        return dir
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break // reached filesystem root
    dir = parent
  }
  return null
}

export function getStoragePath(cwd?: string): string {
  const startDir = cwd ?? process.cwd()
  const projectRoot = findProjectRoot(startDir)
  if (projectRoot) {
    return join(projectRoot, '.spectra')
  }
  return join(homedir(), '.spectra')
}
