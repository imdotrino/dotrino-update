/**
 * EL AVISO EN UN COMANDO, que es otro problema que el de un daemon.
 *
 * Un daemon mira una vez al día y no le corre prisa (`watchForUpdate`). Un comando dura
 * medio segundo y se invoca cien veces al día, así que aquí manda una regla por encima de
 * todo: **avisar no puede hacer lenta la orden**. Un `dotrino-env run` que tarda dos
 * segundos más porque fue a preguntar a npm es peor que no avisar.
 *
 * Por eso:
 *
 *   · se mira **una vez al día**, y entre medias se lee de una caché en disco;
 *   · la consulta va al FINAL, cuando el trabajo ya está hecho, con un tope de 1,5 s;
 *   · el aviso sale por **stderr**, nunca por stdout — lo de un comando se canaliza
 *     (`dotrino-env run` mete su salida en otro programa) y meterle una línea de cortesía
 *     ahí dentro es romperle la tubería a alguien;
 *   · `DOTRINO_NO_UPDATE_NOTICE=1` lo apaga, y no hace falta explicar por qué alguien
 *     quiere eso en un script.
 *
 * Nunca lanza. Un fallo al mirar si hay versión nueva no puede tumbar el comando que el
 * usuario sí quería.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkForUpdate, isNewer, CHECK_EVERY_MS } from './index.js'

/** Donde se recuerda lo último visto. XDG, y si no hay, `~/.cache`. */
export function cacheFile (key, { home = os.homedir(), env = process.env } = {}) {
  const base = env.XDG_CACHE_HOME || path.join(home, '.cache')
  return path.join(base, 'dotrino', 'update', `${String(key).replace(/[^\w.@-]/g, '_')}.json`)
}

const leer = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (_) { return null } }
const escribir = (f, v) => {
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, JSON.stringify(v))
  } catch (_) { /* sin caché se mira más de la cuenta, y ya está */ }
}

/**
 * ¿Hay que decir algo? Devuelve la línea, o `null`.
 *
 * Lo que se sabe sale de la caché (instantáneo). Si la caché está vieja, SE MIRA aquí —con
 * tope— y se guarda para la próxima. Ese es el único momento en que esto cuesta tiempo, una
 * vez al día.
 */
export async function updateNotice ({
  current, product, source, pkg, repo,
  everyMs = CHECK_EVERY_MS, timeoutMs = 1500, now = Date.now(),
  env = process.env, ...rest
} = {}) {
  if (env.DOTRINO_NO_UPDATE_NOTICE === '1') return null
  const key = pkg || repo || product
  const file = cacheFile(key, { env })
  const visto = leer(file)

  let latest = visto?.version
  if (!visto || (now - (visto.checkedAt || 0)) > everyMs) {
    const r = await checkForUpdate({ current, source, pkg, repo, timeoutMs, ...rest })
    // No se pudo mirar: se deja la caché como estaba. Lo que NO se hace es apuntar «al día»,
    // que convertiría una red caída en una máquina que se cree actualizada para siempre.
    if (r.ok) { latest = r.version; escribir(file, { version: r.version, checkedAt: now }) }
  }

  if (!latest || !isNewer(latest, current)) return null
  return `hay ${product || key} ${latest} publicada (esta es la ${current})`
}

/**
 * Lo mismo, ya impreso y a prueba de todo. Es lo que un comando llama al terminar:
 *
 *     process.on('exit', …)  NO sirve — esto es asíncrono.
 *     await printUpdateNotice({ current: VERSION, source: 'npm', pkg: '@dotrino/env' })
 */
export async function printUpdateNotice (opts = {}) {
  try {
    const linea = await updateNotice(opts)
    if (linea) process.stderr.write(`\n${linea}${opts.how ? ` · ${opts.how}` : ''}\n`)
    return !!linea
  } catch (_) { return false }
}
