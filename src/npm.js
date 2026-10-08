/**
 * @dotrino/update/npm — UNA PIEZA INSTALADA POR NPM SE ACTUALIZA SOLA.
 *
 * Decisión del dueño (2026-10-08): «lo más importante es la autoactualización de
 * dispositivos npm, también con un setting de aprobación para hacerlo; default siempre
 * autoupdate». Deroga la línea que este paquete trazó al nacer («traer e instalar lo dispara
 * una persona»): lo que importa es estar al día, y pedir permiso es un endurecimiento que el
 * dueño enciende a propósito.
 *
 * Lo que NO cambia es la otra mitad: LO QUE SE BAJA SE COMPRUEBA ANTES DE TOCAR EL DISCO, se
 * haya pedido permiso o no. Y sigue sin haber interruptor remoto: la pieza mira el registro
 * público por su cuenta, nadie le manda nada.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * QUÉ GARANTIZA LA VERIFICACIÓN (`verifyNpmPackage`), Y QUÉ NO
 *
 * DOS CANALES INDEPENDIENTES (decisión del dueño, 2026-10-08): el tarball se baja de npm, y
 * su hash se baja de la release de GitHub del repo (`npm-integrity.json`, que adjunta el
 * `release.yml` al publicar). Se calcula el sha512 de lo bajado y tiene que ser el que dice
 * GitHub, para ESE paquete y ESA versión. Y lo que se instala es ese mismo archivo, no una
 * segunda descarga.
 *
 * Qué garantiza: que lo que entrega el registro de npm es, byte a byte, lo que midió el
 * workflow de release de ese repo. Para colar otro paquete hay que comprometer npm Y la
 * release de GitHub a la vez.
 *
 * Lo que NO garantiza, y se dice sin adornos:
 *   1. NO HAY FIRMA. Antes se comprobaba la procedencia de sigstore con `gh`; se quitó para
 *      no exigir `gh` en cada máquina. La confianza es ahora HTTPS hacia github.com más el
 *      control de la release: quien pueda editar la release del repo (o una cuenta con
 *      permiso de escritura) puede cambiar el hash, y no queda registro de transparencia.
 *   2. Las DEPENDENCIAS del paquete las resuelve npm al instalar: llevan la comprobación de
 *      integridad de npm, no esta.
 *   3. Que el código del repo sea bueno.
 *   4. Sin el JSON (una release anterior a esto), sin red, o si no cuadra: NO se instala.
 *      «No se pudo verificar» nunca es «verificado».
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { latestVersion, isNewer, CHECK_EVERY_MS } from './index.js'
import { integrityOf, INTEGRITY_FILE } from './integrity.js'

const REGISTRY = 'https://registry.npmjs.org'
const GITHUB = 'https://github.com'
const MAX_INTEGRITY_BYTES = 64 * 1024
const DEFAULT_TAG = (version) => `v${version}`
const RETRY_MS = 60 * 60_000
const INSTALL_TIMEOUT_MS = 5 * 60_000

const fail = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra })
const real = (p) => { try { return fs.realpathSync(p) } catch (_) { return path.resolve(p) } }
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep)
/** `@dotrino/update` → `@dotrino%2fupdate`, que es como el registro nombra un paquete con scope. */
const regName = (pkg) => pkg.replace('/', '%2f')
/**
 * El `npm` DEL MISMO NODE QUE CORRE LA PIEZA. Con nvm o con un Node de usuario hay varios
 * prefijos globales en la máquina, y el `npm` del PATH de un servicio puede ser otro: se
 * instalaría bien… en un sitio del que este proceso no arranca.
 */
export function findNpm ({ execPath = process.execPath, platform = process.platform, exists = fs.existsSync } = {}) {
  const local = path.join(path.dirname(execPath), platform === 'win32' ? 'npm.cmd' : 'npm')
  return exists(local) ? local : 'npm'
}

/** `npm root -g` tal como lo imprime npm, o `null` si npm no contesta. */
function npmGlobalRoot ({ run, npm }) {
  try {
    return String(run(npm, ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 }) || '').trim() || null
  } catch (_) { return null }
}

/**
 * ¿Lo que imprimió npm es esta carpeta? NO se compara a secas: npm TACHA de su salida lo
 * que le parece un secreto —un UUID en la ruta sale como `***`—, así que un prefijo
 * perfectamente válido dejaba de reconocerse. Lo tachado casa con cualquier cosa; el resto
 * tiene que coincidir letra a letra.
 */
function sameDir (printed, dir) {
  const re = printed.split('***').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')
  return new RegExp(`^${re}$`).test(dir)
}

/**
 * CÓMO ESTÁ INSTALADA LA PIEZA QUE CORRE. Solo `global` se actualiza sola; para lo demás se
 * dice por qué y qué hacer, y no se intenta nada (igual que la bóveda con el `.deb`).
 *
 * Global es: cuelga del `node_modules` más alto de su ruta, Y ese es el que npm dice que es
 * su raíz global. La carpeta sale de la ruta real del archivo (resolviendo enlaces), no de
 * lo que imprime npm: npm solo confirma.
 *
 * @returns {{ kind: 'global'|'npx'|'local'|'source', selfUpdating: boolean, entry: string,
 *             reason?: string, root?: string, prefix?: string, npm?: string }}
 */
