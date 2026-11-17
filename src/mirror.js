/**
 * @dotrino/update/mirror — RELLENAR EL ESPEJO PROPIO (el directorio estático en S3).
 *
 * Es la otra mitad del directorio de fuentes (`./sources.js`, CONVENCIONES §15.2): el
 * directorio dice DÓNDE buscar, y esto hace que en el espejo haya algo que encontrar. Lo corre
 * el `release.yml` de cada repo, después de publicar en npm:
 *
 *   npx --yes @dotrino/update@latest mirror --repo imdotrino/dotrino-x --tag v1.2.3 \
 *     --lock deps/package-lock.json --release npm-integrity.json --release x-1.2.3.tgz.sigstore.json \
 *     --upload s3://dotrino-deps  ./x-1.2.3.tgz
 *
 * Lo que escribe es un REGISTRO DE NPM DE SOLO LECTURA, servido con GET y nada más:
 *
 *   npm/-/package/<pkg>/dist-tags    { "latest": "1.2.3" }        (lo que lee latestVersion)
 *   npm/<pkg>                        el packument: todas las versiones (lo que lee `npm install`)
 *   npm/<pkg>/<versión>              el manifiesto de una versión (lo que lee verifyNpmPackage)
 *   npm/<pkg>/-/<nombre>-<v>.tgz     el archivo
 *   releases/<repo>/<tag>/<archivo>  la medida y la firma de la release
 *
 * LAS DEPENDENCIAS TAMBIÉN. Sin ellas `npm install --registry <espejo>` encuentra el paquete y
 * se para en la primera dependencia. Se sacan del `package-lock.json` de una instalación del
 * paquete: cada entrada trae su `resolved` y su `integrity`, y lo bajado se compara con esa
 * `integrity` antes de subirlo. Lo que ya está en el espejo no se vuelve a subir.
 *
 * NUNCA SE PISA UN PACKUMENT A CIEGAS. Se lee el que hay y se le suma la versión nueva; si no
 * se puede leer (y no es un 404, que es «todavía no existe»), se para: sobrescribirlo borraría
 * las versiones anteriores del espejo.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { integrityOf, manifestOfTarball } from './integrity.js'

export const MIRROR_BASE = 'https://dotrino-deps.s3.amazonaws.com'
export const UPSTREAM = 'https://registry.npmjs.org'

/**
 * @param {string} message
 * @param {string} code
 */
const fail = (message, code) => Object.assign(new Error(message), { code })

/** `@scope/x` → `@scope%2fx`, como un registro nombra un paquete con scope en la URL. */
const regName = (/** @type {string} */ pkg) => pkg.replace('/', '%2f')

/** El nombre del `.tgz` según la costumbre de npm: `x-1.2.3.tgz` (sin el scope). */
export const tarballName = (/** @type {string} */ name, /** @type {string} */ version) => `${name.split('/').pop()}-${version}.tgz`

/**
 * Comparar versiones semver (con prerelease, que va por debajo de la versión sin él).
 * @param {string} a
 * @param {string} b
 * @returns {number}  <0, 0 o >0
 */
export function compareVersions (a, b) {
  const [ma, pa = ''] = a.split('+')[0].split(/-(.*)/s)
  const [mb, pb = ''] = b.split('+')[0].split(/-(.*)/s)
  const na = ma.split('.').map(Number)
  const nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((na[i] || 0) !== (nb[i] || 0)) return (na[i] || 0) - (nb[i] || 0)
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa < pb ? -1 : 1
}

/**
 * @typedef {{ key: string, body: Buffer, contentType: string, cacheControl: string, late?: boolean }} MirrorFile
 *   `late`: se sube al final (los packuments y sus dist-tags)
 */

const JSON_SHORT = { contentType: 'application/json', cacheControl: 'max-age=300' }
const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * ARMA LO QUE HAY QUE SUBIR. No sube nada: devuelve la lista de archivos, y `uploadMirror` los
 * sube. Así se puede probar sin red de escritura y ver qué va a cambiar.
 *
 * @param {{ tarballs?: string[], releaseFiles?: string[], repo?: string, tag?: string,
 *           lock?: string | null, base?: string, upstream?: string,
 *           fetchImpl?: import('./types.js').FetchLike, log?: (m: string) => void,
 *           readFile?: (p: string) => Buffer, now?: () => Date }} [options]
 *   `tarballs`: los `.tgz` propios (los de `npm pack`). `releaseFiles`: lo que va a
 *   `releases/<repo>/<tag>/`. `lock`: el `package-lock.json` de donde salen las dependencias.
 * @returns {Promise<MirrorFile[]>}
 */
