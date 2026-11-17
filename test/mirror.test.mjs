/**
 * @dotrino/update/mirror — lo que se sube al espejo: paquete propio, dependencias verificadas,
 * packument sumado (nunca pisado) y los packuments al final.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { buildMirror, uploadMirror, compareVersions, tarballName } from '../src/mirror.js'
import { integrityOf } from '../src/integrity.js'

const BASE = 'https://mirror.example.com'
const UP = 'https://registry.npmjs.org'

/** Un .tgz mínimo con package/package.json dentro. */
function tgz (pkg) {
  const body = Buffer.from(JSON.stringify(pkg))
  const head = Buffer.alloc(512)
  head.write('package/package.json', 0)
  head.write(body.length.toString(8).padStart(11, '0'), 124)
  const pad = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length)
  return zlib.gzipSync(Buffer.concat([head, body, pad, Buffer.alloc(1024)]))
}

const OWN = tgz({ name: '@dotrino/demo', version: '1.2.0', dependencies: { dep: '^2.0.0' } })
const DEP = Buffer.from('dep-tarball')
const lock = { packages: {
  '': { name: 'x' },
  'node_modules/@dotrino/demo': { version: '1.2.0', resolved: 'file:../demo-1.2.0.tgz' },
  'node_modules/dep': { version: '2.1.0', resolved: `${UP}/dep/-/dep-2.1.0.tgz`, integrity: integrityOf(DEP) }
} }
const files = { 'demo.tgz': OWN, 'lock.json': Buffer.from(JSON.stringify(lock)), 'npm-integrity.json': Buffer.from('{}') }
const readFile = (p) => files[p]

function fakeFetch ({ existing = null, packumentStatus = null, depPresent = false, depBytes = DEP } = {}) {
  return async (url, opts = {}) => {
    if (url === `${BASE}/npm/@dotrino%2fdemo`) {
      if (packumentStatus) return { ok: false, status: packumentStatus }
      return existing ? { ok: true, status: 200, json: async () => existing } : { ok: false, status: 404 }
    }
    if (url === `${BASE}/npm/dep`) return { ok: false, status: 404 }
    if (url === `${BASE}/npm/dep/2.1.0` && opts.method === 'HEAD') return { ok: depPresent, status: depPresent ? 200 : 404 }
    if (url === `${UP}/dep/2.1.0`) return { ok: true, json: async () => ({ name: 'dep', version: '2.1.0', dist: { tarball: `${UP}/dep/-/dep-2.1.0.tgz` } }) }
    if (url === `${UP}/dep/-/dep-2.1.0.tgz`) return { ok: true, arrayBuffer: async () => depBytes.buffer.slice(depBytes.byteOffset, depBytes.byteOffset + depBytes.byteLength) }
    return { ok: false, status: 500 }
  }
}
const keys = (fs) => fs.map((f) => f.key).sort()

test('paquete propio, su dependencia y la release: todo bajo las rutas de un registro', async () => {
  const out = await buildMirror({ tarballs: ['demo.tgz'], releaseFiles: ['npm-integrity.json'], repo: 'imdotrino/dotrino-demo', tag: 'v1.2.0', lock: 'lock.json', base: BASE, fetchImpl: fakeFetch(), readFile })
  assert.deepEqual(keys(out), [
    'npm/-/package/@dotrino/demo/dist-tags', 'npm/-/package/dep/dist-tags',
    'npm/@dotrino/demo', 'npm/@dotrino/demo/-/demo-1.2.0.tgz', 'npm/@dotrino/demo/1.2.0',
    'npm/dep', 'npm/dep/-/dep-2.1.0.tgz', 'npm/dep/2.1.0',
    'releases/imdotrino/dotrino-demo/v1.2.0/npm-integrity.json'
  ].sort())
  const v = JSON.parse(out.find((f) => f.key === 'npm/@dotrino/demo/1.2.0').body)
  assert.equal(v.dist.tarball, `${BASE}/npm/@dotrino/demo/-/demo-1.2.0.tgz`)
  assert.equal(v.dist.integrity, integrityOf(OWN))
  assert.deepEqual(v.dependencies, { dep: '^2.0.0' })
  const dep = JSON.parse(out.find((f) => f.key === 'npm/dep/2.1.0').body)
  assert.equal(dep.dist.tarball, `${BASE}/npm/dep/-/dep-2.1.0.tgz`, 'el tarball apunta al espejo, no a npm')
})

test('el packument se SUMA al que hay: no se pierden versiones', async () => {
  const existing = { name: '@dotrino/demo', 'dist-tags': { latest: '1.1.0' }, versions: { '1.1.0': { version: '1.1.0' } }, time: {} }
  const out = await buildMirror({ tarballs: ['demo.tgz'], base: BASE, fetchImpl: fakeFetch({ existing }), readFile })
  const pk = JSON.parse(out.find((f) => f.key === 'npm/@dotrino/demo').body)
  assert.deepEqual(Object.keys(pk.versions).sort(), ['1.1.0', '1.2.0'])
  assert.equal(pk['dist-tags'].latest, '1.2.0')
  assert.deepEqual(JSON.parse(out.find((f) => f.key === 'npm/-/package/@dotrino/demo/dist-tags').body), { latest: '1.2.0' })
})

test('si el packument que hay no se puede leer, se para (no se pisa a ciegas)', async () => {
  await assert.rejects(buildMirror({ tarballs: ['demo.tgz'], base: BASE, fetchImpl: fakeFetch({ packumentStatus: 503 }), readFile }), { code: 'mirror-unreadable' })
})

test('una dependencia que no es lo que dice el lockfile no se sube', async () => {
  await assert.rejects(buildMirror({ lock: 'lock.json', base: BASE, fetchImpl: fakeFetch({ depBytes: Buffer.from('otra') }), readFile }), { code: 'mirror-integrity-mismatch' })
})

test('lo que ya está en el espejo no se vuelve a subir', async () => {
  const out = await buildMirror({ lock: 'lock.json', base: BASE, fetchImpl: fakeFetch({ depPresent: true }), readFile })
  assert.deepEqual(out, [])
})

test('subir: los packuments van al final', () => {
  const calls = []
  const n = uploadMirror([
    { key: 'npm/x', body: Buffer.from('{}'), contentType: 'application/json', cacheControl: 'x', late: true },
    { key: 'npm/x/-/x-1.0.0.tgz', body: Buffer.from('t'), contentType: 'application/octet-stream', cacheControl: 'x' }
  ], { bucket: 's3://dotrino-deps', run: (cmd, args) => calls.push(args[3]) })
  assert.equal(n, 2)
  assert.deepEqual(calls, ['s3://dotrino-deps/npm/x/-/x-1.0.0.tgz', 's3://dotrino-deps/npm/x'])
  assert.throws(() => uploadMirror([], { bucket: 'dotrino-deps' }), { code: 'mirror-bad-args' })
})

test('versiones: el prerelease va por debajo', () => {
  assert.ok(compareVersions('1.2.0', '1.10.0') < 0)
  assert.ok(compareVersions('1.2.0-beta.1', '1.2.0') < 0)
  assert.equal(tarballName('@dotrino/x', '1.0.0'), 'x-1.0.0.tgz')
})
