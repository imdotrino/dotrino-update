/**
 * @dotrino/update/sources — el directorio que dice DÓNDE ESTÁ CADA PIEZA.
 *
 * Lo que se fija es el caso del dueño (2026-11-17): «un servicio está en npmjs, lo pongo en
 * otro lugar, cambio el directorio y el servicio sabe que la actualización está en otro lado».
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BUILTIN_SOURCES, validateSources, signSources, openSources, generateSourcesKey,
  loadSources, refreshSources, sourcesFor, releaseUrls, sourcesPath
} from '../src/sources.js'
import { latestVersion } from '../src/index.js'
import { verifyNpmPackage, installNpmGlobal } from '../src/npm.js'
import { integrityOf } from '../src/integrity.js'

const key = generateSourcesKey()
const keys = { [key.kid]: key.publicKey }
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-src-'))
const MIRROR = 'https://deps.example.com/npm'

/** El directorio del código, con `proxy` movido a otro registro. */
const moved = (seq = 2) => ({
  ...BUILTIN_SOURCES,
  seq,
  issued: '2026-11-18T00:00:00Z',
  packages: { '@dotrino/proxy': { npm: [MIRROR] } },
  directory: ['https://deps.example.com/sources.json']
})
const builtinWithDir = { ...BUILTIN_SOURCES, directory: ['https://deps.example.com/sources.json'] }

test('por defecto, todo sigue en npmjs y GitHub', () => {
  const w = sourcesFor(BUILTIN_SOURCES, { pkg: '@dotrino/proxy' })
  assert.deepEqual(w.npm, ['https://registry.npmjs.org'])
  assert.deepEqual(releaseUrls(w.releases, { repo: 'imdotrino/x', tag: 'v1.0.0', file: 'npm-integrity.json' }),
    ['https://github.com/imdotrino/x/releases/download/v1.0.0/npm-integrity.json'])
})

test('una pieza movida busca en su sitio; las demás, en el de siempre', () => {
  const d = moved()
  assert.deepEqual(sourcesFor(d, { pkg: '@dotrino/proxy' }).npm, [MIRROR])
  assert.deepEqual(sourcesFor(d, { pkg: '@dotrino/geo' }).npm, ['https://registry.npmjs.org'])
  // lo que la entrada no dice, lo pone default
  assert.deepEqual(sourcesFor(d, { pkg: '@dotrino/proxy' }).releases, BUILTIN_SOURCES.default.releases)
})

test('la firma: se abre con la llave, y cualquier cambio la rompe', () => {
  const env = signSources(moved(), { privateKey: key.privateKey, kid: key.kid })
  assert.equal(openSources(env, { keys }).seq, 2)
  const tampered = { ...env, payload: env.payload.replace('deps.example.com', 'evil.example.com') }
  assert.throws(() => openSources(tampered, { keys }), { code: 'sources-bad-signature' })
  assert.throws(() => openSources(env, { keys: {} }), { code: 'sources-unknown-key' })
  assert.throws(() => openSources(moved(), { keys }), { code: 'sources-unsigned' })
})

test('lo que no tiene forma de directorio se rechaza', () => {
  assert.throws(() => validateSources({ ...moved(), seq: 0 }), { code: 'sources-invalid' })
  assert.throws(() => validateSources({ ...moved(), packages: { x: { npm: ['http://plano.example.com'] } } }), { code: 'sources-invalid' })
  assert.throws(() => validateSources({ ...moved(), default: { npm: [MIRROR], releases: ['https://x.example.com/{repo}'] } }), { code: 'sources-invalid' })
  assert.throws(() => validateSources({ ...moved(), packages: { x: { otro: [] } } }), { code: 'sources-invalid' })
})

test('refrescar: baja el firmado, lo guarda, y a partir de ahí manda', async () => {
  const home = tmpHome()
  const env = {}
  const signed = signSources(moved(), { privateKey: key.privateKey, kid: key.kid })
  const fetchImpl = async () => ({ ok: true, json: async () => signed })
  const r = await refreshSources({ home, env, keys, builtin: builtinWithDir, fetchImpl })
  assert.deepEqual([r.ok, r.ok && r.updated], [true, true])
  const now = loadSources({ home, env, keys, builtin: builtinWithDir })
  assert.equal(now.from, 'cache')
  assert.deepEqual(sourcesFor(now.sources, { pkg: '@dotrino/proxy' }).npm, [MIRROR])
})

