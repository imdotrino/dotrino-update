/** El vigía de dependencias: mira lo INSTALADO, y lo que falta lo dice en vez de callarlo. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installedDeps, watchDependencies, printDependencyNotices } from '../src/deps.js'

function service (deps, installed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-'))
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: deps }))
  for (const [name, version] of Object.entries(installed)) {
    fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }))
  }
  return dir
}

test('solo los pilares, y con la versión instalada, no la pedida', () => {
  const dir = service({ '@dotrino/identity': '0.109.0', pg: '8.0.0' }, { '@dotrino/identity': '0.62.0', pg: '8.0.0' })
  assert.deepEqual(installedDeps({ dir }), [{ pkg: '@dotrino/identity', version: '0.62.0' }])
})

test('declarada y sin instalar: lanza con su código, no se salta', () => {
  const dir = service({ '@dotrino/identity': '0.109.0' }, {})
  assert.throws(() => installedDeps({ dir }), (e) => e.code === 'deps-not-installed')
  assert.throws(() => installedDeps({ dir: path.join(dir, 'nope') }), (e) => e.code === 'deps-unreadable')
  assert.throws(() => installedDeps({}), (e) => e.code === 'deps-no-dir')
})

test('avisa de la que quedó atrás y calla la que está al día', async () => {
  const dir = service({ '@dotrino/identity': 'x', '@dotrino/vault': 'x' }, { '@dotrino/identity': '0.62.0', '@dotrino/vault': '0.82.0' })
  const latest = { '@dotrino/identity': '0.109.0', '@dotrino/vault': '0.82.0' }
  const fetchImpl = async (url) => {
    const name = decodeURIComponent(String(url).split('/-/package/')[1].split('/dist-tags')[0])
    return { ok: true, json: async () => ({ latest: latest[name] }) }
  }
  const lines = []; const seen = []
  const stop = watchDependencies({ dir, name: 'geo', fetchImpl, log: (l) => lines.push(l), onNewer: (r) => seen.push(r.pkg) })
  await new Promise((r) => setTimeout(r, 50))
  stop()
  assert.deepEqual(seen, ['@dotrino/identity'])
  assert.equal(lines.length, 1)
  assert.match(lines[0], /geo: @dotrino\/identity 0\.109\.0 is available \(running 0\.62\.0\)/)
})

test('si no se pudo mirar, no dice nada (y no dice «al día»)', async () => {
  const dir = service({ '@dotrino/identity': 'x' }, { '@dotrino/identity': '0.62.0' })
  const lines = []
  const stop = watchDependencies({ dir, fetchImpl: async () => ({ ok: false, status: 503 }), log: (l) => lines.push(l) })
  await new Promise((r) => setTimeout(r, 50))
  stop()
  assert.deepEqual(lines, [])
})

test('un comando: una línea por stderr por cada pilar atrasado, y cuenta cuántas', async () => {
  const dir = service({ '@dotrino/identity': 'x', '@dotrino/vault': 'x' }, { '@dotrino/identity': '0.62.0', '@dotrino/vault': '0.82.0' })
  const latest = { '@dotrino/identity': '0.109.0', '@dotrino/vault': '0.82.0' }
  const fetchImpl = async (url) => {
    const name = decodeURIComponent(String(url).split('/-/package/')[1].split('/dist-tags')[0])
    return { ok: true, json: async () => ({ latest: latest[name] }) }
  }
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-cache-'))
  const out = []; const write = process.stderr.write
  process.stderr.write = (chunk) => { out.push(String(chunk)); return true }
  let n
  try { n = await printDependencyNotices({ dir, fetchImpl, env: { XDG_CACHE_HOME: cache, HOME: cache } }) } finally { process.stderr.write = write }
  assert.equal(n, 1)
  assert.match(out.join(''), /@dotrino\/identity 0\.109\.0/)
  assert.doesNotMatch(out.join(''), /@dotrino\/vault/)
})
