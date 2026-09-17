/**
 * Local provision helper.
 * Requires Docker Desktop. Writes .env.local and runs db reset + seed.
 *
 * Usage: node scripts/provision-local.mjs
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: true,
    cwd: process.cwd(),
    stdio: 'inherit',
    ...opts,
  })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

console.log('LokPulse Supabase local provision')
console.log('Checking Docker...')
const docker = spawnSync('docker', ['version'], { encoding: 'utf8', shell: true })
if (docker.status !== 0) {
  console.error(`
ERROR: Docker is not available on this machine.
Local Supabase (npx supabase start) requires Docker Desktop.

Manual options:
  1. Install Docker Desktop, then re-run: node scripts/provision-local.mjs
  2. Or create a hosted Supabase project, link it:
       npx supabase login
       npx supabase link --project-ref <ref>
       npx supabase db push
       # then apply seed: supabase/seed/nsfdc_schemes_v0.sql in SQL editor
     and copy URL/anon/service keys into .env.local (see .env.example).

Unit tests and the existing LokPulse SPA do NOT require Supabase.
`)
  process.exit(2)
}

run('npx', ['supabase', 'start'])
run('npx', ['supabase', 'db', 'reset'])
run('node', [resolve('scripts/write-env-local.mjs')])
run('npx', ['supabase', 'db', 'query', '--file', 'scripts/verify-supabase.sql'])
console.log('\nProvision complete. Run: npm run test:integration')
