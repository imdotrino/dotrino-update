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
 * Se baja el tarball de esa versión y la atestación de procedencia que npm guarda de ella
 * (SLSA v1, firmada con sigstore), y `gh attestation verify` comprueba, sin sesión ni token:
 *
 *   · que la firma de sigstore es válida (certificado de Fulcio + registro de transparencia);
 *   · que el certificado se emitió a una ejecución de `<repo>/.github/workflows/<workflow>`;
 *   · que lo firmado es ESE tarball, byte a byte (su sha512).
 *
 * Y lo que se instala es ese mismo archivo ya comprobado, no una segunda descarga: entre
 * verificar e instalar no hay hueco por el que el registro pueda dar otra cosa.
 *
 * Lo que NO garantiza, y se dice: (1) las DEPENDENCIAS del paquete las resuelve npm al
 * instalar y solo llevan la comprobación de integridad de npm, no esta; (2) que el código
 * del repo sea bueno — ata el paquete a su workflow, no audita lo que el workflow compiló;
 * (3) sin `gh` ≥ 2.49, sin red o sin atestación no hay con qué comprobar, y entonces NO se
 * instala. «No se pudo verificar» nunca es «verificado».
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { latestVersion, isNewer, CHECK_EVERY_MS } from './index.js'
import { findGh, ghReady } from './fetch.js'

const REGISTRY = 'https://registry.npmjs.org'
const SLSA = 'https://slsa.dev/provenance/v1'
const RETRY_MS = 60 * 60_000
const INSTALL_TIMEOUT_MS = 5 * 60_000

const fail = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra })
const real = (p) => { try { return fs.realpathSync(p) } catch (_) { return path.resolve(p) } }
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep)
/** `@dotrino/update` → `@dotrino%2fupdate`, que es como el registro nombra un paquete con scope. */
const regName = (pkg) => pkg.replace('/', '%2f')
/** El nombre con el que la atestación nombra su sujeto: `pkg:npm/%40dotrino/update@0.3.0`. */
const purl = (pkg, version) => `pkg:npm/${pkg.replace(/^@/, '%40')}@${version}`

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
 * BAJA ESA VERSIÓN Y COMPRUEBA SU PROCEDENCIA. Ver la cabecera para lo que garantiza.
 *
 * Con `ok: true` devuelve `file` (el tarball comprobado, que es lo que hay que instalar) y
 * `dir` (su carpeta, que BORRA quien llama cuando termine). Con `ok: false` no queda nada
 * en el disco.
 *
 * @param {{ pkg: string, version: string, repo: string, workflow?: string }} o
 *   `repo` como `imdotrino/dotrino-update`; `workflow` es el archivo, `release.yml` si no se dice.
 * @returns {Promise<{ ok: true, file: string, dir: string, commit: string|null } |
 *                   { ok: false, code: string, reason: string }>}
 *   códigos: `BAD_ARGS`, `NO_GH`, `GH_TOO_OLD`, `REGISTRY_UNREACHABLE`, `NO_ATTESTATION`,
 *   `WRONG_SOURCE`, `DOWNLOAD_FAILED`, `BAD_SIGNATURE`.
 */
export async function verifyNpmPackage ({
  pkg, version, repo, workflow = 'release.yml',
  run = execFileSync, fetchImpl = fetch, gh = findGh(), home, env
} = {}) {
  if (!pkg || !version || !repo) return fail('BAD_ARGS', 'verifyNpmPackage: `pkg`, `version` and `repo` are required')
  const byHand = `npm view ${pkg}@${version} dist.attestations`
  const noGh = ghReady({ run, gh, hint: byHand })
  if (noGh) return noGh

  // 1. Qué archivo es y qué dice el registro de dónde salió.
  let tarball, bundles
  try {
    const meta = await getJson(`${REGISTRY}/${regName(pkg)}/${version}`, { fetchImpl })
    tarball = meta?.dist?.tarball
    if (typeof tarball !== 'string' || new URL(tarball).origin !== REGISTRY) throw new Error(`unexpected tarball location: ${tarball}`)
  } catch (e) { return fail('REGISTRY_UNREACHABLE', `could not read ${pkg}@${version} from the registry: ${e.message}`) }
  try {
    const att = await getJson(`${REGISTRY}/-/npm/v1/attestations/${regName(pkg)}@${version}`, { fetchImpl })
    bundles = (att?.attestations || []).filter((a) => a?.predicateType === SLSA).map((a) => a.bundle).filter(Boolean)
  } catch (e) { return fail('NO_ATTESTATION', `could not fetch the provenance of ${pkg}@${version}: ${e.message}`) }
  if (!bundles.length) return fail('NO_ATTESTATION', `${pkg}@${version} was published without provenance: it did not come out of the release workflow of ${repo}`)

  // 2. LO QUE DICE LA ATESTACIÓN, leído antes de verificar la firma. No decide nada —la
  // firma la comprueba `gh` abajo, y es quien manda—: sirve para que el fallo diga QUÉ no
  // cuadra («salió de otro repo») en vez de un «la firma no vale» que no explica nada.
  let commit = null
  const wanted = bundles.filter((b) => {
    try {
      const st = JSON.parse(Buffer.from(b.dsseEnvelope.payload, 'base64').toString('utf8'))
      const wf = st?.predicate?.buildDefinition?.externalParameters?.workflow || {}
      const hit = (st.subject || []).some((s) => s?.name === purl(pkg, version)) &&
        wf.repository === `https://github.com/${repo}` && wf.path === `.github/workflows/${workflow}`
      if (hit) commit = st.predicate.buildDefinition.resolvedDependencies?.[0]?.digest?.gitCommit || null
      return hit
    } catch (_) { return false }
  })
  if (!wanted.length) return fail('WRONG_SOURCE', `the provenance of ${pkg}@${version} does not name ${repo}/.github/workflows/${workflow}: it was built somewhere else`)

  // 3. El archivo, y la firma contra ESE archivo.
  const dir = workDir({ home, env })
  try {
    const file = path.join(dir, path.basename(new URL(tarball).pathname))
    try {
      const r = await fetchImpl(tarball, { redirect: 'follow', headers: { 'user-agent': 'dotrino-update' } })
      if (!r.ok) throw new Error(`the registry answered ${r.status}`)
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()), { mode: 0o600 })
    } catch (e) { rm(dir); return fail('DOWNLOAD_FAILED', `could not download ${pkg}@${version}: ${e.message}`) }
    const bundleFile = path.join(dir, 'provenance.jsonl')
    fs.writeFileSync(bundleFile, wanted.map((b) => JSON.stringify(b)).join('\n') + '\n')
    try {
      run(gh, [
        'attestation', 'verify', file, '--bundle', bundleFile,
        '--repo', repo, '--signer-workflow', `${repo}/.github/workflows/${workflow}`,
        '--predicate-type', SLSA, '--digest-alg', 'sha512'
      ], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        // Sin sesión a propósito: si hubiera una, no se usa ni se necesita.
        env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' }
      })
    } catch (e) {
      rm(dir)
      return fail('BAD_SIGNATURE', `the provenance of ${pkg}@${version} does not check out against the downloaded file: ${String(e.stderr || e.message).trim().slice(0, 300)}`)
    }
    return { ok: true, file, dir, commit, sha512: crypto.createHash('sha512').update(fs.readFileSync(file)).digest('hex') }
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

