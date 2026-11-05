/**
 * @dotrino/update — ENTERARSE DE QUE HAY VERSIÓN NUEVA, Y TRAERLA VERIFICADA.
 *
 * Lo que costó una tarde entera el 2026-09-19 no fue instalar: fueron tres comandos. Fue
 * NO ENTERARSE. El replicador de Cepi llevaba quince días en 0.98.0, las dos bóvedas en
 * 0.121.0 con la 0.123.0 publicada, y ninguna pantalla lo decía. El `status` del vault solo
 * avisaba cuando el daemon corriendo era más viejo que el CLI instalado —o sea cuando YA
 * actualizaste y falta reiniciar—, nunca de que el mundo siguió sin ti.
 *
 * Y es de todos, no del vault: el proxio, geo, reputation, los selladores y los agentes
 * tienen el mismo agujero. Por eso esto es un paquete y no un archivo dentro de un repo.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * LA LÍNEA QUE NO SE CRUZA
 *
 *   > no existe ningún interruptor remoto. Nadie —tampoco Dotrino— puede dejar sin
 *   > funcionar el software que alguien se instaló en su máquina.   (CLAUDE.md)
 *
 * Nada de esto lo dispara Dotrino: la pieza mira el registro público por su cuenta. Tres
 * entradas:
 *
 *   · MIRAR (`checkForUpdate`) — una lectura. No puede romper nada, y va sola.
 *   · TRAER UN BINARIO (`./fetch`, `fetchVerified`) — VERIFICA antes de tocar el disco.
 *   · ACTUALIZARSE POR NPM (`./npm`, `selfUpdateNpm`) — va sola por defecto (dueño,
 *     2026-10-08: lo que importa es estar al día; pedir permiso es un ajuste que se
 *     enciende a propósito), y también verifica antes de instalar.
 *
 * Que la URL sea la correcta no prueba nada: quien está siendo atacado también cree que su
 * URL es la buena. Por eso lo que se baja se contrasta antes de instalarlo —un binario,
 * contra la atestación de sigstore de su release; un paquete de npm, contra el hash que su
 * release de GitHub adjunta (dos canales, sin firma: ver `./npm`)— y si no se puede
 * comprobar NO SE INSTALA.
 * Sin repliegues: «no se pudo mirar» y «estás al día» son cosas distintas y esto nunca las
 * confunde.
 */

import { getJson } from './http.js'

/**
 * @typedef {import('./types.js').LatestOptions} LatestOptions
 * @typedef {import('./types.js').LatestResult} LatestResult
 * @typedef {import('./types.js').CheckOptions} CheckOptions
 * @typedef {import('./types.js').CheckResult} CheckResult
 * @typedef {import('./types.js').WatchOptions} WatchOptions
 * @typedef {import('./types.js').GetJsonOptions} GetJsonOptions
 */

/**
 * `0.123.0` → `[0,123,0]`. Lo que no sean tres números no compite.
 * @param {string | null | undefined} v
 * @returns {number[]}
 */
const parts = (v) => String(v || '').trim().replace(/^v/, '').split('.').map((n) => parseInt(n, 10))
/**
 * @param {string | null | undefined} v
 * @returns {v is string}
 */
const valid = (v) => parts(v).length === 3 && parts(v).every((n) => Number.isFinite(n))

/**
 * ¿`a` es más nueva que `b`? Sin dependencias: son tres números y compararlos bien cabe
 * aquí. Un comparador de semver a medias es peor que no tenerlo, porque falla callado.
 *
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {boolean}  false también si alguna de las dos no es una versión
 */
export function isNewer (a, b) {
  if (!valid(a) || !valid(b)) return false
  const [x, y, z] = parts(a); const [p, q, r] = parts(b)
  return x !== p ? x > p : y !== q ? y > q : z > r
}

/**
 * @param {string} [product]
 * @param {string} [version]
 */
const ua = (product, version) => `${product || 'dotrino'}/${version || '0'} (+https://dotrino.com)`

/**
 * @param {string} url
 * @param {GetJsonOptions & { product?: string, version?: string }} options
 */
const get = (url, { fetchImpl, timeoutMs, headers = {}, product, version }) =>
  getJson(url, { fetchImpl, timeoutMs, headers: { 'user-agent': ua(product, version), ...headers } })

/**
 * LA ÚLTIMA VERSIÓN PUBLICADA. Dos orígenes, porque el ecosistema se instala de dos formas:
 *
 *   · `github` — la pieza se baja como binario de un release (el vault: `.deb`, tarball).
 *                Con `tagPrefix`, la release más alta cuyo tag empieza así (un repo con
 *                varios productos: `desktop-v`, `agent-v`).
 *   · `npm`    — la pieza se corre desde el registro (el proxio, geo, reputation, los bots).
 *
 * Devuelve `{ ok: false, reason }` cuando no se pudo mirar, que **no** es «estás al día»:
 * quien lo enseñe tiene que poder decir cuál de las dos cosas pasó.
 *
 * @param {LatestOptions} [options]
 * @returns {Promise<LatestResult>}
 */