export function installKind ({ entry = process.argv[1], run = execFileSync, npm = findNpm() } = {}) {
  const file = real(entry || '')
  const parts = file.split(path.sep)
  if (parts.includes('_npx')) {
    return {
      kind: 'npx', selfUpdating: false, entry: file,
      reason: 'it runs from the npx cache, which npx refreshes on its own terms: run it with `npx <package>@latest`, or install it globally (`npm install -g <package>`) so it can update itself'
    }
  }
  const i = parts.indexOf('node_modules')
  if (i === -1) {
    return { kind: 'source', selfUpdating: false, entry: file, reason: 'it runs from a source checkout: update it with git (or its deploy), not with npm' }
  }
  const root = parts.slice(0, i + 1).join(path.sep)
  const printed = npmGlobalRoot({ run, npm })
  if (printed && (sameDir(printed, root) || sameDir(real(printed), root))) {
    // `<prefijo>/lib/node_modules` en Linux y macOS; `<prefijo>/node_modules` en Windows.
    const up = path.dirname(root)
    return { kind: 'global', selfUpdating: true, entry: file, root, prefix: path.basename(up) === 'lib' ? path.dirname(up) : up, npm }
  }
  return {
    kind: 'local', selfUpdating: false, entry: file,
    reason: printed
      ? 'it is a dependency of a project (a local node_modules), and that project\'s lockfile decides its version: update it there, or install it globally (`npm install -g <package>`) so it can update itself'
      : 'npm did not answer, so it cannot be told whether this is a global install'
  }
}

/** ¿Hay quien lo levante si sale? systemd, pm2, o que lo diga quien lo lanza. */
export function supervised ({ env = process.env } = {}) {
  return !!(env.INVOCATION_ID || env.pm_id !== undefined || env.DOTRINO_SUPERVISED === '1')
}

/** Carpeta de trabajo en el DISCO del usuario, no en `/tmp` (que puede ser un tmpfs pequeño). */
function workDir ({ home = os.homedir(), env = process.env } = {}) {
  const base = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'dotrino', 'update')
  fs.mkdirSync(base, { recursive: true, mode: 0o700 })
  return fs.mkdtempSync(path.join(base, 'npm-'))
}
const rm = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {} }

