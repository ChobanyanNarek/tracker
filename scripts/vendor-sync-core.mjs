#!/usr/bin/env node
/*
 * Copy the shared sync core (src/sync-core, plus the app's types) into progressor-backend,
 * which runs the same code for server-side sync. The backend copy is generated: edit here,
 * then run this. `--check` exits non-zero if the backend copy differs from what this would
 * write, so a stale copy is caught before deploying either side.
 *
 *   node scripts/vendor-sync-core.mjs [--check] [--backend ../progressor-backend]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const check = args.includes('--check')
const backendArg = args.indexOf('--backend')
const backend = resolve(root, backendArg >= 0 ? args[backendArg + 1] : '../progressor-backend')
const target = join(backend, 'src/modules/pm-tracker/sync-core')

const HEADER = `// GENERATED from pm-tracker/src/sync-core by scripts/vendor-sync-core.mjs -- do not edit here.\n\n`

// Backend convention: relative imports carry the .ts extension; the app's types become ./types.ts.
function rewrite(source) {
  return HEADER + source
    .replace(/from '\.\.\/types'/g, "from './types.ts'")
    .replace(/from '\.\/([\w-]+)'/g, "from './$1.ts'")
}

const files = new Map()
for (const name of readdirSync(join(root, 'src/sync-core'))) {
  if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
  files.set(name, rewrite(readFileSync(join(root, 'src/sync-core', name), 'utf8')))
}
files.set('types.ts', HEADER + readFileSync(join(root, 'src/types/index.ts'), 'utf8'))

if (check) {
  const present = existsSync(target) ? readdirSync(target).filter((n) => n.endsWith('.ts')) : []
  const stale = [
    ...[...files].filter(([name, text]) => !existsSync(join(target, name)) || readFileSync(join(target, name), 'utf8') !== text).map(([n]) => n),
    ...present.filter((n) => !files.has(n)),
  ]
  if (stale.length) {
    console.error(`Backend sync-core copy is out of date: ${stale.join(', ')}\nRun: node scripts/vendor-sync-core.mjs`)
    process.exit(1)
  }
  console.log(`Backend sync-core copy is current (${files.size} files).`)
} else {
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const [name, text] of files) writeFileSync(join(target, name), text)
  console.log(`Wrote ${files.size} files to ${target}`)
}
