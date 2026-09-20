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
 * Sin `gh` no hay con qué verificar. Entonces se PARA y se dice cómo hacerlo a mano; no se
 * instala «porque la URL era la buena», que es justo lo que cree quien ya está siendo
 * atacado.
 */
export function verifyArtifact (file, { repo, run = execFileSync } = {}) {
  if (!repo) return { ok: false, reason: 'verifyArtifact: `repo` is required' }
  try { run('gh', ['--version'], { stdio: 'ignore' }) } catch (_) {
    return {
      ok: false, code: 'NO_GH',
      reason: `gh is not installed, so the download cannot be verified. Install GitHub CLI, or check it by hand: gh attestation verify <file> --repo ${repo}`
    }
  }
  try {
    const out = run('gh', ['attestation', 'verify', file, '--repo', repo], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: String(out || '').trim() }
  } catch (e) {
    return { ok: false, code: 'BAD_SIGNATURE', reason: `the signature does not check out: ${String(e.stderr || e.message).trim().slice(0, 300)}` }
  }
}

/** Bajar y verificar, que es lo que casi siempre se quiere junto. No instala: eso es del producto. */
export async function fetchVerified (asset, { repo, ...rest } = {}) {
  const file = await download(asset, rest)
  const v = verifyArtifact(file, { repo })
  return v.ok ? { ok: true, file, out: v.out } : { ...v, file }
}