async function getJson (url, { fetchImpl, timeoutMs = 20_000 }) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetchImpl(url, { signal: ac.signal, headers: { 'user-agent': 'dotrino-update' } })
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`)
    return await r.json()
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'timed out' : e.message)
  } finally { clearTimeout(t) }
}

/**
 * El `npm-integrity.json` de la release `v<version>` de ese repo. Sigue la redirección de
 * GitHub, con tope de tiempo y de tamaño (es un JSON de unas líneas: lo que pese más no es eso).
 */
async function fetchIntegrity ({ repo, version, tagName, fetchImpl, timeoutMs = 20_000 }) {
  const url = `${GITHUB}/${repo}/releases/download/${encodeURIComponent(tagName)}/${INTEGRITY_FILE}`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    let r
    try { r = await fetchImpl(url, { signal: ac.signal, redirect: 'follow', headers: { 'user-agent': 'dotrino-update' } }) } catch (e) {
      return fail('INTEGRITY_UNREACHABLE', `could not reach the release of ${repo}: ${e.name === 'AbortError' ? 'timed out' : e.message}`)
    }
    if (r.status === 404) return fail('NO_INTEGRITY_FILE', `the release ${tagName} of ${repo} has no ${INTEGRITY_FILE} (it may predate this check, or the release does not exist)`)
    if (!r.ok) return fail('INTEGRITY_UNREACHABLE', `GitHub answered ${r.status} for ${INTEGRITY_FILE} of ${repo} ${tagName}`)
    let bytes
    try { bytes = Buffer.from(await r.arrayBuffer()) } catch (e) {
      return fail('INTEGRITY_UNREACHABLE', `could not read ${INTEGRITY_FILE}: ${e.name === 'AbortError' ? 'timed out' : e.message}`)
    }
    if (bytes.length > MAX_INTEGRITY_BYTES) return fail('INTEGRITY_UNREACHABLE', `${INTEGRITY_FILE} is ${bytes.length} bytes: that is not an integrity file`)
    try {
      const j = JSON.parse(bytes.toString('utf8'))
      if (j?.v !== 1 || !j.packages || typeof j.packages !== 'object') throw new Error('unexpected shape')
      return { ok: true, packages: j.packages }
    } catch (e) { return fail('INTEGRITY_UNREACHABLE', `${INTEGRITY_FILE} of ${repo} ${tagName} cannot be read: ${e.message}`) }
  } finally { clearTimeout(t) }
}

/**
 * BAJA ESA VERSIÓN Y LA COMPRUEBA CONTRA LA RELEASE DE SU REPO. Ver la cabecera para lo que
 * garantiza y lo que no.
 *
 * Con `ok: true` devuelve `file` (el tarball comprobado, que es lo que hay que instalar) y
 * `dir` (su carpeta, que BORRA quien llama cuando termine). Con `ok: false` no queda nada
 * en el disco.
 *
 * @param {{ pkg: string, version: string, repo: string, tag?: (version: string) => string }} o
 *   `repo` como `imdotrino/dotrino-update`; `tag` da el tag de la release de una versión
 *   (por defecto `v<versión>`).
 * @returns {Promise<{ ok: true, file: string, dir: string, integrity: string } |
 *                   { ok: false, code: string, reason: string }>}
 *   códigos: `BAD_ARGS`, `NO_INTEGRITY_FILE` (la release no lo trae), `INTEGRITY_UNREACHABLE`,
 *   `WRONG_PACKAGE` (el JSON no nombra ese paquete en esa versión), `REGISTRY_UNREACHABLE`,
 *   `DOWNLOAD_FAILED`, `INTEGRITY_MISMATCH` (lo que da npm no es lo que midió el release).
 */
export async function verifyNpmPackage ({ pkg, version, repo, tag = DEFAULT_TAG, fetchImpl = fetch, home, env } = {}) {
  if (!pkg || !version || !repo) return fail('BAD_ARGS', 'verifyNpmPackage: `pkg`, `version` and `repo` are required')
  // CÓMO SE LLAMA LA RELEASE DE ESA VERSIÓN. Casi siempre `v<versión>`; un repo que publica
  // un paquete junto a otra cosa usa otro prefijo (`agent-v<versión>`), y lo dice quien llama.
  let tagName
  try { tagName = typeof tag === 'function' ? tag(version) : null } catch (_) { tagName = null }
  if (typeof tagName !== 'string' || !tagName || /[\s/]/.test(tagName)) {
    return fail('BAD_ARGS', 'verifyNpmPackage: `tag` must be a function that returns the release tag of a version (a non-empty string without `/` or spaces)')
  }

  // 1. Lo que midió el release, de GitHub.
  const measured = await fetchIntegrity({ repo, version, tagName, fetchImpl })
  if (!measured.ok) return measured
  const want = Object.hasOwn(measured.packages, pkg) ? measured.packages[pkg] : null
  if (!want || want.version !== version || typeof want.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(want.integrity)) {
    return fail('WRONG_PACKAGE', `${INTEGRITY_FILE} of ${repo} ${tagName} does not name ${pkg}@${version}${want?.version ? ` (it names ${want.version})` : ''}`)
  }

  // 2. El archivo, de npm.
  let tarball
  try {
    const meta = await getJson(`${REGISTRY}/${regName(pkg)}/${version}`, { fetchImpl })
    tarball = meta?.dist?.tarball
    if (typeof tarball !== 'string' || new URL(tarball).origin !== REGISTRY) throw new Error(`unexpected tarball location: ${tarball}`)
  } catch (e) { return fail('REGISTRY_UNREACHABLE', `could not read ${pkg}@${version} from the registry: ${e.message}`) }

  const dir = workDir({ home, env })
  try {
    const file = path.join(dir, path.basename(new URL(tarball).pathname))
    let bytes
    try {
      const r = await fetchImpl(tarball, { redirect: 'follow', headers: { 'user-agent': 'dotrino-update' } })
      if (!r.ok) throw new Error(`the registry answered ${r.status}`)
      bytes = Buffer.from(await r.arrayBuffer())
    } catch (e) { rm(dir); return fail('DOWNLOAD_FAILED', `could not download ${pkg}@${version}: ${e.message}`) }

    // 3. Tienen que ser lo mismo. Se mide lo que se bajó, y eso mismo es lo que se guarda.
    const got = integrityOf(bytes)
    if (got !== want.integrity) {
      rm(dir)
      return fail('INTEGRITY_MISMATCH', `what the registry serves as ${pkg}@${version} is not what the release of ${repo} measured (${got.slice(0, 24)}… vs ${want.integrity.slice(0, 24)}…)`)
    }
    fs.writeFileSync(file, bytes, { mode: 0o600 })
    return { ok: true, file, dir, integrity: got }
  } catch (e) { rm(dir); throw e }
}

/** ¿Este usuario puede escribir en el prefijo global? Si no, hace falta root y no se intenta. */
function globalWritable ({ root, prefix }, { platform = process.platform, access = fs.accessSync, exists = fs.existsSync } = {}) {
  // Donde npm deja los ejecutables. Si todavía no existe (ningún paquete global trae uno),
  // npm lo crea: entonces lo que tiene que poder escribirse es el prefijo.
  const bin = platform === 'win32' ? prefix : path.join(prefix, 'bin')
  try { for (const d of [root, exists(bin) ? bin : prefix]) access(d, fs.constants.W_OK); return true } catch (_) { return false }
}

const needsRoot = (pkg, version, prefix) => `the global npm prefix (${prefix}) is not writable by this user: run \`sudo npm install -g ${pkg}@${version}\`, or move to a user-owned Node (nvm, or \`npm config set prefix ~/.local\`) so it can update itself`

/**
 * INSTALA EN EL PREFIJO GLOBAL, sin lifecycle scripts, y comprueba que quedó la versión
 * pedida. Con `file` instala ESE tarball (el que ya se verificó); sin él, `pkg@version` del
 * registro — que es instalar sin haber comprobado nada: solo para quien verifica por otro lado.
 *
 * @returns {{ ok: true, version: string } | { ok: false, code: string, reason: string }}
 *   códigos: `BAD_ARGS`, `not-self-updating`, `needs-root`, `install-failed`.
 */
export function installNpmGlobal ({
  pkg, version, file = null, run = execFileSync, npm = findNpm(), entry = process.argv[1], kind = null,
  timeoutMs = INSTALL_TIMEOUT_MS, platform, access, readFile = fs.readFileSync
} = {}) {
  if (!pkg || !version) return fail('BAD_ARGS', 'installNpmGlobal: `pkg` and `version` are required')
  // DÓNDE: en el prefijo del que corre esta pieza (`entry`), que es el único del que se sabe
  // que el proceso arranca. Si no es una instalación global, no hay dónde.
  const dirs = kind || installKind({ entry, run, npm })
  if (!dirs.selfUpdating) return fail('not-self-updating', dirs.reason)
  if (!globalWritable(dirs, { platform, access })) {
    return fail('needs-root', needsRoot(pkg, version, dirs.prefix))
  }
  try {
    run(npm, ['install', '-g', file || `${pkg}@${version}`, '--ignore-scripts', '--no-fund', '--no-audit'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs
    })
  } catch (e) {
    return fail('install-failed', `npm install -g ${pkg}@${version} failed: ${String(e.stderr || e.message).trim().slice(-300)}`)
  }
  // NPM DIJO QUE SÍ; SE MIRA IGUAL. Un «instalado» que dejó la versión de antes es una
  // pieza que se reinicia para nada, una y otra vez.
  let got
  try { got = JSON.parse(readFile(path.join(dirs.root, ...pkg.split('/'), 'package.json'), 'utf8')).version } catch (e) {
    return fail('install-failed', `npm reported success but ${pkg} cannot be read back from ${dirs.root}: ${e.message}`)
  }
  if (got !== version) return fail('install-failed', `npm reported success but ${pkg} is at ${got}, not ${version}`)
  return { ok: true, version: got }
}

