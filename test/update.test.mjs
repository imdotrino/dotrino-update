/**
 * Lo que esta pieza promete, y sobre todo lo que promete NO hacer.
 *
 * Nada de red de verdad: el `fetch` se inyecta. Lo que se fija aquí es la frontera que da
 * sentido al paquete — mirar va solo, traer no — y que «no se pudo mirar» jamás se
 * confunda con «estás al día», que es el error que deja a una máquina dos versiones atrás
 * creyendo que está bien.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isNewer, latestVersion, checkForUpdate, watchForUpdate } from '../src/index.js'
import crypto from 'node:crypto'
import { pickAsset, verifyArtifact, fetchVerified } from '../src/fetch.js'

const ok = (body) => async () => ({ ok: true, json: async () => body })
const failing = (status) => async () => ({ ok: false, status })

test('comparar versiones: tres números, y 99 no es mayor que 100', () => {
  assert.equal(isNewer('0.123.0', '0.121.0'), true)
  assert.equal(isNewer('0.99.0', '0.100.0'), false, 'comparado como texto, «99» ganaría')
  assert.equal(isNewer('1.2.3', '1.2.3'), false)
  assert.equal(isNewer('v0.2.0', '0.1.9'), true, 'la v de la etiqueta no estorba')
  assert.equal(isNewer('nope', '1.0.0'), false, 'lo que no es una versión no compite')
})

test('npm: la última sale del dist-tag', async () => {
  const r = await latestVersion({ source: 'npm', pkg: '@dotrino/vault', fetchImpl: ok({ latest: '0.68.0' }) })
  assert.deepEqual([r.ok, r.version, r.source], [true, '0.68.0', 'npm'])
})

test('github: la última sale de la etiqueta, con sus archivos', async () => {
  const r = await latestVersion({
    source: 'github',
    repo: 'imdotrino/dotrino-vault',
    fetchImpl: ok({ tag_name: 'v0.123.0', assets: [{ name: 'x_0.123.0_amd64.deb', browser_download_url: 'https://u', size: 9 }] })
  })
  assert.equal(r.version, '0.123.0')
  assert.equal(r.assets[0].name, 'x_0.123.0_amd64.deb')
})

/**
 * EL CORAZÓN DE TODO ESTO. Una máquina que no pudo preguntar NO está al día: está sin
 * saber. Confundirlas es cómo un replicador pasa quince días atrás pareciendo sano.
 */
test('no se pudo mirar NO es estar al día', async () => {
  const down = await checkForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: failing(503) })
  assert.equal(down.ok, false)
  assert.equal('newer' in down, false, 'sin respuesta no se opina sobre si hay versión nueva')
  assert.match(down.reason, /503/)

  const upToDate = await checkForUpdate({ current: '0.2.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }) })
  assert.deepEqual([upToDate.ok, upToDate.newer], [true, false])

  const hay = await checkForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }) })
  assert.deepEqual([hay.ok, hay.newer, hay.version], [true, true, '0.2.0'])
})

test('el vigía solo habla cuando hay algo que decir, y nunca lanza', async () => {
  const told = []
  let stop = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }), onNewer: (r) => told.push(r.version) })
  await new Promise((r) => setTimeout(r, 30))
  stop()
  assert.deepEqual(told, ['0.2.0'])

  // Al día y caído: en los dos casos, silencio.
  for (const f of [ok({ latest: '0.1.0' }), failing(500)]) {
    const others = []
    stop = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: f, onNewer: (r) => others.push(r) })
    await new Promise((r) => setTimeout(r, 30))
    stop()
    assert.deepEqual(others, [])
  }

  // Un `onNewer` que revienta no tumba al que lo llamó: esto es mantenimiento de fondo.
  stop = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.9.0' }), onNewer: () => { throw new Error('boom') } })
  await new Promise((r) => setTimeout(r, 30))
  stop()
})

