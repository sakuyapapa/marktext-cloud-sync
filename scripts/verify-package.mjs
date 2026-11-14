/**
 * Sanity check for a packaged build: every module the main bundle requires at
 * runtime must exist inside app.asar, and the sync feature must be present.
 *
 *   node scripts/verify-package.mjs dist/win-unpacked/resources/app.asar
 *
 * The check cannot start Electron, but it catches the packaging failure mode we
 * hit once: pnpm's symlinked node_modules leaves transitive dependencies
 * (universalify, jsonfile, …) out of the archive.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const archive = process.argv[2]
if (!archive) {
  console.error('usage: node scripts/verify-package.mjs <app.asar>')
  process.exit(2)
}

const BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'constants', 'crypto', 'events', 'fs', 'fs/promises',
  'http', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring',
  'stream', 'stream/promises', 'string_decoder', 'timers', 'tls', 'url', 'util', 'v8', 'vm',
  'worker_threads', 'zlib', 'electron'
])

const entries = asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/').replace(/^\/+/, ''))
const present = new Set(entries)
const hasDir = (dir) => entries.some((entry) => entry === dir || entry.startsWith(`${dir}/`))

// asar stores separators as `\`; accept either spelling for the entry lookup.
const readEntry = (entry) => {
  for (const candidate of [entry, entry.replaceAll('/', '\\'), `\\${entry.replaceAll('/', '\\')}`]) {
    try {
      return asar.extractFile(archive, candidate)
    } catch {
      // try the next spelling
    }
  }
  throw new Error(`entry not found in archive: ${entry}`)
}

const main = readEntry('out/main/index.js').toString('utf8')

// A bare package name only needs its directory; a subpath (ajv/dist/…) needs
// the actual file, which asar reports with its `.js` extension.
const resolvable = (specifier) => {
  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]
  if (!hasDir(`node_modules/${packageName}`)) return false
  if (specifier === packageName) return true
  const rest = specifier.slice(packageName.length + 1)
  return ['', '.js', '.json', '/index.js'].some((suffix) =>
    present.has(`node_modules/${packageName}/${rest}${suffix}`)
  )
}

const problems = []

for (const match of main.matchAll(/require\("([^"./][^"]*)"\)/g)) {
  const specifier = match[1]
  if (BUILTINS.has(specifier) || specifier.startsWith('node:')) continue
  if (!resolvable(specifier)) {
    problems.push(`missing module in package: ${specifier}`)
  }
}

const syncChannels = (main.match(/mt::sync::/g) ?? []).length
if (syncChannels < 5) problems.push(`sync IPC channels not found in main bundle (${syncChannels})`)

const settingsWindowUi = hasDir('out/renderer')
if (!settingsWindowUi) problems.push('renderer bundle missing')

if (problems.length > 0) {
  console.error('package verification failed:')
  for (const problem of problems) console.error(` - ${problem}`)
  process.exit(1)
}

console.log(`ok: ${path.basename(archive)} -> ${syncChannels} sync channels, all main-process requires resolvable`)
