/**
 * @dotrino/update/npm — UNA PIEZA DE NPM SE ACTUALIZA SOLA, y lo que promete al hacerlo.
 *
 * Sin red y sin npm de verdad: `run` y `fetch` se inyectan. Lo que se fija es cada salida
 * del flujo por su `code` (que es lo que lee quien lo llama), que solo una instalación
 * global se toca, y que nada se instala sin haberse comprobado — ni cuando no se pudo
 * preguntar si hacía falta permiso.
 *
 * Al final, UNA prueba contra el registro y la release reales (se salta sin red).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  installKind, supervised, verifyNpmPackage, installNpmGlobal, selfUpdateNpm, watchSelfUpdateNpm, findNpm,
  readUpdatePrefs, writeUpdatePrefs, takeUpdateMarker, updatePrefsCommand, updateStatusText, UPDATE_PREFS_FILE, UPDATE_MARKER_FILE, UPDATE_ASKED_FILE, UPDATE_NEEDS_ROOT_FILE, ASK_TTL_MS
} from '../src/npm.js'
import { integrityOf, packageOfTarball, buildIntegrity } from '../src/integrity.js'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'

const PKG = '@dotrino/demo'
const REPO = 'imdotrino/dotrino-demo'
const TARBALL = Buffer.from('tarball')

/** Una máquina de mentira: un prefijo global con la pieza instalada en `current`. */
function mundo ({ current = '1.0.0', latest = '1.1.0', release = 'ok', npmInstala = true, instalaVersion = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-npm-'))
  const prefix = path.join(home, 'prefix')
  const root = path.join(prefix, 'lib', 'node_modules')
  const pkgDir = path.join(root, '@dotrino', 'demo')
  fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: PKG, version: current }))
  fs.writeFileSync(path.join(pkgDir, 'bin', 'cli.js'), '')
  const calls = []
  const run = (cmd, args) => {
    calls.push([path.basename(cmd), ...args].join(' '))
    if (cmd === 'npm') {
      if (args[0] === 'root') return root + '\n'
      if (args[0] === 'prefix') return prefix + '\n'
      if (args[0] === 'install') {
        if (!npmInstala) throw Object.assign(new Error('npm failed'), { stderr: 'EACCES something' })
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: PKG, version: instalaVersion || latest }))
        return ''
      }
    }
    return ''
  }
  // Lo que la release de GitHub dice que midió. `release` elige qué pasa con ese archivo.
  const medido = {
    ok: { v: 1, packages: { [PKG]: { version: latest, integrity: integrityOf(TARBALL) } } },
    otroHash: { v: 1, packages: { [PKG]: { version: latest, integrity: integrityOf(Buffer.from('otra cosa')) } } },
    otraVersion: { v: 1, packages: { [PKG]: { version: '9.9.9', integrity: integrityOf(TARBALL) } } },
    otroPaquete: { v: 1, packages: { '@dotrino/otro': { version: latest, integrity: integrityOf(TARBALL) } } },
    sinForma: { hola: 1 }
  }[release]
  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(url)
    const json = (body) => ({ ok: true, json: async () => body })
    if (url.includes('/dist-tags')) return latest ? json({ latest }) : { ok: false, status: 503 }
    if (url === `https://github.com/${REPO}/releases/download/v${latest}/npm-integrity.json`) {
      if (release === '404') return { ok: false, status: 404 }
      if (release === '500') return { ok: false, status: 500 }
      if (release === 'caida') throw new Error('ECONNRESET')
      const body = release === 'enorme' ? Buffer.alloc(70 * 1024, 0x20) : release === 'basura' ? Buffer.from('<html>') : Buffer.from(JSON.stringify(medido))
      return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }
    }
    if (url.endsWith('.tgz')) return { ok: true, arrayBuffer: async () => TARBALL.buffer.slice(TARBALL.byteOffset, TARBALL.byteOffset + TARBALL.byteLength) }
    if (url.endsWith(`/${latest}`)) return json({ dist: { tarball: `https://registry.npmjs.org/@dotrino/demo/-/demo-${latest}.tgz` } })
    return { ok: false, status: 404 }
  }
  const lines = []
  return {
    home, root, prefix, calls, fetched, lines,
    opts: {
      pkg: PKG, current, repo: REPO, entry: path.join(pkgDir, 'bin', 'cli.js'),
      run, fetchImpl, npm: 'npm', home, env: {}, log: (m) => lines.push(m)
    },
    instalada: () => JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version,
    trabajo: () => { const d = path.join(home, '.local', 'share', 'dotrino', 'update'); return fs.existsSync(d) ? fs.readdirSync(d) : [] }
  }
}
const instalo = (m) => m.calls.some((c) => c.startsWith('npm install'))

// --- cómo está instalada ---------------------------------------------------------------

test('solo lo que cuelga del prefijo global se actualiza solo; lo demás dice por qué', () => {
  const m = mundo()
  const { run } = m.opts
  const g = installKind({ entry: m.opts.entry, run, npm: 'npm' })
  assert.deepEqual([g.kind, g.selfUpdating, g.root, g.prefix], ['global', true, m.root, m.prefix])

  const npx = installKind({ entry: path.join(m.home, '.npm', '_npx', 'abc', 'node_modules', '@dotrino', 'demo', 'bin', 'cli.js'), run, npm: 'npm' })
  assert.deepEqual([npx.kind, npx.selfUpdating], ['npx', false])
  assert.match(npx.reason, /npx/)

  const local = installKind({ entry: path.join(m.home, 'proyecto', 'node_modules', '@dotrino', 'demo', 'bin', 'cli.js'), run, npm: 'npm' })
  assert.deepEqual([local.kind, local.selfUpdating], ['local', false])

  const src = installKind({ entry: path.join(m.home, 'repo', 'bin', 'cli.js'), run, npm: 'npm' })
  assert.deepEqual([src.kind, src.selfUpdating], ['source', false])
  assert.match(src.reason, /git/)
})