test('el archivo se elige por máquina, en orden de preferencia', () => {
  const assets = [{ name: 'v-0.1.0-linux-x64.tar.gz', url: 'u1' }, { name: 'v_0.1.0_amd64.deb', url: 'u2' }]
  const match = [
    { kind: 'deb', re: /_amd64\.deb$/, when: () => true },
    { kind: 'tar', re: /-linux-x64\.tar\.gz$/ }
  ]
  assert.deepEqual(pickAsset(assets, match).kind, 'deb', 'gana el primero que aplique')
  assert.deepEqual(pickAsset(assets, [{ kind: 'deb', re: /_amd64\.deb$/, when: () => false }, { kind: 'tar', re: /-linux-x64\.tar\.gz$/ }]).kind, 'tar',
    'sin dpkg se cae al tarball')
  assert.equal(pickAsset(assets, [{ kind: 'x', re: /nada/ }]).ok, false)
})

/**
 * SIN CON QUÉ VERIFICAR, NO SE INSTALA. Es la regla de «nada de repliegues» aplicada al
 * sitio donde más duele: bajar código. Que la URL fuera la correcta no prueba nada.
 */
const okFetch = (bundles) => async () => ({ ok: true, json: async () => ({ attestations: bundles.map((b) => ({ bundle: b })) }) })
const tmpFile = () => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')), 'x.deb'); fs.writeFileSync(f, 'bytes'); return f }

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
/** Una atestación como la de GitHub: un sobre in-toto de procedencia que nombra `hash`. */
const bundleFor = (hash, { predicateType = 'https://slsa.dev/provenance/v1', payloadType = 'application/vnd.in-toto+json' } = {}) => ({
  dsseEnvelope: { payloadType, payload: Buffer.from(JSON.stringify({ predicateType, subject: [{ name: 'x.deb', digest: { sha256: hash } }] })).toString('base64') }
})
/** La librería de sigstore, de mentira: da por buena la firma y dice quién firmó. */
const signedBy = (san, issuer = 'https://token.actions.githubusercontent.com') => ({
  verify: async () => ({ identity: { subjectAlternativeName: san, extensions: { issuer } } })
})
const WORKFLOW = 'https://github.com/a/b/.github/workflows/release.yml@refs/tags/v1.0.0'

test('sin la librería de sigstore no se verifica, y entonces no se sigue', async () => {
  const r = await verifyArtifact(tmpFile(), { repo: 'a/b', sigstore: null })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NO_VERIFIER')
})

test('sin atestación para ESTE archivo no se instala', async () => {
  const sigstore = signedBy(WORKFLOW)
  const r = await verifyArtifact(tmpFile(), { repo: 'a/b', sigstore, fetchImpl: okFetch([]) })
  assert.equal(r.code, 'NO_ATTESTATION')
  const down = await verifyArtifact(tmpFile(), { repo: 'a/b', sigstore, fetchImpl: async () => ({ ok: false, status: 503 }) })
  assert.equal(down.code, 'NO_ATTESTATION', 'que GitHub no conteste tampoco es «está bien»')
})

test('se verifica SIN sesión y sin gh: firma de GitHub Actions, workflow del repo y el hash de este archivo', async () => {
  const f = tmpFile()
  let requested = null
  let passed = null
  const fetchImpl = async (url, o) => { requested = { url, o }; return okFetch([bundleFor(sha(f))])() }
  const sigstore = { verify: async (bundle, opts) => { passed = { bundle, opts }; return signedBy(WORKFLOW).verify() } }
  const r = await verifyArtifact(f, { repo: 'a/b', sigstore, fetchImpl })
  assert.equal(r.ok, true)
  assert.match(requested.url, /^https:\/\/api\.github\.com\/repos\/a\/b\/attestations\/sha256:[0-9a-f]{64}$/)
  assert.equal(requested.o.headers.authorization, undefined, 'sin credenciales')
  assert.equal(passed.opts.certificateIssuer, 'https://token.actions.githubusercontent.com')
  assert.match(r.out, /workflows\/release\.yml/)
})

test('una firma que no cuadra se dice con su código, no se traga', async () => {
  const f = tmpFile()
  const bad = { verify: async () => { throw new Error('signature verification failed') } }
  const r = await verifyArtifact(f, { repo: 'a/b', sigstore: bad, fetchImpl: okFetch([bundleFor(sha(f))]) })
  assert.equal(r.code, 'BAD_SIGNATURE')
  assert.match(r.reason, /signature verification failed/)
})