test('un directorio con seq igual o menor no se acepta (nadie devuelve uno viejo)', async () => {
  const home = tmpHome()
  const env = {}
  const fetchFor = (d) => async () => ({ ok: true, json: async () => signSources(d, { privateKey: key.privateKey, kid: key.kid }) })
  await refreshSources({ home, env, keys, builtin: builtinWithDir, fetchImpl: fetchFor(moved(5)) })
  const r = await refreshSources({ home, env, keys, builtin: builtinWithDir, fetchImpl: fetchFor({ ...BUILTIN_SOURCES, seq: 3, directory: ['https://deps.example.com/sources.json'] }) })
  assert.deepEqual([r.ok, r.ok && r.updated], [true, false])
  assert.equal(loadSources({ home, env, keys, builtin: builtinWithDir }).sources.seq, 5)
})

test('no poder refrescar NO es «no hay nada nuevo»', async () => {
  const r = await refreshSources({ home: tmpHome(), env: {}, keys, builtin: builtinWithDir, fetchImpl: async () => { throw new Error('ECONNRESET') } })
  assert.equal(r.ok, false)
  assert.match(r.ok ? '' : r.reason, /ECONNRESET/)
})

test('un directorio guardado que ya no pasa la firma para, no se ignora', () => {
  const home = tmpHome()
  const file = sourcesPath({ home, env: {} })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ kid: key.kid, payload: JSON.stringify(moved()), sig: 'AAAA' }))
  assert.throws(() => loadSources({ home, env: {}, keys }), { code: 'sources-bad-signature' })
})

test('DOTRINO_SOURCES: el dueño de la máquina lo fija, sin firma', () => {
  const home = tmpHome()
  const file = path.join(home, 'mine.json')
  fs.writeFileSync(file, JSON.stringify(moved(1)))
  const r = loadSources({ home, env: { DOTRINO_SOURCES: file }, keys: {} })
  assert.equal(r.from, 'env')
  assert.throws(() => loadSources({ home, env: { DOTRINO_SOURCES: path.join(home, 'no-existe.json') } }), { code: 'sources-unreadable' })
})

test('latestVersion mira donde dice el directorio, y si el primero falla, el siguiente', async () => {
  const asked = []
  const fetchImpl = async (url) => {
    asked.push(url)
    if (url.startsWith('https://registry.npmjs.org')) throw new Error('npm is down')
    return { ok: true, json: async () => ({ latest: '2.0.0' }) }
  }
  const sources = { ...BUILTIN_SOURCES, default: { ...BUILTIN_SOURCES.default, npm: ['https://registry.npmjs.org', MIRROR] } }
  const r = await latestVersion({ source: 'npm', pkg: '@dotrino/proxy', fetchImpl, sources })
  assert.deepEqual([r.ok, r.ok && r.version, r.ok && 'registry' in r && r.registry], [true, '2.0.0', MIRROR])
  assert.equal(asked.length, 2)
})