test('un enlace en el bin global se resuelve a donde vive de verdad', () => {
  const m = mundo()
  const link = path.join(m.prefix, 'bin', 'dotrino-demo')
  fs.symlinkSync(m.opts.entry, link)
  assert.equal(installKind({ entry: link, run: m.opts.run, npm: 'npm' }).kind, 'global')
})

test('si npm no contesta no se supone nada: no se actualiza sola', () => {
  const m = mundo()
  const k = installKind({ entry: m.opts.entry, run: () => { throw new Error('ENOENT') }, npm: 'npm' })
  assert.deepEqual([k.kind, k.selfUpdating], ['local', false], 'cuelga de un node_modules y nada dice que sea el global')
})

test('npm tacha de su salida lo que le parece un secreto (un UUID en la ruta): se reconoce igual', () => {
  const m = mundo()
  const tachado = m.root.replace(path.basename(m.home), '***')
  assert.notEqual(tachado, m.root)
  const k = installKind({ entry: m.opts.entry, run: () => tachado + '\n', npm: 'npm' })
  assert.deepEqual([k.kind, k.root, k.prefix], ['global', m.root, m.prefix], 'la carpeta sale de la ruta real, no de lo que imprime npm')
  const otro = installKind({ entry: m.opts.entry, run: () => '/usr/lib/node_modules\n', npm: 'npm' })
  assert.equal(otro.kind, 'local', 'y otra raíz global no cuela')
})

test('hay quien lo levante: systemd, pm2, o quien lo lanza lo dice', () => {
  assert.equal(supervised({ env: {} }), false)
  assert.equal(supervised({ env: { INVOCATION_ID: 'abc' } }), true)
  assert.equal(supervised({ env: { pm_id: '0' } }), true)
  assert.equal(supervised({ env: { DOTRINO_SUPERVISED: '1' } }), true)
})

test('el npm es el del mismo Node que corre la pieza', () => {
  assert.equal(findNpm({ execPath: '/opt/node/bin/node', platform: 'linux', exists: () => true }), '/opt/node/bin/npm')
  assert.equal(findNpm({ execPath: '/opt/node/bin/node', platform: 'linux', exists: () => false }), 'npm')
})

// --- verificar -------------------------------------------------------------------------

test('verificar: el hash viene de la release de GitHub, el archivo de npm, y tienen que coincidir', async () => {
  const m = mundo()
  const v = await verifyNpmPackage({ ...m.opts, version: '1.1.0' })
  assert.equal(v.ok, true)
  assert.equal(v.integrity, integrityOf(TARBALL))
  assert.equal(fs.readFileSync(v.file, 'utf8'), 'tarball', 'devuelve ESE archivo, para instalar ese y no otro')
  assert.ok(v.file.startsWith(path.join(m.home, '.local', 'share', 'dotrino', 'update')), 'en el disco del usuario, no en /tmp')
  assert.ok(m.fetched.includes(`https://github.com/${REPO}/releases/download/v1.1.0/npm-integrity.json`))
  assert.equal(m.calls.some((c) => c.startsWith('gh')), false, 'sin gh')
  fs.rmSync(v.dir, { recursive: true })
})

for (const [nombre, release, code] of [
  ['la release no trae el archivo', '404', 'NO_INTEGRITY_FILE'],
  ['GitHub contesta un error', '500', 'INTEGRITY_UNREACHABLE'],
  ['GitHub no contesta', 'caida', 'INTEGRITY_UNREACHABLE'],
  ['el archivo no es JSON', 'basura', 'INTEGRITY_UNREACHABLE'],
  ['el archivo no tiene la forma', 'sinForma', 'INTEGRITY_UNREACHABLE'],
  ['el archivo pesa lo que no pesa un JSON de hashes', 'enorme', 'INTEGRITY_UNREACHABLE'],
  ['el archivo nombra otro paquete', 'otroPaquete', 'WRONG_PACKAGE'],
  ['el archivo nombra otra versión', 'otraVersion', 'WRONG_PACKAGE'],
  ['lo que da npm no es lo que midió el release', 'otroHash', 'INTEGRITY_MISMATCH']
]) {
  test(`verificar, cuando ${nombre}: no vale, lo dice con su código y no deja nada en el disco`, async () => {
    const m = mundo({ release })
    const v = await verifyNpmPackage({ ...m.opts, version: '1.1.0' })
    assert.deepEqual([v.ok, v.code], [false, code], v.reason)
    assert.ok(v.reason)
    assert.deepEqual(m.trabajo(), [], 'la carpeta de trabajo se borra')
  })
}

test('verificar: el registro no contesta, señala un tarball fuera del registro, o no entrega el archivo', async () => {
  const m = mundo()
  const gh = (u) => u.startsWith('https://github.com/')
  const caido = await verifyNpmPackage({ ...m.opts, version: '1.1.0', fetchImpl: async (u) => gh(u) ? m.opts.fetchImpl(u) : { ok: false, status: 503 } })
  assert.equal(caido.code, 'REGISTRY_UNREACHABLE')
  const fuera = await verifyNpmPackage({
    ...m.opts, version: '1.1.0',
    fetchImpl: async (u) => gh(u) ? m.opts.fetchImpl(u) : { ok: true, json: async () => ({ dist: { tarball: 'https://evil.example/demo.tgz' } }) }
  })
  assert.equal(fuera.code, 'REGISTRY_UNREACHABLE')
  const sinArchivo = await verifyNpmPackage({ ...m.opts, version: '1.1.0', fetchImpl: async (u) => u.endsWith('.tgz') ? { ok: false, status: 502 } : m.opts.fetchImpl(u) })
  assert.equal(sinArchivo.code, 'DOWNLOAD_FAILED')
  assert.deepEqual(m.trabajo(), [])
  assert.equal((await verifyNpmPackage({ pkg: PKG })).code, 'BAD_ARGS')
})