test('una firma válida que no es de ESTE repo, de este archivo o de una compilación no vale', async () => {
  const f = tmpFile()
  const verifyWith = (sigstore, bundle) => verifyArtifact(f, { repo: 'a/b', sigstore, fetchImpl: okFetch([bundle]) })
  // Firmó el workflow de otro repo (uno cuyo nombre empieza igual incluido).
  for (const other of ['https://github.com/x/y/.github/workflows/release.yml@refs/tags/v1', 'https://github.com/a/bb/.github/workflows/release.yml@refs/tags/v1', '']) {
    const r = await verifyWith(signedBy(other), bundleFor(sha(f)))
    assert.equal(r.code, 'BAD_SIGNATURE', other)
    assert.match(r.reason, /not by a workflow of a\/b/)
  }
  // No la emitió GitHub Actions.
  assert.equal((await verifyWith(signedBy(WORKFLOW, 'https://accounts.google.com'), bundleFor(sha(f)))).code, 'BAD_SIGNATURE')
  // La atestación es de otro archivo.
  assert.match((await verifyWith(signedBy(WORKFLOW), bundleFor('0'.repeat(64)))).reason, /another file/)
  // No es una procedencia de compilación.
  assert.match((await verifyWith(signedBy(WORKFLOW), bundleFor(sha(f), { predicateType: 'https://spdx.dev/Document' }))).reason, /not a build provenance/)
  assert.match((await verifyWith(signedBy(WORKFLOW), bundleFor(sha(f), { payloadType: 'text/plain' }))).reason, /in-toto/)
})

test('con varias atestaciones basta una que cuadre entera', async () => {
  const f = tmpFile()
  const r = await verifyArtifact(f, { repo: 'a/b', sigstore: signedBy(WORKFLOW), fetchImpl: okFetch([bundleFor('0'.repeat(64)), bundleFor(sha(f))]) })
  assert.equal(r.ok, true)
})

test('bajar y verificar: si la firma falla, se DICE dónde quedó el archivo sin instalarlo', async () => {
  const asset = { name: 'x.deb', url: 'https://u' }
  const r = await fetchVerified(asset, {
    repo: 'a/b',
    sigstore: null,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('bytes').buffer })
  })
  assert.equal(r.ok, false)
  assert.ok(r.file, 'el archivo se dice, para poder mirarlo o borrarlo')
})

test('github con tagPrefix: la más alta de ESE producto, no la última del repo', async () => {
  const rel = (tag_name, extra = {}) => ({ tag_name, html_url: `u/${tag_name}`, assets: [{ name: `${tag_name}.deb`, browser_download_url: `d/${tag_name}`, size: 1 }], ...extra })
  let asked = ''
  const fetchImpl = async (url) => { asked = url; return { ok: true, json: async () => [rel('agent-v0.38.0'), rel('desktop-v0.2.9'), rel('desktop-v0.2.45'), rel('desktop-v0.3.0', { prerelease: true }), rel('desktop-v9.0.0', { draft: true }), rel('desktop-vnope')] } }
  const r = await latestVersion({ source: 'github', repo: 'imdotrino/dotrino-terminal', tagPrefix: 'desktop-v', fetchImpl })
  assert.match(asked, /\/releases\?per_page=100$/)
  assert.deepEqual([r.ok, r.version, r.assets[0].name], [true, '0.2.45', 'desktop-v0.2.45.deb'])
  const none = await latestVersion({ source: 'github', repo: 'imdotrino/dotrino-terminal', tagPrefix: 'web-v', fetchImpl })
  assert.equal(none.ok, false, 'sin releases de ese producto no se sabe: no es «al día»')
  const bad = await latestVersion({ source: 'github', repo: 'x/y', tagPrefix: 'desktop-v', fetchImpl: ok({ message: 'rate limited' }) })
  assert.equal(bad.ok, false)
})
