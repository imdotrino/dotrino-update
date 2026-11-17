/**
 * La mitad que SÍ toca el disco, y por eso no va sola.
 *
 * Se separa de `index.js` a propósito: mirar lo hace cualquier pieza sin pensarlo, y traer
 * lo dispara una persona. Un archivo distinto deja esa frontera a la vista de quien lee.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * @typedef {import('./types.js').ReleaseAsset} ReleaseAsset
 * @typedef {import('./types.js').AssetMatch} AssetMatch
 * @typedef {import('./types.js').DownloadOptions} DownloadOptions
 * @typedef {import('./types.js').VerifyResult} VerifyResult
 * @typedef {import('./types.js').SigstoreLib} SigstoreLib
 * @typedef {import('./types.js').FetchLike} FetchLike
 */

/**
 * Qué archivo del release le toca a ESTA máquina. `match` es cosa de cada producto —el
 * vault emite `.deb` y tarball; otro emitirá otra cosa—, así que se pasa.
 *
 * @param {ReleaseAsset[] | null | undefined} assets
 * @param {AssetMatch[]} match  en orden de preferencia
 * @returns {{ ok: true, asset: ReleaseAsset, kind: string } | { ok: false, reason: string }}
 */
export function pickAsset (assets, match) {
  for (const m of match) {
    if (m.when && !m.when()) continue
    const found = (assets || []).find((a) => m.re.test(a.name))
    if (found) return { ok: true, asset: found, kind: m.kind }
  }
  return { ok: false, reason: 'the release has no file for this machine' }
}

/**
 * Baja a un directorio temporal propio y devuelve dónde quedó.
 * @param {ReleaseAsset} asset
 * @param {DownloadOptions} [options]
 * @returns {Promise<string>}  la ruta del archivo
 */
export async function download (asset, { fetchImpl = fetch, dir = null, product, version } = {}) {
  const dest = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'dotrino-update-'))
  const file = path.join(dest, path.basename(asset.name))
  const r = await fetchImpl(asset.url, {
    redirect: 'follow',
    headers: { 'user-agent': `${product || 'dotrino'}/${version || '0'}` }
  })
  if (!r.ok) throw Object.assign(new Error(`download failed: ${r.status}`), { code: 'DOWNLOAD_FAILED' })
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()), { mode: 0o644 })
  return file
}

/**
 * LO QUE SE BAJA SE COMPRUEBA, Y SI NO SE PUEDE COMPROBAR NO SE INSTALA.
 *
 * El archivo se contrasta contra la atestación de sigstore de su compilación: lo ata a su
 * repo y a su workflow. Es lo que hace que bajar un binario no sea un acto de fe — y por eso
 * los `release.yml` del ecosistema atestiguan sus artefactos.
 *
 * SIN `gh` (dueño, 2026-10-13: «¿por qué depende de GitHub CLI?»). Antes verificaba
 * `gh attestation verify`, y una máquina con un `gh` anterior a la 2.49 —el de casi cualquier
 * distribución— o sin `gh` no podía actualizar nada. Ahora la firma se comprueba aquí, con la
 * librería de sigstore (`sigstore`, la misma que usa npm): cadena del certificado, registro de
 * transparencia y firma del sobre. Es JavaScript puro.
 *
 * `sigstore` NO es dependencia del pilar: lo instala la pieza que baja binarios (el agente de
 * terminal, la bóveda), para que las demás no carguen con sus ~40 paquetes. Sin ella no hay
 * con qué comprobar: se PARA y se dice (`NO_VERIFIER`); no se instala «porque la URL era la
 * buena», que es justo lo que cree quien ya está siendo atacado.
 *
 * SIN INICIAR SESIÓN EN GITHUB: la atestación de un repo público se lee de la API sin
 * credenciales (`/repos/<repo>/attestations/sha256:<hash>`).
 *
 * Qué se comprueba, en orden:
 *   1. GitHub tiene una atestación para el sha256 de ESTE archivo.
 *   2. Su firma es válida y la emitió GitHub Actions (`ISSUER`).
 *   3. Quien firmó es un workflow de `repo` (el SAN del certificado).
 *   4. Lo firmado es una procedencia de compilación que nombra ESTE sha256.
 */
const ISSUER = 'https://token.actions.githubusercontent.com'
const PROVENANCE = /^https:\/\/slsa\.dev\/provenance\//

/**
 * La librería de sigstore, si la pieza la instaló.
 * @returns {Promise<SigstoreLib | null>}
 */