// --- el lado de CI: medir lo que se va a publicar ----------------------------------------

/** Un `.tgz` mínimo como los de `npm pack`: una cabecera de tar y el package.json. */
function tgz (files) {
  const blocks = []
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text)
    const head = Buffer.alloc(512)
    head.write(name, 0, 'utf8')
    head.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii')
    head.write('0', 156, 'ascii')
    blocks.push(head, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(blocks))
}

test('CI: de cada .tgz sale su nombre, su versión y su sha512, que es el `integrity` de npm', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-ci-'))
  const a = tgz({ 'package/README.md': 'hola', 'package/package.json': JSON.stringify({ name: '@dotrino/demo', version: '1.1.0' }) })
  const b = tgz({ 'package/package.json': JSON.stringify({ name: '@dotrino/otro', version: '0.3.0' }) })
  fs.writeFileSync(path.join(dir, 'a.tgz'), a); fs.writeFileSync(path.join(dir, 'b.tgz'), b)
  assert.deepEqual(packageOfTarball(a), { name: '@dotrino/demo', version: '1.1.0' })
  assert.deepEqual(buildIntegrity([path.join(dir, 'a.tgz'), path.join(dir, 'b.tgz')]), {
    v: 1,
    packages: {
      '@dotrino/demo': { version: '1.1.0', integrity: integrityOf(a) },
      '@dotrino/otro': { version: '0.3.0', integrity: integrityOf(b) }
    }
  })
  assert.match(integrityOf(a), /^sha512-[A-Za-z0-9+/]{86}==$/)
  assert.throws(() => buildIntegrity([path.join(dir, 'a.tgz'), path.join(dir, 'a.tgz')]), (e) => e.code === 'duplicate-package')
  assert.throws(() => buildIntegrity([]), (e) => e.code === 'no-files')
  assert.throws(() => packageOfTarball(Buffer.from('no es gzip')), (e) => e.code === 'bad-tarball')
  assert.throws(() => packageOfTarball(tgz({ 'package/index.js': 'x' })), (e) => e.code === 'bad-tarball')
})

test('CI: el comando imprime el JSON, y lo que mide es lo que comprueba quien instala', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-cli-'))
  const f = path.join(dir, 'demo-1.1.0.tgz')
  fs.writeFileSync(f, tgz({ 'package/package.json': JSON.stringify({ name: PKG, version: '1.1.0' }) }))
  const cli = new URL('../bin/cli.js', import.meta.url).pathname
  const out = JSON.parse(execFileSync(process.execPath, [cli, 'integrity', f], { encoding: 'utf8' }))
  assert.deepEqual(out, { v: 1, packages: { [PKG]: { version: '1.1.0', integrity: integrityOf(fs.readFileSync(f)) } } })
  assert.throws(() => execFileSync(process.execPath, [cli, 'integrity'], { stdio: 'pipe' }), (e) => e.status === 2)
  assert.throws(() => execFileSync(process.execPath, [cli, 'integrity', path.join(dir, 'no-existe.tgz')], { stdio: 'pipe' }), (e) => e.status === 1)
})

// --- instalar --------------------------------------------------------------------------

test('instalar: sin lifecycle scripts, y se mira que quedó la versión pedida', () => {
  const m = mundo()
  const r = installNpmGlobal({ pkg: PKG, version: '1.1.0', file: '/x/demo-1.1.0.tgz', run: m.opts.run, npm: 'npm', entry: m.opts.entry })
  assert.deepEqual(r, { ok: true, version: '1.1.0' })
  assert.ok(m.calls.includes('npm install -g /x/demo-1.1.0.tgz --ignore-scripts --no-fund --no-audit'), 'instala EL ARCHIVO comprobado')

  const otra = mundo({ instalaVersion: '1.0.5' })
  const mal = installNpmGlobal({ pkg: PKG, version: '1.1.0', run: otra.opts.run, npm: 'npm', entry: otra.opts.entry })
  assert.deepEqual([mal.ok, mal.code], [false, 'install-failed'], 'npm dijo que sí y quedó otra versión')

  const roto = mundo({ npmInstala: false })
  assert.equal(installNpmGlobal({ pkg: PKG, version: '1.1.0', run: roto.opts.run, npm: 'npm', entry: roto.opts.entry }).code, 'install-failed')
})

test('instalar: si el prefijo no es de este usuario, hace falta root y NO se intenta', () => {
  const m = mundo()
  const r = installNpmGlobal({ pkg: PKG, version: '1.1.0', run: m.opts.run, npm: 'npm', entry: m.opts.entry, access: () => { throw new Error('EACCES') } })
  assert.deepEqual([r.ok, r.code], [false, 'needs-root'])
  assert.match(r.reason, /sudo npm install -g @dotrino\/demo@1\.1\.0/)
  assert.equal(instalo(m), false)
})

// --- el flujo entero -------------------------------------------------------------------