// --- AVISAR DE QUE SE ACTUALIZÓ --------------------------------------------------------
//
// Cuando una pieza se actualiza sola, se lo dice a los aprobadores de su bóveda (dueño,
// 2026-10-08), y ese aviso se puede apagar EN CADA PIEZA. Aquí van las dos mitades que no
// dependen de la bóveda: la preferencia y el marcador de «me acabo de actualizar». Hablar
// con la bóveda es de quien llama (`onUpdated`).

export const UPDATE_PREFS_FILE = 'update-prefs.json'
export const UPDATE_MARKER_FILE = 'updated.json'

const thrown = (code, message) => Object.assign(new Error(message), { code })
const writeJson = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, file)
}

const PREF_DEFAULTS = { approval: false, notify: true }

/**
 * LAS PREFERENCIAS DE ACTUALIZACIÓN DE ESTA INSTANCIA, que son dos y son de cada agente
 * (dueño, 2026-10-08: «lo de pedir aprobación es por agente, igual que las notificaciones;
 * son independientes al del vault»):
 *
 *   · `approval` — pedir aprobación antes de actualizarse. Por defecto NO: se actualiza sola.
 *   · `notify`   — avisar cuando se actualizó. Por defecto SÍ.
 *
 * Sin archivo valen los valores por defecto. Un archivo que existe y no se puede leer NO es
 * «los valores por defecto» —el de `approval` es no preguntar, y suponerlo saltaría la
 * aprobación que el dueño encendió—: se lanza (`prefs-unreadable`). No es secreto: va en claro.
 * @returns {{ approval: boolean, notify: boolean }}
 */
export function readUpdatePrefs (dir) {
  if (!dir) throw thrown('bad-dir', 'readUpdatePrefs: a data directory is required')
  const file = path.join(dir, UPDATE_PREFS_FILE)
  if (!fs.existsSync(file)) return { ...PREF_DEFAULTS }
  let raw
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    throw thrown('prefs-unreadable', `${UPDATE_PREFS_FILE} exists but cannot be read: ${e.message}`)
  }
  if (!raw || typeof raw.approval !== 'boolean' || typeof raw.notify !== 'boolean') {
    throw thrown('prefs-unreadable', `${UPDATE_PREFS_FILE} exists but does not say both \`approval\` and \`notify\``)
  }
  return { approval: raw.approval, notify: raw.notify }
}

/** Cambia SOLO lo que se le pasa (`{ approval }`, `{ notify }` o las dos); lo demás queda como estaba. */
export function writeUpdatePrefs (dir, change = {}) {
  if (!dir) throw thrown('bad-dir', 'writeUpdatePrefs: a data directory is required')
  const keys = Object.keys(change).filter((k) => change[k] !== undefined)
  if (!keys.length || keys.some((k) => !(k in PREF_DEFAULTS) || typeof change[k] !== 'boolean')) {
    throw thrown('bad-pref', 'writeUpdatePrefs: pass `approval` and/or `notify`, each true or false')
  }
  const next = { ...readUpdatePrefs(dir) }
  for (const k of keys) next[k] = change[k]
  writeJson(path.join(dir, UPDATE_PREFS_FILE), { v: 1, ...next })
  return next
}

/** El marcador tal cual, o `null` si no hay. Ilegible → lanza (`marker-unreadable`). */
function readMarker (dir) {
  const file = path.join(dir, UPDATE_MARKER_FILE)
  if (!fs.existsSync(file)) return null
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof m?.to !== 'string' || typeof m?.from !== 'string') throw new Error('it does not name the versions')
    return m
  } catch (e) { throw thrown('marker-unreadable', `${UPDATE_MARKER_FILE} exists but cannot be read: ${e.message}`) }
}
const dropMarker = (dir) => { try { fs.rmSync(path.join(dir, UPDATE_MARKER_FILE), { force: true }) } catch (_) {} }

/**
 * ¿ME ACABO DE ACTUALIZAR? Lo dice el marcador que `selfUpdateNpm` deja al instalar, y solo
 * cuenta si la versión que corre (`current`) ES la que se instaló: así el aviso lo da la
 * versión nueva ya en marcha, que es la prueba de que ocurrió.
 *
 * Devuelve `{ from, to }` y BORRA el marcador; `null` si no hay, o si todavía corre la
 * vieja (el marcador se queda para el próximo arranque). Uno de una versión anterior a la
 * que corre ya no dice nada y se borra. Ilegible → lanza (`marker-unreadable`).
 * @returns {{ from: string, to: string } | null}
 */
export function takeUpdateMarker ({ dir, current } = {}) {
  const m = peekUpdateMarker({ dir, current })
  if (m) dropMarker(dir)
  return m
}

