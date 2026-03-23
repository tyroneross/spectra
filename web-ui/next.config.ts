import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  serverExternalPackages: ['spectra', 'sharp'],
  turbopack: {
    // Expand root to the repo root so Turbopack can follow the `spectra`
    // symlink (node_modules/spectra -> ../..) which resolves outside web-ui/
    root: path.resolve(__dirname, '..'),
  },
}

export default nextConfig
