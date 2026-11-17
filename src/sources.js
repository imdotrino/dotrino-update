/**
 * @dotrino/update/sources — EL DIRECTORIO DE FUENTES: DÓNDE ESTÁ CADA PIEZA.
 *
 * Regla del dueño (2026-11-17): «ninguno de los servicios debe estar ligado permanentemente a
 * npm ni a otro servicio de terceros». Y la aclaración que la hace concreta: «un servicio está
 * en npmjs, pero por alguna razón lo pongo en otro lugar: debería poder cambiar el directorio
 * y el servicio sabría que la actualización está en otro lado».
 *
 * Antes las ubicaciones estaban escritas en el código (`registry.npmjs.org`, `github.com`).
 * Si npm fallaba, ninguna pieza se podía actualizar ni reinstalar, y moverlas exigía publicar
 * una versión nueva… en el sitio que había fallado.
 *
 * Ahora cada pieza pregunta al DIRECTORIO dónde buscar:
 *
 *   {
 *     "v": 1, "seq": 7, "issued": "2026-11-17T00:00:00Z",
 *     "default":  { "npm": ["https://registry.npmjs.org"],
 *                   "releases": ["https://github.com/{repo}/releases/download/{tag}/{file}"] },
 *     "packages": { "@dotrino/proxy": { "npm": ["https://deps.dotrino.com/npm"] } },
 *     "directory": ["https://deps.dotrino.com/sources.json"]
 *   }
 *
 *   · `npm`       registros con el protocolo de npm, EN ORDEN. Un directorio estático (S3)
 *                 vale: se lee con GET y nada más.
 *   · `releases`  plantillas de los archivos de una release (`{repo}`, `{tag}`, `{file}`).
 *   · `packages`  lo que cambia para UNA pieza (por nombre de paquete o `owner/repo`). Lo que
 *                 no dice, lo pone `default`.
 *   · `directory` dónde leer la versión siguiente de este mismo directorio.
 *   · `seq`       sube en cada versión. No se acepta nunca uno menor ni igual al que se tiene:
 *                 sin eso, quien guardara un directorio viejo podría devolverlo.
 *
 * DE DÓNDE SALE, en este orden:
 *   1. `DOTRINO_SOURCES` (ruta a un JSON sin firmar): el dueño de ESA máquina lo fija. Es su
 *      máquina; no necesita la firma de nadie.
 *   2. El último directorio FIRMADO que se bajó (`~/.config/dotrino/sources.json`), si su
 *      `seq` es mayor que el que trae el código.
 *   3. El que trae el código (`BUILTIN_SOURCES`).
 *
 * LA FIRMA ES DE DOTRINO (decisión del dueño, 2026-11-17), con una llave propia para esto
 * (Ed25519) — no la maestra, que tiene dos trabajos y ninguno más. Las públicas van en el
 * código (`TRUSTED_KEYS`).
 *
 * LO QUE EL DIRECTORIO NO PUEDE HACER, y por eso no es un interruptor remoto (§14): no decide
 * QUÉ se instala. Lo que se baja se comprueba igual venga de donde venga, así que un directorio
 * no puede colar un paquete que no salió del release de su repo. Lo peor que hace un directorio
 * malo es mandar a un sitio vacío: la pieza deja de actualizarse y sigue corriendo.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SOURCES_FILE = 'sources.json'

/**
 * Lo que trae el código. Mientras no exista el directorio estático propio, apunta a donde
 * están hoy las piezas: npm y las releases de GitHub.
 * @type {import('./types.js').SourcesDirectory}
 */
export const BUILTIN_SOURCES = Object.freeze({
  v: 1,
  seq: 1,
  issued: '2026-11-17T00:00:00Z',
  default: Object.freeze({
    npm: Object.freeze(['https://registry.npmjs.org']),
    releases: Object.freeze(['https://github.com/{repo}/releases/download/{tag}/{file}'])
  }),
  packages: Object.freeze({}),
  directory: Object.freeze([])
})

/**
 * Llaves públicas (Ed25519, SPKI DER en base64) que pueden firmar el directorio, por `kid`.
 * Vacío = ningún directorio firmado se acepta todavía: manda el que trae el código.
 * @type {Readonly<Record<string, string>>}
 */
export const TRUSTED_KEYS = Object.freeze({})

/**
 * @param {string} message
 * @param {string} code
 */
const fail = (message, code) => Object.assign(new Error(message), { code })

/** @param {unknown} v */
const isUrl = (v) => {
  if (typeof v !== 'string') return false
  try { return new URL(v.replace(/\{(repo|tag|file)\}/g, 'x')).protocol === 'https:' } catch (_) { return false }
}

/**
 * @param {unknown} list
 * @param {string} where
 */
function checkList (list, where) {
  if (list === undefined) return
  if (!Array.isArray(list) || !list.every(isUrl)) throw fail(`sources: ${where} must be a list of https URLs`, 'sources-invalid')
}

/**
 * @param {unknown} entry
 * @param {string} where
 */