export async function buildMirror ({
  tarballs = [], releaseFiles = [], repo, tag, lock = null, base = MIRROR_BASE, upstream = UPSTREAM,
  fetchImpl = fetch, log = () => {}, readFile = fs.readFileSync, now = () => new Date()
} = {}) {
  if (releaseFiles.length && (!repo || !tag)) throw fail('buildMirror: `repo` and `tag` are required with release files', 'mirror-bad-args')
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw fail(`buildMirror: \`repo\` must be owner/name (${repo})`, 'mirror-bad-args')
  if (tag && /[\s/]/.test(tag)) throw fail(`buildMirror: \`tag\` cannot have spaces or / (${tag})`, 'mirror-bad-args')
  base = base.replace(/\/+$/, '')
  /** @type {MirrorFile[]} */
  const files = []
  /** @type {Map<string, any>} */
  const packuments = new Map()

  /** El packument que hay en el espejo (o uno nuevo si da 404). Se lee una vez por paquete. */
  const packumentOf = async (/** @type {string} */ name) => {
    if (packuments.has(name)) return packuments.get(name)
    const r = await fetchImpl(`${base}/npm/${regName(name)}`, { headers: { 'user-agent': 'dotrino-update' } })
    /** @type {any} */
    let doc
    if (r.status === 404) doc = { name, 'dist-tags': {}, versions: {}, time: {} }
    else if (!r.ok) throw fail(`the mirror answered ${r.status} for the packument of ${name}: not overwriting it blind`, 'mirror-unreadable')
    else {
      doc = await r.json()
      if (doc?.name !== name || typeof doc.versions !== 'object') throw fail(`the packument of ${name} in the mirror is not a packument: not overwriting it`, 'mirror-unreadable')
      doc['dist-tags'] ||= {}
      doc.time ||= {}
    }
    packuments.set(name, doc)
    return doc
  }

  /** ¿Esa versión ya está en el espejo? */
  const present = async (/** @type {string} */ name, /** @type {string} */ version) => {
    const r = await fetchImpl(`${base}/npm/${regName(name)}/${version}`, { method: 'HEAD', headers: { 'user-agent': 'dotrino-update' } })
    if (r.status === 404) return false
    if (r.ok) return true
    throw fail(`the mirror answered ${r.status} for ${name}@${version}`, 'mirror-unreadable')
  }

  /**
   * Suma una versión: el archivo, su manifiesto y la entrada en el packument.
   * @param {Record<string, any>} manifest
   * @param {Buffer} bytes
   */
  const addVersion = async (manifest, bytes) => {
    const { name, version } = manifest
    const file = tarballName(name, version)
    const tarballUrl = `${base}/npm/${name}/-/${file}`
    const doc = { ...manifest, _id: `${name}@${version}`, dist: { ...(manifest.dist || {}), tarball: tarballUrl, integrity: integrityOf(bytes) } }
    files.push({ key: `npm/${name}/-/${file}`, body: bytes, contentType: 'application/octet-stream', cacheControl: IMMUTABLE })
    files.push({ key: `npm/${name}/${version}`, body: Buffer.from(JSON.stringify(doc)), contentType: 'application/json', cacheControl: IMMUTABLE })
    const pk = await packumentOf(name)
    pk.versions[version] = doc
    pk.time[version] = pk.time[version] || now().toISOString()
    pk.time.modified = now().toISOString()
    const latest = pk['dist-tags'].latest
    const stable = !version.includes('-')
    if (!latest || (stable && compareVersions(version, latest) > 0)) pk['dist-tags'].latest = version
  }

  // 1. Lo propio.
  for (const t of tarballs) {
    const bytes = readFile(t)
    const manifest = manifestOfTarball(bytes)
    log(`mirror: ${manifest.name}@${manifest.version}`)
    await addVersion(manifest, bytes)
  }

  // 2. Las dependencias, del lockfile.
  if (lock) {
    let entries
    try { entries = Object.entries(JSON.parse(readFile(lock).toString('utf8')).packages || {}) } catch (e) {
      throw fail(`cannot read the lockfile ${lock}: ${/** @type {Error} */ (e).message}`, 'mirror-bad-lock')
    }
    const own = new Set(files.filter((f) => f.key.endsWith('.tgz')).map((f) => f.key))
    const seen = new Set()
    for (const [where, e] of entries) {
      if (!where || e.link || typeof e.resolved !== 'string' || !e.resolved.startsWith(upstream + '/')) continue
      const name = e.name || where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length)
      const version = e.version
      const id = `${name}@${version}`
      if (seen.has(id) || own.has(`npm/${name}/-/${tarballName(name, version)}`)) continue
      seen.add(id)
      if (typeof e.integrity !== 'string' || !e.integrity.startsWith('sha512-')) throw fail(`${id} has no sha512 integrity in the lockfile: cannot check what is downloaded`, 'mirror-no-integrity')
      if (await present(name, version)) continue
      const meta = await fetchImpl(`${upstream}/${regName(name)}/${version}`, { headers: { 'user-agent': 'dotrino-update' } })
      if (!meta.ok) throw fail(`${upstream} answered ${meta.status} for ${id}`, 'mirror-upstream')
      const manifest = /** @type {Record<string, any>} */ (await meta.json())
      const r = await fetchImpl(e.resolved, { headers: { 'user-agent': 'dotrino-update' } })
      if (!r.ok) throw fail(`${upstream} answered ${r.status} for the tarball of ${id}`, 'mirror-upstream')
      const bytes = Buffer.from(await r.arrayBuffer())
      if (integrityOf(bytes) !== e.integrity) throw fail(`what ${upstream} serves as ${id} is not what the lockfile recorded`, 'mirror-integrity-mismatch')
      log(`mirror: dependency ${id}`)
      await addVersion(manifest, bytes)
    }
  }

  // 3. Los packuments tocados y sus dist-tags.
  for (const [name, pk] of packuments) {
    files.push({ key: `npm/${name}`, body: Buffer.from(JSON.stringify(pk)), ...JSON_SHORT, late: true })
    files.push({ key: `npm/-/package/${name}/dist-tags`, body: Buffer.from(JSON.stringify(pk['dist-tags'])), ...JSON_SHORT, late: true })
  }

  // 4. Lo de la release.
  for (const f of releaseFiles) {
    files.push({ key: `releases/${repo}/${tag}/${path.basename(f)}`, body: readFile(f), contentType: f.endsWith('.json') ? 'application/json' : 'application/octet-stream', cacheControl: IMMUTABLE })
  }
  return files
}

