// Builds the extension without pnpm/npm -- runs tsc then vite from
// node_modules directly. Use when `pnpm run build` fails (e.g. pnpm's
// pre-run deps check crashing on Node 24):  node build.mjs
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const win = process.platform === 'win32'
const bin = (name) => join(process.cwd(), 'node_modules', '.bin', win ? `${name}.cmd` : name)

const steps = [
  [bin('tsc'), ['--noEmit']],
  [bin('vite'), ['build']],
]

for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: win })
  if (result.status !== 0) {
    console.error(`\nBuild failed at: ${cmd}`)
    process.exit(result.status ?? 1)
  }
}
console.log('\nBuild OK -> dist/  (reload the extension card in chrome://extensions)')