/** Lo mismo que `takeUpdateMarker` pero SIN borrarlo: para avisar primero y borrar si salió. */
function peekUpdateMarker ({ dir, current } = {}) {
  if (!dir) throw thrown('bad-dir', 'takeUpdateMarker: a data directory is required')
  const m = readMarker(dir)
  if (!m) return null
  if (m.to === current) return { from: m.from, to: m.to }
  if (isNewer(current, m.to)) dropMarker(dir)   // ya va por delante: ese aviso caducó
  return null
}

// --- EL PERMISO SE PIDE UNA VEZ POR VERSIÓN -----------------------------------------------
//
// Regla del dueño (2026-10-08): el permiso «dura un día, pero se hace una sola vez; no se
// reintenta al siguiente día; se asume negado si no se hizo en 24 horas; se dispara
// nuevamente en la siguiente actualización». Así que lo preguntado SE APUNTA, al pedir y
// no al contestar: un reinicio con el pedido a medias cuenta como ya preguntado.

export const UPDATE_ASKED_FILE = 'update-asked.json'
/** Cuánto vale un pedido sin respuesta antes de darse por negado. */
export const ASK_TTL_MS = 24 * 60 * 60_000

/** Lo último que se preguntó, o `null`. Ilegible → lanza (`asked-unreadable`). */
function readAsked (dir) {
  const file = path.join(dir, UPDATE_ASKED_FILE)
  if (!fs.existsSync(file)) return null
  try {
    const a = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof a?.version !== 'string' || typeof a?.askedAt !== 'number' || !['pending', 'denied', 'approved'].includes(a.result)) throw new Error('it does not say what was asked')
    return a
  } catch (e) { throw thrown('asked-unreadable', `${UPDATE_ASKED_FILE} exists but cannot be read: ${e.message}`) }
}
const dropAsked = (dir) => { try { fs.rmSync(path.join(dir, UPDATE_ASKED_FILE), { force: true }) } catch (_) {} }

// --- HACE FALTA ROOT: SE AVISA, NO SE INTENTA ---------------------------------------------
//
// Dueño (2026-10-08): «si se requiere root por algún motivo, simplemente se notifica al
// aprobador que hay actualización y necesita root». Una vez por versión, y se apunta para
// que un reinicio no lo repita.

export const UPDATE_NEEDS_ROOT_FILE = 'update-needs-root.json'

/** `{ version, at, notified }` o `null`. Ilegible → lanza (`needs-root-unreadable`). */
function readNeedsRoot (dir) {
  const file = path.join(dir, UPDATE_NEEDS_ROOT_FILE)
  if (!fs.existsSync(file)) return null
  try {
    const n = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof n?.version !== 'string' || typeof n?.notified !== 'boolean') throw new Error('it does not say which version')
    return n
  } catch (e) { throw thrown('needs-root-unreadable', `${UPDATE_NEEDS_ROOT_FILE} exists but cannot be read: ${e.message}`) }
}
const dropNeedsRoot = (dir) => { try { fs.rmSync(path.join(dir, UPDATE_NEEDS_ROOT_FILE), { force: true }) } catch (_) {} }

/**
 * Apunta que esa versión necesita root y, si toca, avisa. «Toca» es: hay `onNeedsRoot`, la
 * instancia no apagó `notify`, y de esa versión (o de una posterior) todavía no se avisó. Si
 * el aviso lanza NO queda como avisado: se reintenta en la próxima pasada. Nunca lanza.
 */
async function noteNeedsRoot ({ dir, pkg, version, from, onNeedsRoot, log, now }) {
  if (!dir) return
  try {
    const prev = readNeedsRoot(dir)
    const same = prev && !isNewer(version, prev.version)
    let notified = same ? prev.notified : false
    if (!notified && onNeedsRoot && readUpdatePrefs(dir).notify) {
      try { await onNeedsRoot({ version, from }); notified = true } catch (e) {
        log(`[update] could not tell that ${pkg} ${version} needs root to install (${e?.message || e}) · it will try again on the next check`)
      }
    }
    if (!same || notified !== prev.notified) writeJson(path.join(dir, UPDATE_NEEDS_ROOT_FILE), { v: 1, pkg, version, at: same ? prev.at : now(), notified })
  } catch (e) {
    log(`[update] could not note that ${pkg} ${version} needs root (${e?.message || e})`)
  }
}

const STATUS_TEXT = {
  es: {
    declined: (v, d, pkg) => `se pidió permiso para instalar la ${v} el ${d} y no se aprobó: no se vuelve a pedir · instálala con: npm i -g ${pkg}@${v}`,
    waiting: (v, d) => `se pidió permiso para instalar la ${v} el ${d} y espera tu respuesta (vale un día)`,
    unreadable: (m) => `no se pudo leer si se pidió permiso para actualizar (${m})`,
    needsRoot: (v, pkg) => `hay una ${v} publicada y esta instalación necesita permisos de administrador para actualizarse: instálala a mano (sudo npm i -g ${pkg}@${v})`
  },
  en: {
    declined: (v, d, pkg) => `approval to install ${v} was asked on ${d} and not given: it will not ask again · install it with: npm i -g ${pkg}@${v}`,
    waiting: (v, d) => `approval to install ${v} was asked on ${d} and is waiting for your answer (good for a day)`,
    unreadable: (m) => `whether approval to update was asked could not be read (${m})`,
    needsRoot: (v, pkg) => `${v} is out and this install needs administrator rights to update: install it by hand (sudo npm i -g ${pkg}@${v})`
  }
}