test('POR DEFECTO se actualiza sola: sin `mayUpdate` no pregunta a nadie, verifica e instala', async () => {
  const m = mundo()
  const avisos = []
  const r = await selfUpdateNpm({ ...m.opts, onInstalled: (e) => avisos.push(e) })
  assert.deepEqual(r, { ok: true, code: 'installed', version: '1.1.0', from: '1.0.0' })
  assert.equal(m.instalada(), '1.1.0')
  assert.deepEqual(avisos, [{ version: '1.1.0', from: '1.0.0', restart: false }], 'sin quien lo levante NO se le dice que salga')
  assert.ok(m.fetched.findIndex((u) => u.endsWith('npm-integrity.json')) !== -1, 'se comprobó contra la release')
  assert.match(m.calls.find((c) => c.startsWith('npm install')), /demo-1\.1\.0\.tgz/, 'y se instala el archivo comprobado')
  assert.deepEqual(m.trabajo(), [], 'no deja nada en el disco')
  assert.match(m.lines.at(-1), /restart it to run the new version/)
})

test('con quien lo levante, avisa de que hay que reiniciar', async () => {
  const m = mundo()
  const avisos = []
  const r = await selfUpdateNpm({ ...m.opts, env: { INVOCATION_ID: 'x' }, onInstalled: (e) => avisos.push(e) })
  assert.equal(r.code, 'installed-restart')
  assert.equal(avisos[0].restart, true)
})

test('al día no hace nada; y una versión que no se entiende no es «al día»', async () => {
  const m = mundo({ current: '1.1.0' })
  assert.deepEqual(await selfUpdateNpm(m.opts), { ok: true, code: 'up-to-date', version: '1.1.0' })
  assert.equal(instalo(m), false)
  const raro = await selfUpdateNpm({ ...m.opts, current: 'dev' })
  assert.deepEqual([raro.ok, raro.code], [false, 'could-not-check'])
})

test('no se pudo mirar no es «al día»', async () => {
  const m = mundo({ latest: null })
  const r = await selfUpdateNpm(m.opts)
  assert.deepEqual([r.ok, r.code], [false, 'could-not-check'])
  assert.match(r.reason, /503/)
})

test('lo que no es una instalación global no se toca, y dice qué hacer', async () => {
  const m = mundo()
  let preguntado = false
  const r = await selfUpdateNpm({ ...m.opts, entry: path.join(m.home, 'repo', 'bin', 'cli.js'), mayUpdate: () => { preguntado = true; return true } })
  assert.deepEqual([r.ok, r.code, r.kind, r.version], [false, 'not-self-updating', 'source', '1.1.0'])
  assert.equal(preguntado, false, 'ni se pide permiso para algo que no va a pasar')
  assert.equal(instalo(m), false)
})

test('si hace falta root se dice ANTES de pedir permiso, y no se intenta', async () => {
  const m = mundo()
  let preguntado = false
  const r = await selfUpdateNpm({ ...m.opts, access: () => { throw new Error('EACCES') }, mayUpdate: () => { preguntado = true; return true } })
  assert.deepEqual([r.ok, r.code], [false, 'needs-root'])
  assert.equal(preguntado, false)
  assert.equal(instalo(m), false)
})

test('CON APROBACIÓN: se pregunta con la versión, y solo un sí exacto instala', async () => {
  const m = mundo()
  const visto = []
  const si = await selfUpdateNpm({ ...m.opts, mayUpdate: async (q) => { visto.push(q); return true } })
  assert.equal(si.code, 'installed')
  assert.deepEqual(visto, [{ pkg: PKG, version: '1.1.0', from: '1.0.0' }])

  for (const respuesta of [false, undefined, 'yes', 1]) {
    const n = mundo()
    const r = await selfUpdateNpm({ ...n.opts, mayUpdate: async () => respuesta })
    assert.deepEqual([r.ok, r.code], [false, 'not-approved'], `«${respuesta}» no es un sí`)
    assert.equal(instalo(n), false)
    assert.equal(n.fetched.some((u) => u.endsWith('.tgz') || u.endsWith('npm-integrity.json')), false, 'ni se baja nada')
  }
})

test('si no se pudo preguntar NO se instala: no saber si hace falta permiso no es tener permiso', async () => {
  const m = mundo()
  const r = await selfUpdateNpm({ ...m.opts, mayUpdate: async () => { throw Object.assign(new Error('the vault did not reply'), { code: 'vault-no-reply' }) } })
  assert.deepEqual([r.ok, r.code, r.why], [false, 'could-not-ask', 'vault-no-reply'])
  assert.equal(instalo(m), false)
  assert.match(m.lines.at(-1), /not updating/)
})

test('lo que no se pudo comprobar no se instala, con el porqué', async () => {
  for (const [world, why] of [[{ release: '404' }, 'NO_INTEGRITY_FILE'], [{ release: 'caida' }, 'INTEGRITY_UNREACHABLE'], [{ release: 'otroHash' }, 'INTEGRITY_MISMATCH'], [{ release: 'otroPaquete' }, 'WRONG_PACKAGE']]) {
    const m = mundo(world)
    const r = await selfUpdateNpm(m.opts)
    assert.deepEqual([r.ok, r.code, r.why], [false, 'unverified', why])
    assert.equal(instalo(m), false)
    assert.equal(m.instalada(), '1.0.0')
  }
})

test('si npm falla al instalar se dice, y no se avisa de reiniciar', async () => {
  const m = mundo({ npmInstala: false })
  let avisado = false
  const r = await selfUpdateNpm({ ...m.opts, env: { INVOCATION_ID: 'x' }, onInstalled: () => { avisado = true } })
  assert.deepEqual([r.ok, r.code], [false, 'install-failed'])
  assert.equal(avisado, false)
  assert.deepEqual(m.trabajo(), [], 'y el tarball se borra igual')
})