test('verifyNpmPackage: el paquete del sitio nuevo, la medida del release, y nunca del mismo sitio', async () => {
  const PKG = '@dotrino/proxy'
  const TGZ = Buffer.from('tarball')
  const measured = { v: 1, packages: { [PKG]: { version: '2.0.0', integrity: integrityOf(TGZ) } } }
  const body = (b) => ({ ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) })
  const fetchImpl = async (url) => {
    if (url.endsWith('npm-integrity.json')) return body(Buffer.from(JSON.stringify(measured)))
    if (url === `${MIRROR}/@dotrino%2fproxy/2.0.0`) return { ok: true, json: async () => ({ dist: { tarball: 'https://deps.example.com/npm/@dotrino/proxy/-/proxy-2.0.0.tgz' } }) }
    if (url.endsWith('.tgz')) return body(TGZ)
    return { ok: false, status: 404 }
  }
  const home = tmpHome()
  const ok = await verifyNpmPackage({ pkg: PKG, version: '2.0.0', repo: 'imdotrino/dotrino-proxy', fetchImpl, home, env: {}, sources: moved() })
  assert.equal(ok.ok, true, ok.ok ? '' : ok.reason)
  assert.equal(ok.ok && ok.registry, MIRROR)
  if (ok.ok) fs.rmSync(ok.dir, { recursive: true, force: true })

  // la medida y el paquete del MISMO sitio: un canal, no dos → hace falta la firma
  const oneChannel = { ...moved(), packages: { [PKG]: { npm: [MIRROR], releases: ['https://deps.example.com/rel/{repo}/{tag}/{file}'] } } }
  const bad = await verifyNpmPackage({ pkg: PKG, version: '2.0.0', repo: 'imdotrino/dotrino-proxy', fetchImpl, home, env: {}, sources: oneChannel, sigstore: null })
  assert.equal(!bad.ok && bad.code, 'SINGLE_CHANNEL')

  // con la firma del workflow del repo, sí
  const crypto = await import('node:crypto')
  const sha256 = crypto.createHash('sha256').update(TGZ).digest('hex')
  const ISSUER = 'https://token.actions.githubusercontent.com'
  const bundleFor = (digest) => ({ dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify({ predicateType: 'https://slsa.dev/provenance/v1', subject: [{ digest: { sha256: digest } }] })).toString('base64') } })
  const lib = { verify: async () => ({ identity: { subjectAlternativeName: 'https://github.com/imdotrino/dotrino-proxy/.github/workflows/release.yml@refs/tags/v2.0.0', extensions: { issuer: ISSUER } } }) }
  const withSig = (digest) => async (url) => url.endsWith('.tgz.sigstore.json') ? { ok: true, json: async () => bundleFor(digest) } : fetchImpl(url)
  const signed = await verifyNpmPackage({ pkg: PKG, version: '2.0.0', repo: 'imdotrino/dotrino-proxy', fetchImpl: withSig(sha256), home, env: {}, sources: oneChannel, sigstore: lib })
  assert.equal(signed.ok, true, signed.ok ? '' : signed.reason)
  if (signed.ok) fs.rmSync(signed.dir, { recursive: true, force: true })
  const otherFile = await verifyNpmPackage({ pkg: PKG, version: '2.0.0', repo: 'imdotrino/dotrino-proxy', fetchImpl: withSig('00'.repeat(32)), home, env: {}, sources: oneChannel, sigstore: lib })
  assert.equal(!otherFile.ok && otherFile.code, 'BAD_SIGNATURE')
})

test('instalar desde otro registro: npm resuelve las dependencias ahí también', () => {
  const home = tmpHome()
  const root = path.join(home, 'prefix', 'lib', 'node_modules')
  const pkgDir = path.join(root, '@dotrino', 'proxy')
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '1.0.0' }))
  const calls = []
  const run = (cmd, args) => {
    calls.push(args.join(' '))
    if (args[0] === 'install') fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ version: '2.0.0' }))
    return ''
  }
  const kind = { kind: 'global', selfUpdating: true, root, prefix: path.join(home, 'prefix'), reason: '' }
  const r = installNpmGlobal({ pkg: '@dotrino/proxy', version: '2.0.0', file: '/tmp/x.tgz', registry: MIRROR, run, kind, access: () => {} })
  assert.equal(r.ok, true)
  assert.match(calls[0], new RegExp(`--registry ${MIRROR}$`))
})

test('la privada firma igual en DER base64 (el cajón) que en PEM', async () => {
  const crypto = await import('node:crypto')
  const pem = crypto.createPrivateKey({ key: Buffer.from(key.privateKey, 'base64'), format: 'der', type: 'pkcs8' }).export({ format: 'pem', type: 'pkcs8' })
  for (const privateKey of [key.privateKey, pem]) {
    assert.equal(openSources(signSources(moved(), { privateKey, kid: key.kid }), { keys }).seq, 2)
  }
})