/**
 * LO QUE EL `info`/ESTADO DE CADA AGENTE TIENE QUE DECIR de una versión más nueva que la que
 * corre y que no se instaló sola: que se pidió permiso y no se dio, o que la instalación
 * necesita root. Con cómo instalarla a mano. Cadena vacía si no hay nada que decir. No
 * lanza: si un apunte no se puede leer, eso es lo que dice.
 * @returns {string}
 */
export function updateStatusText ({ dir, current, lang = 'es', now = Date.now } = {}) {
  const T = STATUS_TEXT[lang] || STATUS_TEXT.es
  if (!dir) return ''
  const lines = []
  try {
    const n = readNeedsRoot(dir)
    if (n && isNewer(n.version, current)) lines.push(T.needsRoot(n.version, n.pkg || '<pkg>'))
  } catch (e) { lines.push(T.unreadable(e.message)) }
  try {
    const a = readAsked(dir)
    if (a && a.result !== 'approved' && isNewer(a.version, current)) {
      const day = new Date(a.askedAt).toISOString().slice(0, 10)
      lines.push(a.result === 'pending' && now() - a.askedAt < ASK_TTL_MS ? T.waiting(a.version, day) : T.declined(a.version, day, a.pkg || '<pkg>'))
    }
  } catch (e) { lines.push(T.unreadable(e.message)) }
  return lines.join('\n')
}

const PREFS_TEXT = {
  es: {
    approval: { on: 'Este agente pide aprobación antes de actualizarse.', off: 'Este agente se actualiza solo, sin pedir aprobación.' },
    notify: { on: 'Este agente avisa cuando se actualiza.', off: 'Este agente no avisa cuando se actualiza.' },
    usage: 'uso: --approval [on|off]  --notify [on|off]',
    unreadable: (m) => `No se pudieron leer las preferencias (${m}). Bórralas o ponlas de nuevo.`
  },
  en: {
    approval: { on: 'This agent asks for approval before it updates.', off: 'This agent updates on its own, without asking for approval.' },
    notify: { on: 'This agent tells you when it updates.', off: 'This agent does not tell you when it updates.' },
    usage: 'usage: --approval [on|off]  --notify [on|off]',
    unreadable: (m) => `The preferences could not be read (${m}). Delete them or set them again.`
  }
}

/**
 * `--approval [on|off]` Y `--notify [on|off]` PARA LA CLI DE CADA AGENTE, para no
 * escribirlo cuatro veces. Con valor lo guarda; sin valor dice cómo está; sin argumentos
 * enseña las dos líneas. Las dos banderas pueden ir juntas. No imprime: devuelve qué imprimir.
 *
 * @param {string[]} args  los argumentos del subcomando (p. ej. `['--approval', 'on']`)
 * @returns {{ handled: boolean, ok: boolean, text: string, prefs?: { approval: boolean, notify: boolean } }}
 *   `handled: false` solo si `args` trae algo y ninguna de las dos banderas (no era para
 *   esto). `ok: false` con `text` listo para stderr si un valor no vale o las preferencias
 *   no se pueden leer; en ese caso no se guarda nada.
 */
export function updatePrefsCommand (args = [], { dir, lang = 'es' } = {}) {
  const T = PREFS_TEXT[lang] || PREFS_TEXT.es
  const asked = ['approval', 'notify'].filter((k) => args.includes(`--${k}`))
  if (!asked.length && args.length) return { handled: false, ok: true, text: '' }
  const change = {}
  for (const k of asked) {
    const v = args[args.indexOf(`--${k}`) + 1]
    if (v === 'on' || v === 'off') change[k] = v === 'on'
    else if (v !== undefined && !v.startsWith('--')) return { handled: true, ok: false, text: T.usage }
  }
  try {
    const prefs = Object.keys(change).length ? writeUpdatePrefs(dir, change) : readUpdatePrefs(dir)
    const show = asked.length ? asked : ['approval', 'notify']
    return { handled: true, ok: true, text: show.map((k) => T[k][prefs[k] ? 'on' : 'off']).join('\n'), prefs }
  } catch (e) {
    return { handled: true, ok: false, text: T.unreadable(e.message) }
  }
}

