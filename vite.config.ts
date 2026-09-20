import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const appVersion = `${pkg.version}+${shortSha()}`

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'lokpulse-announce-url',
      configureServer(server) {
        server.httpServer?.once('listening', () => {
          const addr = server.httpServer?.address()
          const port = typeof addr === 'object' && addr ? addr.port : 5173
          console.log('')
          console.log(`  LokPulse UI:  http://127.0.0.1:${port}/`)
          console.log('  (Port 5173 may be an older build. Use the URL Vite printed above.)')
          console.log(`  app_version:  ${appVersion}`)
          console.log('')
        })
      },
    },
  ],
})