// --- el vigía --------------------------------------------------------------------------

test('el vigía mira al arrancar, y si no pudo mirar reintenta pronto y lo dice una vez', async () => {
  const m = mundo({ latest: null })
  const vistos = []
  const stop = watchSelfUpdateNpm({ ...m.opts, everyMs: 60_000, retryMs: 15, onResult: (r) => vistos.push(r.code) })
  await new Promise((r) => setTimeout(r, 120))
  stop()
  assert.ok(vistos.length >= 3, `reintentó (${vistos.length} veces)`)
  assert.ok(vistos.every((c) => c === 'could-not-check'))
  assert.equal(m.lines.filter((l) => /could not check/.test(l)).length, 1, 'el mismo motivo se dice una sola vez')
  const n = vistos.length
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(vistos.length, n, 'parado, no mira más')
})

test('el vigía instala lo que encuentra y entrega el resultado', async () => {
  const m = mundo()
  const vistos = []
  const stop = watchSelfUpdateNpm({ ...m.opts, everyMs: 60_000, onResult: (r) => vistos.push(r.code) })
  await new Promise((r) => setTimeout(r, 80))
  stop()
  assert.deepEqual(vistos, ['installed'])
  assert.equal(m.instalada(), '1.1.0')
})

// --- las preferencias de cada instancia --------------------------------------------------

const carpeta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-prefs-'))

test('preferencias: por defecto se actualiza sola y avisa; se cambia una sin tocar la otra', () => {
  const dir = carpeta()
  assert.deepEqual(readUpdatePrefs(dir), { approval: false, notify: true })
  assert.deepEqual(writeUpdatePrefs(dir, { notify: false }), { approval: false, notify: false })
  assert.deepEqual(writeUpdatePrefs(dir, { approval: true }), { approval: true, notify: false }, 'lo que no se pasa queda como estaba')
  assert.deepEqual(readUpdatePrefs(dir), { approval: true, notify: false })
  assert.equal(fs.statSync(path.join(dir, UPDATE_PREFS_FILE)).mode & 0o777, 0o600)
  assert.throws(() => writeUpdatePrefs(dir, { notify: 'off' }), (e) => e.code === 'bad-pref')
  assert.throws(() => writeUpdatePrefs(dir, {}), (e) => e.code === 'bad-pref')
  assert.throws(() => writeUpdatePrefs(dir, { otra: true }), (e) => e.code === 'bad-pref')
})

test('preferencias ilegibles no son «las de por defecto»: se lanza, y tampoco se pisan a ciegas', () => {
  const dir = carpeta()
  for (const basura of ['', 'no es json', '{"notify":true}', '{"approval":"si","notify":true}']) {
    fs.writeFileSync(path.join(dir, UPDATE_PREFS_FILE), basura)
    assert.throws(() => readUpdatePrefs(dir), (e) => e.code === 'prefs-unreadable', JSON.stringify(basura))
    assert.throws(() => writeUpdatePrefs(dir, { notify: false }), (e) => e.code === 'prefs-unreadable')
  }
})

test('CLI: sin argumentos enseña las dos; con bandera guarda o dice cómo está, en es y en en', () => {
  const dir = carpeta()
  assert.deepEqual(updatePrefsCommand([], { dir }), {
    handled: true, ok: true, prefs: { approval: false, notify: true },
    text: 'Este agente se actualiza solo, sin pedir aprobación.\nEste agente avisa cuando se actualiza.'
  })
  const on = updatePrefsCommand(['--approval', 'on'], { dir })
  assert.deepEqual([on.ok, on.text, on.prefs.approval], [true, 'Este agente pide aprobación antes de actualizarse.', true])
  assert.equal(updatePrefsCommand(['--approval'], { dir }).text, 'Este agente pide aprobación antes de actualizarse.', 'sin valor dice cómo está')
  assert.equal(updatePrefsCommand(['--notify', 'off'], { dir, lang: 'en' }).text, 'This agent does not tell you when it updates.')
  const dos = updatePrefsCommand(['--approval', 'off', '--notify', 'on'], { dir, lang: 'en' })
  assert.equal(dos.text, 'This agent updates on its own, without asking for approval.\nThis agent tells you when it updates.')
  assert.deepEqual(readUpdatePrefs(dir), { approval: false, notify: true })
  const mal = updatePrefsCommand(['--notify', 'quizas'], { dir })
  assert.deepEqual([mal.handled, mal.ok], [true, false])
  assert.match(mal.text, /--approval \[on\|off\]/)
  assert.equal(updatePrefsCommand(['--otra-cosa'], { dir }).handled, false, 'lo que no es para esto no se atiende')
  fs.writeFileSync(path.join(dir, UPDATE_PREFS_FILE), 'basura')
  const roto = updatePrefsCommand(['--notify', 'on'], { dir })
  assert.deepEqual([roto.handled, roto.ok], [true, false])
  assert.match(roto.text, /No se pudieron leer/)
})

test('APROBACIÓN POR INSTANCIA: apagada no pregunta aunque haya a quién; encendida, sin un sí no instala', async () => {
  const off = mundo(); const d1 = carpeta()
  let preguntado = false
  const r1 = await selfUpdateNpm({ ...off.opts, dir: d1, mayUpdate: () => { preguntado = true; return false } })
  assert.equal(r1.code, 'installed', 'por defecto se instala')
  assert.equal(preguntado, false, 'y no se llama a mayUpdate')

  const on = mundo(); const d2 = carpeta(); writeUpdatePrefs(d2, { approval: true })
  const no = await selfUpdateNpm({ ...on.opts, dir: d2, mayUpdate: async () => false })
  assert.deepEqual([no.ok, no.code], [false, 'not-approved'])
  assert.equal(instalo(on), false)
  const d3 = carpeta(); writeUpdatePrefs(d3, { approval: true })
  const si = await selfUpdateNpm({ ...mundo().opts, dir: d3, mayUpdate: async () => true })
  assert.equal(si.code, 'installed')
})