/**
 * EL FLUJO ENTERO, y lo único que llama un daemon: mirar, preguntar si puede, comprobar,
 * instalar y avisar de que hay que reiniciar.
 *
 * `mayUpdate({ pkg, version, from })` es donde quien llama le pregunta a la bóveda si el
 * dueño encendió la aprobación. SIN ÉL SE ACTUALIZA SIN PREGUNTAR, que es el valor por
 * defecto del ecosistema. Tiene que devolver `true` exacto: `false` es que no (y se dice), y
 * si LANZA tampoco se instala — no saber si hace falta permiso no es tener permiso.
 *
 * `onInstalled({ version, from, restart })` se llama con la versión nueva ya en el disco.
 * `restart: true` solo si hay quien levante el proceso (`supervised`): ahí el daemon cierra
 * lo suyo y sale. Con `false` no debe salir: se quedaría apagado.
 *
 * Nunca lanza. Devuelve `{ ok, code, version?, from?, reason? }`; `ok` es true en
 * `up-to-date`, `installed` e `installed-restart`, y false en `could-not-check`,
 * `not-self-updating`, `needs-root`, `could-not-ask`, `not-approved`, `unverified` (con
 * `why`: el código de `verifyNpmPackage`) e `install-failed`.
 */
export async function selfUpdateNpm ({
  pkg, current, repo, workflow = 'release.yml', mayUpdate = null, onInstalled = null,
  log = () => {}, entry = process.argv[1], run = execFileSync, fetchImpl = fetch,
  env = process.env, npm = findNpm(), gh = findGh(), home, platform, access, readFile
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
    return out('needs-root', reason)
  }

  if (mayUpdate) {
    let yes
    try { yes = await mayUpdate({ pkg, version, from: current }) } catch (e) {
      log(`[update] ${pkg} ${version} is out (this one is ${current}) · could not ask whether it may update (${e?.message || e}) · not updating`)
      return out('could-not-ask', e?.message || String(e), e?.code ? { why: e.code } : {})
    }
    if (yes !== true) {
      log(`[update] ${pkg} ${version} is out (this one is ${current}) · not approved · it will ask again`)
      return out('not-approved', 'the update was not approved')
    }
  }

  const v = await verifyNpmPackage({ pkg, version, repo, workflow, run, fetchImpl, gh, home, env })
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
  const restart = supervised({ env })
  log(restart
    ? `[update] ${pkg} ${version} installed (verified against its provenance) · restarting now to run it`
    : `[update] ${pkg} ${version} installed (verified against its provenance) · restart it to run the new version`)
  try { await onInstalled?.({ version, from: current, restart }) } catch (e) { log(`[update] onInstalled failed: ${e?.message || e}`) }
  return { ok: true, code: restart ? 'installed-restart' : 'installed', version, from: current }
}

/**
 * EL VIGÍA DE UN DAEMON: `selfUpdateNpm` al arrancar y una vez al día. Si no se pudo mirar
 * (la red todavía no está, el registro no contesta) se reintenta en una hora en vez de
 * esperar al día siguiente, y solo se dice cuando el motivo cambia. Devuelve cómo pararlo.
 *
 * `onResult(r)` recibe cada resultado: es lo que una pantalla de estado necesita para decir
 * «al día», «no se pudo mirar» o «pide permiso», que son tres cosas distintas.
 */
export function watchSelfUpdateNpm ({
  everyMs = CHECK_EVERY_MS, retryMs = RETRY_MS, onResult = null, log = () => {}, ...opts
} = {}) {
  let stopped = false
  let busy = false
  let lastFail = null
  let retry = null
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