export async function latestVersion ({
  source, repo, pkg, tagPrefix, fetchImpl = fetch, timeoutMs = 10_000, product, version
} = {}) {
  const opts = { fetchImpl, timeoutMs, product, version }
  if (source === 'npm') {
    if (!pkg) return { ok: false, reason: 'latestVersion: `pkg` is required with source "npm"' }
    // El endpoint corto: solo el dist-tag, sin el documento entero del paquete (que son
    // megabytes en un paquete con historia).
    const r = await get(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`, opts)
    if (!r.ok) return r
    const v = r.body?.latest
    return valid(v) ? { ok: true, version: v, source: 'npm', pkg } : { ok: false, reason: `unreadable dist-tag: ${v}` }
  }
  if (source === 'github') {
    if (!repo) return { ok: false, reason: 'latestVersion: `repo` is required with source "github"' }
    const headers = { accept: 'application/vnd.github+json' }
    /** @type {{ v: string, body: any } | undefined} */
    let rel
    if (tagPrefix) {
      // Un repo con VARIOS productos etiqueta cada uno con su prefijo (`desktop-v1.2.3`,
      // `agent-v1.2.3`), y «la última release» del repo es la de cualquiera de ellos. Se
      // mira la lista y se toma la más alta de ESTE producto.
      const r = await get(`https://api.github.com/repos/${repo}/releases?per_page=100`, { ...opts, headers })
      if (!r.ok) return r
      if (!Array.isArray(r.body)) return { ok: false, reason: 'unreadable release list' }
      for (const x of r.body) {
        const tag = String(x?.tag_name || '')
        if (x?.draft || x?.prerelease || !tag.startsWith(tagPrefix)) continue
        const n = tag.slice(tagPrefix.length)
        if (valid(n) && (!rel || isNewer(n, rel.v))) rel = { v: n, body: x }
      }
      if (!rel) return { ok: false, reason: `no release tagged ${tagPrefix}* in ${repo}` }
    } else {
      const r = await get(`https://api.github.com/repos/${repo}/releases/latest`, { ...opts, headers })
      if (!r.ok) return r
      const n = String(r.body?.tag_name || '').replace(/^v/, '')
      if (!valid(n)) return { ok: false, reason: `unreadable tag: ${r.body?.tag_name}` }
      rel = { v: n, body: r.body }
    }
    const r = rel
    const v = rel.v
    const assets = (r.body.assets || []).map((/** @type {any} */ a) => ({ name: a.name, url: a.browser_download_url, size: a.size }))
    return { ok: true, version: v, source: 'github', repo, assets, url: r.body.html_url }
  }
  return { ok: false, reason: `latestVersion: unknown source "${source}"` }
}

/**
 * ¿Hay algo más nuevo que lo que corro? Es lo ÚNICO que una pieza hace sola y sin pedir
 * permiso, porque es una lectura.
 *
 * Tres respuestas y ninguna se confunde con otra: `{ok:true, newer:true}` (hay),
 * `{ok:true, newer:false}` (al día) y `{ok:false, reason}` (no se pudo mirar).
 *
 * @param {CheckOptions} [options]
 * @returns {Promise<CheckResult>}
 */
export async function checkForUpdate ({ current, ...rest } = {}) {
  if (!valid(current)) return { ok: false, reason: `checkForUpdate: \`current\` is not a version: ${current}` }
  const r = await latestVersion({ ...rest, version: current })
  if (!r.ok) return r
  return { ...r, current, newer: isNewer(r.version, current) }
}

/**
 * Cada cuánto mirar. Un día: esto no es una carrera, y una pieza que pregunta cada minuto
 * es una pieza que hace ruido en el registro de otro.
 */
export const CHECK_EVERY_MS = 24 * 60 * 60_000

/**
 * El vigía, para un daemon: mira al arrancar y una vez al día. Devuelve cómo pararlo.
 *
 * No lanza nunca: que no se pueda mirar no es problema del usuario, y llenarle el log de
 * fallos de red tampoco le ayuda. Solo habla cuando hay algo que decir.
 *
 * @param {WatchOptions} [options]
 * @returns {import('./types.js').Stop}
 */
export function watchForUpdate ({ onNewer, everyMs = CHECK_EVERY_MS, ...rest } = {}) {
  let stopped = false
  const check = async () => {
    const r = await checkForUpdate(rest)
    if (stopped || !r.ok || !r.newer) return
    try { onNewer?.(r) } catch (_) {}
  }
  check()
  const t = setInterval(check, everyMs)
  t.unref?.()
  return () => { stopped = true; clearInterval(t) }
}
