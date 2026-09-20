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
import { isNewer, latestVersion, checkForUpdate, watchForUpdate } from '../src/index.js'
import { pickAsset, verifyArtifact, fetchVerified } from '../src/fetch.js'

const ok = (body) => async () => ({ ok: true, json: async () => body })
const falla = (status) => async () => ({ ok: false, status })

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
  const caida = await checkForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: falla(503) })
  assert.equal(caida.ok, false)
  assert.equal('newer' in caida, false, 'sin respuesta no se opina sobre si hay versión nueva')
  assert.match(caida.reason, /503/)

  const alDia = await checkForUpdate({ current: '0.2.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }) })
  assert.deepEqual([alDia.ok, alDia.newer], [true, false])

  const hay = await checkForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }) })
  assert.deepEqual([hay.ok, hay.newer, hay.version], [true, true, '0.2.0'])
})

test('el vigía solo habla cuando hay algo que decir, y nunca lanza', async () => {
  const dichos = []
  let parar = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.2.0' }), onNewer: (r) => dichos.push(r.version) })
  await new Promise((r) => setTimeout(r, 30))
  parar()
  assert.deepEqual(dichos, ['0.2.0'])

  // Al día y caído: en los dos casos, silencio.
  for (const f of [ok({ latest: '0.1.0' }), falla(500)]) {
    const otros = []
    parar = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: f, onNewer: (r) => otros.push(r) })
    await new Promise((r) => setTimeout(r, 30))
    parar()
    assert.deepEqual(otros, [])
  }

  // Un `onNewer` que revienta no tumba al que lo llamó: esto es mantenimiento de fondo.
  parar = watchForUpdate({ current: '0.1.0', source: 'npm', pkg: 'x', fetchImpl: ok({ latest: '0.9.0' }), onNewer: () => { throw new Error('boom') } })
  await new Promise((r) => setTimeout(r, 30))
  parar()
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
test('sin gh no se verifica, y entonces no se sigue', () => {
  const r = verifyArtifact('/tmp/x.deb', { repo: 'a/b', run: () => { throw new Error('not found') } })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NO_GH')
  assert.match(r.reason, /gh attestation verify/, 'y dice cómo comprobarlo a mano')
})

test('una firma que no cuadra se dice con su código, no se traga', () => {
  const r = verifyArtifact('/tmp/x.deb', {
    repo: 'a/b',
    run: (cmd, args) => { if (args[0] === '--version') return ''; const e = new Error('x'); e.stderr = 'no attestations found'; throw e }
  })
  assert.equal(r.code, 'BAD_SIGNATURE')
  assert.match(r.reason, /no attestations found/)
})

test('bajar y verificar: si la firma falla, se DICE dónde quedó el archivo sin instalarlo', async () => {
  const asset = { name: 'x.deb', url: 'https://u' }
  const r = await fetchVerified(asset, {
    repo: 'a/b',
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('bytes').buffer }),
    run: () => { throw new Error('nope') }
  })
  assert.equal(r.ok, false)
  assert.ok(r.file, 'el archivo se dice, para poder mirarlo o borrarlo')
})