test('encendida y sin a quién preguntar, o con las preferencias rotas: no se instala y se dice', async () => {
  const m = mundo(); const dir = carpeta(); writeUpdatePrefs(dir, { approval: true })
  const nadie = await selfUpdateNpm({ ...m.opts, dir })
  assert.deepEqual([nadie.ok, nadie.code], [false, 'no-approver'])
  const cae = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async () => { throw new Error('the vault did not reply') } })
  assert.deepEqual([cae.ok, cae.code], [false, 'could-not-ask'])
  fs.writeFileSync(path.join(dir, UPDATE_PREFS_FILE), 'basura')
  const roto = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async () => true })
  assert.deepEqual([roto.ok, roto.code], [false, 'prefs-unreadable'])
  assert.equal(instalo(m), false)
  assert.match(m.lines.at(-1), /not updating/)
})

// --- el permiso se pide UNA vez por versión ----------------------------------------------

const conAprobacion = () => { const dir = carpeta(); writeUpdatePrefs(dir, { approval: true }); return dir }

test('negado (o vencido) no se vuelve a pedir para esa versión, y el estado lo dice', async () => {
  const m = mundo(); const dir = conAprobacion()
  let veces = 0
  const mayUpdate = async () => { veces++; return false }
  const t0 = Date.UTC(2026, 9, 8, 12)
  const r1 = await selfUpdateNpm({ ...m.opts, dir, mayUpdate, now: () => t0 })
  assert.deepEqual([r1.code, r1.askedAt], ['not-approved', t0])
  for (const despues of [t0 + 60_000, t0 + 3 * ASK_TTL_MS]) {
    const r = await selfUpdateNpm({ ...m.opts, dir, mayUpdate, now: () => despues })
    assert.deepEqual([r.ok, r.code, r.askedAt], [false, 'already-declined', t0], 'ni al rato ni al día siguiente')
  }
  assert.equal(veces, 1, 'se preguntó UNA vez')
  assert.equal(instalo(m), false)
  assert.equal(updateStatusText({ dir, current: '1.0.0' }),
    'se pidió permiso para instalar la 1.1.0 el 2026-10-08 y no se aprobó: no se vuelve a pedir · instálala con: npm i -g @dotrino/demo@1.1.0')
  assert.match(updateStatusText({ dir, current: '1.0.0', lang: 'en' }), /approval to install 1\.1\.0 was asked on 2026-10-08 and not given: it will not ask again · install it with: npm i -g @dotrino\/demo@1\.1\.0/)
  assert.equal(updateStatusText({ dir, current: '1.1.0' }), '', 'ya instalada a mano: nada que decir')
})

test('una versión MÁS NUEVA dispara otro pedido', async () => {
  const dir = conAprobacion()
  const pedidas = []
  const mayUpdate = async ({ version }) => { pedidas.push(version); return false }
  await selfUpdateNpm({ ...mundo({ latest: '1.1.0' }).opts, dir, mayUpdate })
  await selfUpdateNpm({ ...mundo({ latest: '1.1.0' }).opts, dir, mayUpdate })
  const m = mundo({ latest: '1.2.0' })
  await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async ({ version }) => { pedidas.push(version); return true } })
  assert.deepEqual(pedidas, ['1.1.0', '1.2.0'])
  assert.equal(m.instalada(), '1.2.0')
  assert.equal(fs.existsSync(path.join(dir, UPDATE_ASKED_FILE)), false, 'instalada, el apunte se borra')
})

test('se apunta AL PEDIR: un reinicio con el pedido a medias cuenta como ya preguntada', async () => {
  const m = mundo(); const dir = conAprobacion()
  let apuntado = null
  const t0 = Date.UTC(2026, 9, 8, 12)
  // El proceso «muere» esperando: la promesa no se resuelve nunca.
  selfUpdateNpm({ ...m.opts, dir, now: () => t0, mayUpdate: () => { apuntado = JSON.parse(fs.readFileSync(path.join(dir, UPDATE_ASKED_FILE), 'utf8')); return new Promise(() => {}) } })
  await new Promise((r) => setTimeout(r, 30))
  assert.deepEqual([apuntado.version, apuntado.result, apuntado.askedAt], ['1.1.0', 'pending', t0])
  // Arranca de nuevo.
  let veces = 0
  const r = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async () => { veces++; return true } })
  assert.deepEqual([r.code, veces], ['already-declined', 0])
  assert.match(updateStatusText({ dir, current: '1.0.0', now: () => t0 + 60_000 }), /espera tu respuesta/)
  assert.match(updateStatusText({ dir, current: '1.0.0', now: () => t0 + ASK_TTL_MS + 1 }), /no se aprobó/, 'pasado un día se da por negado')
})

test('un fallo de transporte NO es una negativa: no se apunta nada y se vuelve a preguntar', async () => {
  const m = mundo(); const dir = conAprobacion()
  let veces = 0
  const caida = async () => { veces++; throw Object.assign(new Error('the vault did not reply'), { code: 'vault-no-reply' }) }
  const r1 = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: caida })
  assert.deepEqual([r1.code, r1.why], ['could-not-ask', 'vault-no-reply'])
  assert.equal(fs.existsSync(path.join(dir, UPDATE_ASKED_FILE)), false)
  assert.equal(updateStatusText({ dir, current: '1.0.0' }), '')
  await selfUpdateNpm({ ...m.opts, dir, mayUpdate: caida })
  const r3 = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async () => { veces++; return true } })
  assert.deepEqual([r3.code, veces], ['installed', 3], 'se preguntó en cada pasada hasta que hubo respuesta')
})

