import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  turbopack: {
    // Tell Turbopack this project's root, silencing the multi-lockfile warning.
    root: path.resolve(__dirname),
  },
}

export default nextConfig