function checkEntry (entry, where) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail(`sources: ${where} must be an object`, 'sources-invalid')
  const e = /** @type {Record<string, unknown>} */ (entry)
  for (const k of Object.keys(e)) if (k !== 'npm' && k !== 'releases') throw fail(`sources: ${where}.${k} is not a known field`, 'sources-invalid')
  checkList(e.npm, `${where}.npm`)
  checkList(e.releases, `${where}.releases`)
  for (const t of /** @type {string[]} */ (e.releases || [])) {
    if (!t.includes('{file}')) throw fail(`sources: ${where}.releases needs {file} in ${t}`, 'sources-invalid')
  }
}

/**
 * Lanza (`sources-invalid`) si no tiene la forma de un directorio. Devuelve el mismo objeto.
 * @param {unknown} d
 * @returns {import('./types.js').SourcesDirectory}
 */
export function validateSources (d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw fail('sources: not an object', 'sources-invalid')
  const s = /** @type {Record<string, any>} */ (d)
  if (s.v !== 1) throw fail(`sources: unknown version ${s.v}`, 'sources-invalid')
  if (!Number.isSafeInteger(s.seq) || s.seq < 1) throw fail('sources: seq must be a positive integer', 'sources-invalid')
  if (typeof s.issued !== 'string' || Number.isNaN(Date.parse(s.issued))) throw fail('sources: issued must be a date', 'sources-invalid')
  checkEntry(s.default, 'default')
  if (!s.default.npm?.length || !s.default.releases?.length) throw fail('sources: default needs npm and releases', 'sources-invalid')
  if (!s.packages || typeof s.packages !== 'object' || Array.isArray(s.packages)) throw fail('sources: packages must be an object', 'sources-invalid')
  for (const [name, entry] of Object.entries(s.packages)) checkEntry(entry, `packages[${name}]`)
  checkList(s.directory, 'directory')
  if (!Array.isArray(s.directory)) throw fail('sources: directory must be a list', 'sources-invalid')
  return /** @type {import('./types.js').SourcesDirectory} */ (s)
}

/**
 * Firma un directorio. Lo que se firma es el texto exacto (`payload`), así nadie tiene que
 * ponerse de acuerdo en cómo se ordena un JSON.
 *
 * @param {import('./types.js').SourcesDirectory} directory
 * @param {{ privateKey: string | crypto.KeyObject, kid: string }} key  la privada en PEM
 * @returns {import('./types.js').SignedSources}
 */
export function signSources (directory, { privateKey, kid }) {
  validateSources(directory)
  if (!kid || typeof kid !== 'string') throw fail('signSources: `kid` is required', 'sources-bad-args')
  const payload = JSON.stringify(directory)
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64')
  return { kid, payload, sig }
}

/**
 * Abre un directorio firmado: firma de una llave de `keys`, forma válida. Lanza con `code`:
 * `sources-unsigned`, `sources-unknown-key`, `sources-bad-signature`, `sources-invalid`.
 *
 * @param {unknown} envelope
 * @param {{ keys?: Readonly<Record<string, string>> }} [options]
 * @returns {import('./types.js').SourcesDirectory}
 */
export function openSources (envelope, { keys = TRUSTED_KEYS } = {}) {
  const e = /** @type {Partial<import('./types.js').SignedSources>} */ (envelope || {})
  if (typeof e.payload !== 'string' || typeof e.sig !== 'string' || typeof e.kid !== 'string') {
    throw fail('sources: not a signed directory (kid, payload, sig)', 'sources-unsigned')
  }
  if (!Object.hasOwn(keys, e.kid)) throw fail(`sources: signed by an unknown key (${e.kid})`, 'sources-unknown-key')
  const pub = crypto.createPublicKey({ key: Buffer.from(keys[e.kid], 'base64'), format: 'der', type: 'spki' })
  if (!crypto.verify(null, Buffer.from(e.payload, 'utf8'), pub, Buffer.from(e.sig, 'base64'))) {
    throw fail(`sources: the signature of ${e.kid} does not check out`, 'sources-bad-signature')
  }
  let d
  try { d = JSON.parse(e.payload) } catch (err) { throw fail(`sources: payload is not JSON: ${/** @type {Error} */ (err).message}`, 'sources-invalid') }
  return validateSources(d)
}

/**
 * Un par nuevo para firmar el directorio. La privada va al cajón de la bóveda, nunca a un
 * archivo suelto ni a un repo.
 * @returns {{ kid: string, publicKey: string, privateKey: string }}  pública en SPKI DER base64, privada en PEM
 */
export function generateSourcesKey () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const der = publicKey.export({ format: 'der', type: 'spki' })
  return {
    kid: 'k-' + crypto.createHash('sha256').update(der).digest('hex').slice(0, 12),
    publicKey: der.toString('base64'),
    privateKey: /** @type {string} */ (privateKey.export({ format: 'pem', type: 'pkcs8' }))
  }
}

/**
 * Dónde se guarda el último directorio firmado que se bajó.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [options]
 */