test('un sí también se recuerda: si la instalación falla, no se vuelve a molestar', async () => {
  const dir = conAprobacion()
  let veces = 0
  const mayUpdate = async () => { veces++; return true }
  const roto = mundo({ release: 'otroHash' })
  assert.equal((await selfUpdateNpm({ ...roto.opts, dir, mayUpdate })).code, 'unverified')
  assert.equal(updateStatusText({ dir, current: '1.0.0' }), '', 'aprobada: no hay nada que reclamar')
  const bien = mundo()
  assert.equal((await selfUpdateNpm({ ...bien.opts, dir, mayUpdate })).code, 'installed')
  assert.equal(veces, 1)
})

test('si lo ya preguntado no se puede leer, no se instala y se dice', async () => {
  const m = mundo(); const dir = conAprobacion()
  fs.writeFileSync(path.join(dir, UPDATE_ASKED_FILE), 'basura')
  let veces = 0
  const r = await selfUpdateNpm({ ...m.opts, dir, mayUpdate: async () => { veces++; return true } })
  assert.deepEqual([r.ok, r.code, veces], [false, 'asked-unreadable', 0])
  assert.equal(instalo(m), false)
  assert.match(updateStatusText({ dir, current: '1.0.0' }), /no se pudo leer/)
})

// --- hace falta root: se avisa, no se intenta --------------------------------------------

const sinPermiso = () => { throw new Error('EACCES') }

test('hace falta root: se avisa UNA vez por versión, sobrevive al reinicio, y el estado lo dice', async () => {
  const dir = carpeta(); const avisos = []
  const onNeedsRoot = (e) => avisos.push(e)
  for (let i = 0; i < 3; i++) {
    const m = mundo()
    const r = await selfUpdateNpm({ ...m.opts, dir, access: sinPermiso, onNeedsRoot })
    assert.deepEqual([r.ok, r.code], [false, 'needs-root'], 'el resultado sigue siendo needs-root')
    assert.equal(instalo(m), false)
  }
  assert.deepEqual(avisos, [{ version: '1.1.0', from: '1.0.0' }], 'tres pasadas (tres arranques), un aviso')
  assert.equal(updateStatusText({ dir, current: '1.0.0' }),
    'hay una 1.1.0 publicada y esta instalación necesita permisos de administrador para actualizarse: instálala a mano (sudo npm i -g @dotrino/demo@1.1.0)')
  assert.match(updateStatusText({ dir, current: '1.0.0', lang: 'en' }), /1\.1\.0 is out and this install needs administrator rights to update: install it by hand/)
  assert.equal(updateStatusText({ dir, current: '1.1.0' }), '', 'instalada a mano: nada que decir')

  await selfUpdateNpm({ ...mundo({ latest: '1.2.0' }).opts, dir, access: sinPermiso, onNeedsRoot })
  assert.deepEqual(avisos.map((a) => a.version), ['1.1.0', '1.2.0'], 'una versión más nueva vuelve a avisar')
})

test('hace falta root con los avisos apagados: no avisa, pero el estado lo sigue diciendo', async () => {
  const dir = carpeta(); writeUpdatePrefs(dir, { notify: false })
  let avisado = false
  await selfUpdateNpm({ ...mundo().opts, dir, access: sinPermiso, onNeedsRoot: () => { avisado = true } })
  assert.equal(avisado, false)
  assert.match(updateStatusText({ dir, current: '1.0.0' }), /necesita permisos de administrador/)
  // Y si después los enciende, avisa: de esa versión todavía no se dijo nada.
  writeUpdatePrefs(dir, { notify: true })
  await selfUpdateNpm({ ...mundo().opts, dir, access: sinPermiso, onNeedsRoot: () => { avisado = true } })
  assert.equal(avisado, true)
})

test('hace falta root y avisar falla: no queda como avisado, se reintenta y se registra', async () => {
  const dir = carpeta()
  const m = mundo()
  const r = await selfUpdateNpm({ ...m.opts, dir, access: sinPermiso, onNeedsRoot: async () => { throw new Error('the vault did not reply') } })
  assert.equal(r.code, 'needs-root')
  assert.ok(m.lines.some((l) => /could not tell that @dotrino\/demo 1\.1\.0 needs root to install \(the vault did not reply\)/.test(l)))
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, UPDATE_NEEDS_ROOT_FILE), 'utf8')).notified, false)
  const avisos = []
  await selfUpdateNpm({ ...mundo().opts, dir, access: sinPermiso, onNeedsRoot: (e) => avisos.push(e) })
  await selfUpdateNpm({ ...mundo().opts, dir, access: sinPermiso, onNeedsRoot: (e) => avisos.push(e) })
  assert.equal(avisos.length, 1)
})

test('hace falta root: el vigía pasa el aviso, y al instalarse por fin el apunte se borra', async () => {
  const dir = carpeta(); const avisos = []
  const m = mundo()
  const stop = watchSelfUpdateNpm({ ...m.opts, dir, access: sinPermiso, everyMs: 60_000, onNeedsRoot: (e) => avisos.push(e) })
  await new Promise((r) => setTimeout(r, 60)); stop()
  assert.equal(avisos.length, 1)
  await selfUpdateNpm({ ...mundo().opts, dir })
  assert.equal(fs.existsSync(path.join(dir, UPDATE_NEEDS_ROOT_FILE)), false)
})

