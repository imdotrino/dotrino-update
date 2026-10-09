/**
 * §15, para un servicio que se despliega DESDE GIT y no usa ningún pilar.
 *
 * No tiene dependencias que se queden atrás: lo que se queda atrás es EL CHECKOUT. Un webhook
 * que falló, una carpeta copiada a mano que nunca fue un clon, un remoto que apunta al repo de
 * antes de la migración: el servicio sigue respondiendo y nadie ve que corre código de hace
 * meses. El 2026-10-08 había dos así en producción (`results` y el `deploy-listener`).
 *
 * Solo mira y lo dice. Compara el commit que corre con el de la rama en GitHub.
 */
import { execFileSync } from 'node:child_process'
import { CHECK_EVERY_MS } from './index.js'

const short = (sha) => String(sha).slice(0, 7)
const git = (run, dir, args) => String(run('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim()

/**
 * ¿Lo que corre es lo que hay en la rama? Cuatro respuestas, y ninguna se confunde con otra:
 *
 *   { ok: true,  behind: false, running, latest }   al día (o por delante: una máquina de desarrollo)
 *   { ok: true,  behind: true,  running, latest }   la rama tiene un commit que aquí no está
 *   { ok: false, code: 'not-a-checkout', reason }   no es un clon de git: no se sabe qué corre
 *   { ok: false, code: 'could-not-check', reason }  no se pudo mirar — NO es «al día»
 */
export async function checkCheckout ({
  dir, repo, branch = 'main', fetchImpl = fetch, timeoutMs = 10_000, run = execFileSync
} = {}) {
  if (!dir || !repo) return { ok: false, code: 'could-not-check', reason: 'checkCheckout: `dir` and `repo` are required' }
  let running
  try { running = git(run, dir, ['rev-parse', 'HEAD']) } catch (_) {
    return { ok: false, code: 'not-a-checkout', reason: `${dir} is not a git checkout` }
  }
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  let latest
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, {
      signal: ac.signal, headers: { accept: 'application/vnd.github+json', 'user-agent': 'dotrino-update (+https://dotrino.com)' }
    })
    if (!r.ok) return { ok: false, code: 'could-not-check', reason: `api.github.com answered ${r.status}` }
    latest = (await r.json())?.sha
  } catch (e) {
    return { ok: false, code: 'could-not-check', reason: e.name === 'AbortError' ? 'timed out' : e.message }
  } finally { clearTimeout(t) }
  if (!/^[0-9a-f]{40}$/.test(String(latest))) return { ok: false, code: 'could-not-check', reason: `unreadable commit: ${latest}` }
  if (latest === running) return { ok: true, behind: false, running, latest }
  // Distinto no es «atrás»: en una máquina de desarrollo el checkout va por DELANTE. Atrás es
  // cuando el commit de la rama no está contenido en lo que corre.
  let contained = false
  try { git(run, dir, ['merge-base', '--is-ancestor', latest, 'HEAD']); contained = true } catch (_) {}
  return { ok: true, behind: !contained, running, latest }
}

/**
 * El vigía: mira al arrancar y una vez al día. Devuelve cómo pararlo.
 *
 *   watchCheckout({ dir: __dirname, repo: 'imdotrino/dotrino-signer', name: 'signer' })
 *
 * Que no sea un clon se dice UNA vez (no se arregla solo, y repetirlo cada día es ruido).
 * Que no se pueda mirar no se dice: no es problema de quien lee el log.
 */
export function watchCheckout ({ name = 'service', log = console.log, onBehind, everyMs = CHECK_EVERY_MS, ...rest } = {}) {
  let stopped = false
  let saidNotCheckout = false
  const look = async () => {
    const r = await checkCheckout(rest)
    if (stopped) return
    if (!r.ok) {
      if (r.code === 'not-a-checkout' && !saidNotCheckout) {
        saidNotCheckout = true
        log(`[update] ${name}: ${r.reason}: cannot tell which commit is running`)
      }
      return
    }
    if (!r.behind) return
    log(`[update] ${name}: ${rest.repo}@${rest.branch || 'main'} is at ${short(r.latest)} and this is running ${short(r.running)}: the deploy did not land`)
    try { onBehind?.(r) } catch (_) {}
  }
  look()
  const t = setInterval(look, everyMs)
  t.unref?.()
  return () => { stopped = true; clearInterval(t) }
}
