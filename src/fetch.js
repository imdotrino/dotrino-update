/**
 * La mitad que SÍ toca el disco, y por eso no va sola.
 *
 * Se separa de `index.js` a propósito: mirar lo hace cualquier pieza sin pensarlo, y traer
 * lo dispara una persona. Un archivo distinto deja esa frontera a la vista de quien lee.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'

/**
 * Qué archivo del release le toca a ESTA máquina. `match` es cosa de cada producto —el
 * vault emite `.deb` y tarball; otro emitirá otra cosa—, así que se pasa.
 *
 * @param {Array<{name:string,url:string}>} assets
 * @param {Array<{kind:string, re:RegExp, when?:() => boolean}>} match  en orden de preferencia
 */
export function pickAsset (assets, match) {
  for (const m of match) {
    if (m.when && !m.when()) continue
    const found = (assets || []).find((a) => m.re.test(a.name))
    if (found) return { ok: true, asset: found, kind: m.kind }
  }
  return { ok: false, reason: 'the release has no file for this machine' }
}

/** Baja a un directorio temporal propio y devuelve dónde quedó. */
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
 * `gh attestation verify` contrasta el archivo contra lo que sigstore guarda de esa
 * compilación: lo ata a su commit y a su workflow. Es lo que hace que bajar un binario no
 * sea un acto de fe — y por eso los `release.yml` del ecosistema atestiguan sus artefactos.
 *
 * SIN INICIAR SESIÓN EN GITHUB (2026-09-24). `gh attestation verify --repo` a secas pide
 * `gh auth login` aunque el repo sea público, y una bóveda en un VPS no tiene por qué tener
 * una sesión de GitHub — la del VPS de Dotrino no la tenía, así que su actualización nunca
 * pudo instalar nada. La atestación de un repo público se lee de la API SIN credenciales
 * (`/repos/<repo>/attestations/sha256:<hash>`), y `gh` la verifica con `--bundle` sin
 * pedir sesión. La verificación es la misma: firma de sigstore, repo y workflow.
 *
 * Sin `gh`, o con uno que no sabe verificar (anterior a `attestation`), no hay con qué
 * comprobar. Entonces se PARA y se dice cómo arreglarlo; no se instala «porque la URL era la
 * buena», que es justo lo que cree quien ya está siendo atacado.
 */
export async function verifyArtifact (file, { repo, run = execFileSync, fetchImpl = fetch, gh = findGh() } = {}) {
  if (!repo) return { ok: false, reason: 'verifyArtifact: `repo` is required' }
  try { run(gh, ['--version'], { stdio: 'ignore' }) } catch (_) {
    return {
      ok: false, code: 'NO_GH',
      reason: `gh is not installed, so the download cannot be verified. Install GitHub CLI (a user binary in ~/.local/bin is enough; no login needed), or check it by hand: gh attestation verify <file> --repo ${repo}`
    }
  }
  try { run(gh, ['attestation', 'verify', '--help'], { stdio: 'ignore' }) } catch (_) {
    return {
      ok: false, code: 'GH_TOO_OLD',
      reason: `this gh cannot verify attestations (it predates \`gh attestation\`, 2.49). Update GitHub CLI, or check it by hand: gh attestation verify <file> --repo ${repo}`
    }
  }
  // La atestación de ESTE archivo, por su hash, sin credenciales.
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  let bundles
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/attestations/sha256:${hash}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dotrino-update' }
    })
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
    bundles = ((await r.json())?.attestations || []).map((a) => a?.bundle).filter(Boolean)
  } catch (e) {
    return { ok: false, code: 'NO_ATTESTATION', reason: `could not fetch the attestation of this file: ${e.message}` }
  }
  if (!bundles.length) {
    return { ok: false, code: 'NO_ATTESTATION', reason: `GitHub has no attestation for this file (sha256 ${hash}): it was not built by the release of ${repo}` }
  }
  const bundleFile = path.join(path.dirname(file), 'attestation.jsonl')
  fs.writeFileSync(bundleFile, bundles.map((b) => JSON.stringify(b)).join('\n') + '\n')
  try {
    const out = run(gh, ['attestation', 'verify', file, '--repo', repo, '--bundle', bundleFile], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      // Sin sesión a propósito: si hubiera una, no se usa ni se necesita.
      env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' }
    })
    return { ok: true, out: String(out || '').trim() }
  } catch (e) {
    return { ok: false, code: 'BAD_SIGNATURE', reason: `the signature does not check out: ${String(e.stderr || e.message).trim().slice(0, 300)}` }
  }
}

/**
 * `gh` del PATH, o el de `~/.local/bin` si no está ahí: un servicio de systemd no suele tener
 * esa carpeta en su PATH, y es donde se instala `gh` sin permisos de administrador.
 */
function findGh () {
  const local = path.join(os.homedir(), '.local', 'bin', 'gh')
  return fs.existsSync(local) && !(process.env.PATH || '').split(':').some((d) => fs.existsSync(path.join(d, 'gh'))) ? local : 'gh'
}

/** Bajar y verificar, que es lo que casi siempre se quiere junto. No instala: eso es del producto. */
export async function fetchVerified (asset, { repo, ...rest } = {}) {
  const file = await download(asset, rest)
  const v = await verifyArtifact(file, { repo, run: rest.run, fetchImpl: rest.fetchImpl })
  return v.ok ? { ok: true, file, out: v.out } : { ...v, file }
}