// --- avisar de que se actualizó ----------------------------------------------------------

test('al instalar queda el marcador, y solo lo recoge la versión que se instaló', async () => {
  const m = mundo(); const dir = carpeta()
  await selfUpdateNpm({ ...m.opts, dir, now: () => 1234 })
  const escrito = JSON.parse(fs.readFileSync(path.join(dir, UPDATE_MARKER_FILE), 'utf8'))
  assert.deepEqual([escrito.from, escrito.to, escrito.at, escrito.pkg], ['1.0.0', '1.1.0', 1234, PKG])

  assert.equal(takeUpdateMarker({ dir, current: '1.0.0' }), null, 'todavía corre la vieja: no ha ocurrido')
  assert.ok(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), 'y el marcador espera al próximo arranque')
  assert.deepEqual(takeUpdateMarker({ dir, current: '1.1.0' }), { from: '1.0.0', to: '1.1.0' })
  assert.equal(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), false, 'recogido, se borra')
  assert.equal(takeUpdateMarker({ dir, current: '1.1.0' }), null, 'una sola vez')
})

test('un marcador de una versión ya superada caduca; uno ilegible se dice', () => {
  const dir = carpeta()
  fs.writeFileSync(path.join(dir, UPDATE_MARKER_FILE), JSON.stringify({ from: '1.0.0', to: '1.1.0', at: 1 }))
  assert.equal(takeUpdateMarker({ dir, current: '1.2.0' }), null)
  assert.equal(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), false)
  fs.writeFileSync(path.join(dir, UPDATE_MARKER_FILE), 'basura')
  assert.throws(() => takeUpdateMarker({ dir, current: '1.1.0' }), (e) => e.code === 'marker-unreadable')
  assert.equal(takeUpdateMarker({ dir: carpeta(), current: '1.1.0' }), null, 'sin marcador no hay nada que decir')
})

test('si no hay instalación, no hay marcador', async () => {
  const m = mundo({ release: 'otroHash' }); const dir = carpeta()
  await selfUpdateNpm({ ...m.opts, dir })
  assert.equal(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), false)
})

const marcado = () => { const dir = carpeta(); fs.writeFileSync(path.join(dir, UPDATE_MARKER_FILE), JSON.stringify({ from: '1.0.0', to: '1.1.0', at: 1 })); return dir }
const vigia = async (extra) => {
  const m = mundo({ current: '1.1.0' })
  const stop = watchSelfUpdateNpm({ ...m.opts, everyMs: 60_000, ...extra })
  await new Promise((r) => setTimeout(r, 60))
  stop()
  return m
}

test('el vigía avisa UNA vez al arrancar de que se actualizó, y entonces borra el marcador', async () => {
  const dir = marcado(); const avisos = []
  await vigia({ dir, onUpdated: (e) => avisos.push(e) })
  assert.deepEqual(avisos, [{ version: '1.1.0', from: '1.0.0' }])
  assert.equal(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), false)
  await vigia({ dir, onUpdated: (e) => avisos.push(e) })
  assert.equal(avisos.length, 1, 'en el siguiente arranque ya no hay nada que decir')
})

test('con los avisos apagados no avisa (y el marcador se va igual)', async () => {
  const dir = marcado(); writeUpdatePrefs(dir, { notify: false })
  let avisado = false
  await vigia({ dir, onUpdated: () => { avisado = true } })
  assert.equal(avisado, false)
  assert.equal(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)), false)
})

test('si avisar falla, el marcador NO se pierde: se reintenta en el próximo arranque, y se registra', async () => {
  const dir = marcado()
  const m = await vigia({ dir, onUpdated: async () => { throw new Error('the vault did not reply') } })
  assert.ok(fs.existsSync(path.join(dir, UPDATE_MARKER_FILE)))
  assert.ok(m.lines.some((l) => /could not tell that @dotrino\/demo updated \(the vault did not reply\)/.test(l)))
  const avisos = []
  await vigia({ dir, onUpdated: (e) => avisos.push(e) })
  assert.equal(avisos.length, 1)
  // Y con las preferencias rotas tampoco se pierde.
  const d2 = marcado(); fs.writeFileSync(path.join(d2, UPDATE_PREFS_FILE), 'basura')
  await vigia({ dir: d2, onUpdated: () => {} })
  assert.ok(fs.existsSync(path.join(d2, UPDATE_MARKER_FILE)))
})

// --- contra el registro de verdad ------------------------------------------------------

test('REAL: un paquete publicado del ecosistema cuadra con la release de su repo', async (t) => {
  try { const r = await fetch('https://registry.npmjs.org/-/package/@dotrino%2fupdate/dist-tags', { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(String(r.status)) } catch (e) { return t.skip('sin red: ' + e.message) }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-real-'))
  const ok = await verifyNpmPackage({ pkg: '@dotrino/update', version: '0.5.0', repo: 'imdotrino/dotrino-update', home, env: {} })
  // La 0.5.0 es la primera que adjunta el archivo: mientras se publica todavía no está.
  if (ok.code === 'NO_INTEGRITY_FILE') return t.skip('la release v0.5.0 todavía no existe')
  assert.equal(ok.ok, true, ok.reason)
  assert.match(ok.integrity, /^sha512-/)
  fs.rmSync(ok.dir, { recursive: true })
  // Una versión anterior a esto no trae el archivo: no se instala sola, y lo dice.
  const vieja = await verifyNpmPackage({ pkg: '@dotrino/update', version: '0.4.0', repo: 'imdotrino/dotrino-update', home, env: {} })
  assert.deepEqual([vieja.ok, vieja.code], [false, 'NO_INTEGRITY_FILE'])
})