/**
 * SUBE con la CLI de AWS (`aws s3 cp`), que ya está en los runners de GitHub y toma las
 * credenciales del entorno (el rol OIDC del workflow: ningún token guardado). Los packuments
 * van al FINAL: que un packument nombre una versión cuyo archivo todavía no subió dejaría un
 * `npm install` roto a medias.
 *
 * @param {MirrorFile[]} files
 * @param {{ bucket: string, run?: (cmd: string, args: string[], opts: object) => unknown, log?: (m: string) => void }} options
 *   `bucket`: `s3://nombre`
 */
export function uploadMirror (files, { bucket, run = execFileSync, log = () => {} }) {
  if (!/^s3:\/\/[a-z0-9.-]+$/.test(bucket || '')) throw fail(`uploadMirror: bucket must be s3://name (${bucket})`, 'mirror-bad-args')
  const ordered = [...files.filter((f) => !f.late), ...files.filter((f) => f.late)]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotrino-mirror-'))
  try {
    ordered.forEach((f, i) => {
      const local = path.join(dir, String(i))
      fs.writeFileSync(local, f.body)
      run('aws', ['s3', 'cp', local, `${bucket}/${f.key}`, '--content-type', f.contentType, '--cache-control', f.cacheControl, '--only-show-errors'], { stdio: ['ignore', 'inherit', 'inherit'] })
      log(`uploaded ${f.key}`)
    })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  return ordered.length
}