export async function loadSigstore () {
  try { return await import('sigstore') } catch (e) {
    if (/** @type {import('./types.js').Thrown} */ (e)?.code === 'ERR_MODULE_NOT_FOUND') return null
    throw e
  }
}

/**
 * @param {string} file
 * @param {{ repo?: string, fetchImpl?: FetchLike, sigstore?: SigstoreLib | null }} [options]
 *   `sigstore`: la librería ya cargada (`null` = no hay); sin pasarla se carga sola.
 * @returns {Promise<VerifyResult>}
 */
export async function verifyArtifact (file, { repo, fetchImpl = fetch, sigstore = undefined } = {}) {
  if (!repo) return { ok: false, reason: 'verifyArtifact: `repo` is required' }
  const lib = sigstore === undefined ? await loadSigstore() : sigstore
  if (!lib) {
    return { ok: false, code: 'NO_VERIFIER', reason: 'the `sigstore` package is not installed, so the download cannot be verified. Reinstall this program' }
  }
  // La atestación de ESTE archivo, por su hash, sin credenciales.
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  let bundles
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/attestations/sha256:${hash}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dotrino-update' }
    })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    bundles = ((/** @type {any} */ (await r.json()))?.attestations || []).map((/** @type {any} */ a) => a?.bundle).filter(Boolean)
  } catch (e) {
    return { ok: false, code: 'NO_ATTESTATION', reason: `could not fetch the attestation of this file: ${/** @type {Error} */ (e).message}` }
  }
  if (!bundles.length) {
    return { ok: false, code: 'NO_ATTESTATION', reason: `GitHub has no attestation for this file (sha256 ${hash}): it was not built by the release of ${repo}` }
  }
  return verifyBundles(bundles, { sha256: hash, repo, lib })
}

/**
 * ¿Alguno de estos bundles de sigstore es una procedencia de compilación de ESE sha256, firmada
 * por un workflow de ESE repo? No mira de dónde salió el bundle: la firma vale venga de donde
 * venga, y por eso sirve para verificar lo que se baja de un espejo.
 *
 * @param {any[]} bundles
 * @param {{ sha256: string, repo: string, lib: SigstoreLib }} options
 * @returns {Promise<VerifyResult>}
 */
export async function verifyBundles (bundles, { sha256, repo, lib }) {
  // Basta UNA atestación que cuadre entera; si ninguna, se dice por qué falló la última.
  let why = ''
  for (const bundle of bundles) {
    try {
      const signer = await lib.verify(bundle, { certificateIssuer: ISSUER })
      const who = String(signer?.identity?.subjectAlternativeName || '')
      if (signer?.identity?.extensions?.issuer !== ISSUER) throw new Error(`signed by an unexpected issuer (${signer?.identity?.extensions?.issuer})`)
      if (!who.startsWith(`https://github.com/${repo}/.github/workflows/`)) throw new Error(`signed by ${who || 'nobody'}, not by a workflow of ${repo}`)
      const env = bundle.dsseEnvelope
      if (env?.payloadType !== 'application/vnd.in-toto+json') throw new Error('the attestation is not an in-toto statement')
      const statement = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'))
      if (!PROVENANCE.test(String(statement.predicateType))) throw new Error(`not a build provenance (${statement.predicateType})`)
      if (!(statement.subject || []).some((/** @type {any} */ s) => s?.digest?.sha256 === sha256)) throw new Error('the attestation is for another file')
      return { ok: true, out: `verified: built by ${who}` }
    } catch (e) { why = /** @type {Error} */ (e).message }
  }
  return { ok: false, code: 'BAD_SIGNATURE', reason: `the signature does not check out: ${String(why).trim().slice(0, 300)}` }
}

/**
 * Bajar y verificar, que es lo que casi siempre se quiere junto. No instala: eso es del producto.
 * @param {ReleaseAsset} asset
 * @param {DownloadOptions & { repo?: string, sigstore?: SigstoreLib | null }} [options]
 * @returns {Promise<VerifyResult & { file?: string }>}  `file` siempre que se bajó
 */
export async function fetchVerified (asset, { repo, ...rest } = {}) {
  const file = await download(asset, rest)
  const v = await verifyArtifact(file, { repo, fetchImpl: rest.fetchImpl, sigstore: rest.sigstore })
  return v.ok ? { ok: true, file, out: v.out } : { ...v, file }
}