/**
 * EL FLUJO ENTERO, y lo único que llama un daemon: mirar, preguntar si puede, comprobar,
 * instalar y avisar de que hay que reiniciar.
 *
 * POR DEFECTO SE ACTUALIZA SIN PREGUNTAR. Pedir aprobación es una preferencia de CADA
 * instancia (`readUpdatePrefs(dir).approval`, la enciende `--approval on`):
 *
 *   · apagada (el valor por defecto) — NO se llama a `mayUpdate`: se verifica y se instala.
 *   · encendida — se llama a `mayUpdate({ pkg, version, from })`, que es donde quien llama
 *     se lo pide a los aprobadores de su bóveda, UNA VEZ POR VERSIÓN. El contrato:
 *       - devuelve `true`  → sí: se instala.
 *       - devuelve `false` → no, o pasó un día sin respuesta (vencido es no). Queda apuntado
 *         y ESA versión no se vuelve a preguntar (`not-approved`, y `already-declined` en
 *         las pasadas siguientes). Solo una versión más nueva dispara otro pedido.
 *       - LANZA → no se pudo preguntar (la bóveda no contesta, no hay red). No es una
 *         negativa: no se apunta nada y se reintenta en la próxima pasada (`could-not-ask`).
 *     Si no se pasó `mayUpdate` no hay a quién preguntar y no se instala (`no-approver`).
 *   · preferencias ilegibles — no se instala (`prefs-unreadable`).
 *
 * Sin `dir` no hay preferencias: entonces se pregunta si, y solo si, se pasó `mayUpdate`.
 *
 * `onNeedsRoot({ version, from })` se llama cuando hay versión nueva y el prefijo global no
 * es de este usuario (`needs-root`): UNA vez por versión, solo con `dir` y con `notify`
 * encendida. Es donde el daemon se lo dice a los aprobadores. Si lanza, se reintenta en la
 * próxima pasada. No se intenta instalar nada.
 *
 * `dir` es la carpeta de datos de la instancia: de ahí salen las preferencias, y ahí queda el marcador `{ from, to, at }` que
 * la versión nueva lee al arrancar para avisar de que se actualizó (`takeUpdateMarker`).
 *
 * `onInstalled({ version, from, restart })` se llama con la versión nueva ya en el disco.
 * `restart: true` solo si hay quien levante el proceso (`supervised`): ahí el daemon cierra
 * lo suyo y sale. Con `false` no debe salir: se quedaría apagado.
 *
 * Nunca lanza. Devuelve `{ ok, code, version?, from?, reason? }`; `ok` es true en
 * `up-to-date`, `installed` e `installed-restart`, y false en `could-not-check`,
 * `not-self-updating`, `needs-root`, `prefs-unreadable`, `asked-unreadable`, `no-approver`,
 * `could-not-ask`, `not-approved`, `already-declined`, `unverified` (con `why`: el código de
 * `verifyNpmPackage`) e `install-failed`.
 */
export async function selfUpdateNpm ({
  pkg, current, repo, tag = DEFAULT_TAG, mayUpdate = null, onInstalled = null, onNeedsRoot = null,
  log = () => {}, dir = null, entry = process.argv[1], run = execFileSync, fetchImpl = fetch,
  env = process.env, npm = findNpm(), home, platform, access, readFile, now = Date.now
} = {}) {
  if (!pkg || !repo) return fail('could-not-check', 'selfUpdateNpm: `pkg` and `repo` are required')
  // `isNewer` da false si `current` no es una versión, y eso se leería como «al día».
  if (!/^\d+\.\d+\.\d+$/.test(String(current || '').trim())) return fail('could-not-check', `selfUpdateNpm: \`current\` is not a version: ${current}`)
  const latest = await latestVersion({ source: 'npm', pkg, fetchImpl, product: pkg, version: current })
  if (!latest.ok) return fail('could-not-check', latest.reason)
  if (!isNewer(latest.version, current)) return { ok: true, code: 'up-to-date', version: current }
  const version = latest.version
  const out = (code, reason, extra = {}) => ({ ok: false, code, reason, version, from: current, ...extra })

  const kind = installKind({ entry, run, npm })
  if (!kind.selfUpdating) {
    log(`[update] ${pkg} ${version} is out (this one is ${current}) · it cannot update itself: ${kind.reason}`)
    return out('not-self-updating', kind.reason, { kind: kind.kind })
  }
  // ANTES de pedir permiso: no se molesta a nadie por una instalación que no va a poder ser.
  if (!globalWritable(kind, { platform, access })) {
    const reason = needsRoot(pkg, version, kind.prefix)
    log(`[update] ${pkg} ${version} is out (this one is ${current}) · ${reason}`)
    await noteNeedsRoot({ dir, pkg, version, from: current, onNeedsRoot, log, now })
    return out('needs-root', reason)
  }

  // ¿HAY QUE PEDIR PERMISO? Lo dice la preferencia de ESTA instancia (`dir`). Sin `dir` no
  // hay preferencias, y entonces manda quien llama: si pasó `mayUpdate`, se pregunta.
  let ask = !!mayUpdate
  if (dir) {
    try { ask = readUpdatePrefs(dir).approval } catch (e) {
      log(`[update] ${pkg} ${version} is out (this one is ${current}) · its update preferences could not be read (${e.message}) · not updating`)
      return out('prefs-unreadable', e.message)
    }
  }
  if (ask) {
    // ENCENDIDA Y SIN A QUIÉN PREGUNTAR: no se instala. El dueño pidió decidir, y que no
    // haya por dónde preguntarle no convierte la pregunta en un sí.
    if (!mayUpdate) {
      log(`[update] ${pkg} ${version} is out (this one is ${current}) · approval is on but there is nobody to ask · not updating`)
      return out('no-approver', 'approval is on but this piece has no way to ask for it')
    }
    // UNA VEZ POR VERSIÓN (hace falta `dir` para apuntarlo). Lo ya preguntado —negado, o a
    // medias cuando el proceso se reinició— no se vuelve a preguntar; solo una versión MÁS
    // NUEVA que la apuntada dispara otro pedido.
    let asked = null
    if (dir) {
      try { asked = readAsked(dir) } catch (e) {
        log(`[update] ${pkg} ${version} is out (this one is ${current}) · what was already asked could not be read (${e.message}) · not updating`)
        return out('asked-unreadable', e.message)
      }
    }
    const already = asked && !isNewer(version, asked.version)
    if (already && asked.result !== 'approved') {
      return out('already-declined', `approval to install ${asked.version} was already asked and not given: it will not ask again`, { askedAt: asked.askedAt })
    }
    if (!already) {
      const note = (result, askedAt) => { if (dir) writeJson(path.join(dir, UPDATE_ASKED_FILE), { v: 1, pkg, version, askedAt, result }) }
      const askedAt = now()
      try { note('pending', askedAt) } catch (e) {
        log(`[update] ${pkg} ${version} is out (this one is ${current}) · the request could not be noted (${e.message}) · not updating`)
        return out('asked-unreadable', e.message)
      }
      let yes
      try { yes = await mayUpdate({ pkg, version, from: current }) } catch (e) {
        // NO SE PUDO PREGUNTAR (la bóveda no contesta, no hay red): eso no es una negativa.
        // No queda apuntado nada y se reintenta en la próxima pasada.
        if (dir) { dropAsked(dir); dropNeedsRoot(dir) }
        log(`[update] ${pkg} ${version} is out (this one is ${current}) · could not ask whether it may update (${e?.message || e}) · not updating, it will ask on the next check`)
        return out('could-not-ask', e?.message || String(e), e?.code ? { why: e.code } : {})
      }
      if (yes !== true) {
        try { note('denied', askedAt) } catch (_) { /* queda `pending`, que cuenta igual */ }
        log(`[update] ${pkg} ${version} is out (this one is ${current}) · not approved (denied, or a day went by) · it will not ask again for this version · install it by hand with: npm i -g ${pkg}@${version}`)
        return out('not-approved', 'the update was not approved', { askedAt })
      }
      // El sí también se apunta: si después la instalación falla, no se vuelve a molestar.
      try { note('approved', askedAt) } catch (_) {}
    }
  }

  const v = await verifyNpmPackage({ pkg, version, repo, tag, fetchImpl, home, env })
  if (!v.ok) {
    log(`[update] ${pkg} ${version} NOT installed: ${v.reason}`)
    return out('unverified', v.reason, { why: v.code })
  }
  let done
  try { done = installNpmGlobal({ pkg, version, file: v.file, run, npm, kind, platform, access, readFile }) } finally { rm(v.dir) }
  if (!done.ok) {
    log(`[update] ${pkg} ${version} NOT installed: ${done.reason}`)
    return out(done.code, done.reason)
  }
  // EL MARCADOR, para que la versión nueva avise al arrancar de que se actualizó. Si no se
  // puede escribir, la instalación vale igual: se dice, y lo único que se pierde es el aviso.
  if (dir) {
    try { writeJson(path.join(dir, UPDATE_MARKER_FILE), { v: 1, pkg, from: current, to: version, at: now() }) } catch (e) {
      log(`[update] could not leave the update marker in ${dir}: ${e.message}`)
    }
  }
  if (dir) { dropAsked(dir); dropNeedsRoot(dir) }
  const restart = supervised({ env })
  log(restart
    ? `[update] ${pkg} ${version} installed (checked against the release of its repo) · restarting now to run it`
    : `[update] ${pkg} ${version} installed (checked against the release of its repo) · restart it to run the new version`)
  try { await onInstalled?.({ version, from: current, restart }) } catch (e) { log(`[update] onInstalled failed: ${e?.message || e}`) }
  return { ok: true, code: restart ? 'installed-restart' : 'installed', version, from: current }
}

