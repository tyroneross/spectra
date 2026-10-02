import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function document(path: string) {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))
}

describe('Codex package', () => {
  it('updates the portable plugin version on automated releases', () => {
    const release = document('release-please-config.json').packages['.']
    expect(release['extra-files']).toContainEqual({
      type: 'json',
      path: 'plugin.json',
      jsonpath: '$.version',
    })
  })

  it('ships the portable manifests with a matching package identity', () => {
    const pkg = document('package.json')
    const plugin = document('plugin.json')
    expect(pkg.files).toEqual(expect.arrayContaining(['plugin.json', 'mcp.json', 'dist/']))
    expect(plugin.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json')
    expect(plugin.name).toBe('spectra')
    expect(plugin.version).toBe(pkg.version)
    expect(plugin.extensions['com.openai'].interface.defaultPrompt.length).toBeLessThanOrEqual(128)
  })

  it('resolves the server from the installed package rather than the caller directory', () => {
    const mcp = document('mcp.json')
    expect(mcp.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/mcp.schema.json')
    expect(mcp.mcpServers.spectra).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['${PLUGIN_ROOT}/dist/mcp/server.js'],
      cwd: '${PLUGIN_DATA}',
    })
    expect(readFileSync(new URL('../../dist/mcp/server.js', import.meta.url), 'utf8')).toContain('Server')
  })

  it('uses the supported allow-list field in the compatibility manifest', () => {
    const server = document('.codex-plugin/plugin.json').mcpServers.spectra
    expect(server).not.toHaveProperty('tools')
    expect(server.enabled_tools).toContain('spectra_session')
  })
})