export function sourcesPath ({ home = os.homedir(), env = process.env } = {}) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'dotrino', SOURCES_FILE)
}

/**
 * EL DIRECTORIO QUE MANDA EN ESTA MÁQUINA. Ver la cabecera para el orden.
 *
 * Lanza si algo que tiene que leerse no se puede leer (`DOTRINO_SOURCES` roto, o un
 * directorio guardado que ya no pasa la firma): eso es un fallo o una manipulación, y seguir
 * con el del código lo taparía.
 *
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, keys?: Readonly<Record<string, string>>, builtin?: import('./types.js').SourcesDirectory }} [options]
 * @returns {{ sources: import('./types.js').SourcesDirectory, from: 'env' | 'cache' | 'builtin', file?: string }}
 */
export function loadSources ({ home, env = process.env, keys = TRUSTED_KEYS, builtin = BUILTIN_SOURCES } = {}) {
  const pinned = env.DOTRINO_SOURCES
  if (pinned) {
    let d
    try { d = JSON.parse(fs.readFileSync(pinned, 'utf8')) } catch (e) {
      throw fail(`sources: DOTRINO_SOURCES (${pinned}) cannot be read: ${/** @type {Error} */ (e).message}`, 'sources-unreadable')
    }
    return { sources: validateSources(d), from: 'env', file: pinned }
  }
  const file = sourcesPath({ home, env })
  if (!fs.existsSync(file)) return { sources: builtin, from: 'builtin' }
  let saved
  try { saved = openSources(JSON.parse(fs.readFileSync(file, 'utf8')), { keys }) } catch (e) {
    const err = /** @type {import('./types.js').Thrown} */ (e)
    throw fail(`sources: the saved directory (${file}) does not check out: ${err.message}. Delete it to go back to the built-in one`, err.code || 'sources-unreadable')
  }
  return saved.seq > builtin.seq ? { sources: saved, from: 'cache', file } : { sources: builtin, from: 'builtin' }
}

/**
 * MIRA SI HAY UN DIRECTORIO MÁS NUEVO y, si lo hay y está firmado, lo guarda. Prueba las
 * direcciones de `directory` en orden.
 *
 * Nunca lanza. `{ ok: true, updated }`, o `{ ok: false, reason }` si ninguna dirección dio un
 * directorio válido (que NO es «no hay nada nuevo»: es «no se pudo mirar»).
 *
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, keys?: Readonly<Record<string, string>>,
 *           builtin?: import('./types.js').SourcesDirectory, fetchImpl?: import('./types.js').FetchLike, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, updated: boolean, seq: number, from: string } | { ok: false, reason: string }>}
 */
export async function refreshSources ({ home, env = process.env, keys = TRUSTED_KEYS, builtin = BUILTIN_SOURCES, fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  let current
  try { current = loadSources({ home, env, keys, builtin }) } catch (e) { return { ok: false, reason: /** @type {Error} */ (e).message } }
  if (current.from === 'env') return { ok: true, updated: false, seq: current.sources.seq, from: 'env' }
  const urls = current.sources.directory
  if (!urls.length) return { ok: true, updated: false, seq: current.sources.seq, from: current.from }
  const why = []
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'dotrino-update' } })
      if (!r.ok) throw new Error(`answered ${r.status}`)
      const envelope = await r.json()
      const next = openSources(envelope, { keys })
      if (next.seq <= current.sources.seq) return { ok: true, updated: false, seq: current.sources.seq, from: current.from }
      const file = sourcesPath({ home, env })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(envelope))
      fs.renameSync(tmp, file)
      return { ok: true, updated: true, seq: next.seq, from: url }
    } catch (e) { why.push(`${new URL(url).host}: ${/** @type {Error} */ (e).message}`) }
  }
  return { ok: false, reason: `no newer directory could be read (${why.join('; ')})` }
}

/**
 * Dónde buscar UNA pieza: lo de `packages[name]` (por paquete y luego por repo) y, lo que no
 * diga, lo de `default`.
 *
 * @param {import('./types.js').SourcesDirectory} sources
 * @param {{ pkg?: string, repo?: string }} who
 * @returns {{ npm: readonly string[], releases: readonly string[] }}
 */
export function sourcesFor (sources, { pkg, repo } = {}) {
  const own = (pkg && sources.packages[pkg]) || (repo && sources.packages[repo]) || {}
  return {
    npm: (own.npm?.length ? own.npm : sources.default.npm).map((u) => u.replace(/\/+$/, '')),
    releases: own.releases?.length ? own.releases : sources.default.releases
  }
}

/**
 * Las direcciones de un archivo de una release, una por plantilla y en orden.
 * @param {readonly string[]} templates
 * @param {{ repo: string, tag: string, file: string }} parts
 */
export function releaseUrls (templates, { repo, tag, file }) {
  return templates.map((t) => t
    .replaceAll('{repo}', repo)
    .replaceAll('{tag}', encodeURIComponent(tag))
    .replaceAll('{file}', encodeURIComponent(file)))
}