/**
 * EL VIGÍA DE UN DAEMON: `selfUpdateNpm` al arrancar y una vez al día. Si no se pudo mirar
 * (la red todavía no está, el registro no contesta) se reintenta en una hora en vez de
 * esperar al día siguiente, y solo se dice cuando el motivo cambia. Devuelve cómo pararlo.
 *
 * `onResult(r)` recibe cada resultado: es lo que una pantalla de estado necesita para decir
 * «al día», «no se pudo mirar» o «pide permiso», que son tres cosas distintas. *
 * `onUpdated({ version, from })` se llama UNA vez, al arrancar, si esta es la versión que se
 * acaba de instalar (hace falta `dir`) y la instancia no apagó los avisos
 * (`readUpdatePrefs(dir).notify`). Es donde el daemon se lo dice a su bóveda. Si lanza, el
 * marcador no se pierde: se reintenta en el próximo arranque.
 */
export function watchSelfUpdateNpm ({
  everyMs = CHECK_EVERY_MS, retryMs = RETRY_MS, onResult = null, onUpdated = null, log = () => {}, ...opts
} = {}) {
  let stopped = false
  let busy = false
  let lastFail = null
  let retry = null
  // ¿ME ACABO DE ACTUALIZAR? Se mira una vez, al arrancar, y no frena lo demás. El marcador
  // solo se borra cuando el aviso SALIÓ (o cuando el dueño apagó los avisos): si avisar
  // falla, se queda para el próximo arranque.
  const avisar = async () => {
    if (!onUpdated || !opts.dir) return
    try {
      const m = peekUpdateMarker({ dir: opts.dir, current: opts.current })
      if (!m) return
      if (readUpdatePrefs(opts.dir).notify) await onUpdated({ version: m.to, from: m.from })
      dropMarker(opts.dir)
    } catch (e) {
      log(`[update] could not tell that ${opts.pkg} updated (${e?.message || e}) · it will try again on the next start`)
    }
  }
  avisar()
  const mirar = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const r = await selfUpdateNpm({ ...opts, log })
      if (stopped) return
      if (r.code === 'could-not-check') {
        if (r.reason !== lastFail) log(`[update] could not check for a new version of ${opts.pkg}: ${r.reason} · trying again in ${Math.round(retryMs / 60_000)} min`)
        lastFail = r.reason
        clearTimeout(retry)
        retry = setTimeout(mirar, retryMs)
        retry.unref?.()
      } else lastFail = null
      try { onResult?.(r) } catch (_) {}
    } finally { busy = false }
  }
  mirar()
  const t = setInterval(mirar, everyMs)
  t.unref?.()
  return () => { stopped = true; clearInterval(t); clearTimeout(retry) }
}
