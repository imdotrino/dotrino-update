/**
 * §15, para un servicio que se despliega DESDE GIT.
 *
 * Su propio código es siempre el de `main`: lo que se queda atrás son sus DEPENDENCIAS. Van
 * con versión exacta (CONVENCIONES §1.1) y nadie las sube si nadie se entera. Así corrió el
 * proxio meses con `@dotrino/vault` 0.52 mientras la bóveda iba por la 0.78 (2026-09-30).
 *
 * Solo mira y lo dice, una vez al día. Subir la versión lo decide una persona, con un commit.
 */
import fs from 'node:fs'
import path from 'node:path'
import { watchForUpdate } from './index.js'

const fail = (message, code) => Object.assign(new Error(message), { code })

/**
 * Las dependencias de `dir/package.json` que cumplen `match`, con la versión INSTALADA
 * (la de `node_modules`, que es la que corre), no la que pide el `package.json`.
 *
 * Lanza si no puede leer algo: una dependencia declarada y sin instalar es un despliegue a
 * medias, y callarlo sería decir «al día» sin haber mirado.
 */
export function installedDeps ({ dir, match = /^@dotrino\// } = {}) {
  if (!dir) throw fail('installedDeps: `dir` is required', 'deps-no-dir')
  let pkg
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch (e) {
    throw fail(`installedDeps: cannot read ${path.join(dir, 'package.json')}: ${e.message}`, 'deps-unreadable')
  }
  return Object.keys(pkg.dependencies || {}).filter((name) => match.test(name)).map((name) => {
    const file = path.join(dir, 'node_modules', name, 'package.json')
    try { return { pkg: name, version: JSON.parse(fs.readFileSync(file, 'utf8')).version } } catch (e) {
      throw fail(`installedDeps: ${name} is declared and not installed (${file}): ${e.message}`, 'deps-not-installed')
    }
  })
}

/**
 * El vigía de las dependencias de un servicio: uno por cada pilar que usa. Devuelve cómo
 * pararlos todos. `log` recibe una línea, en inglés, cuando hay algo más nuevo.
 *
 *   watchDependencies({ dir: __dirname, name: 'geo' })
 */
export function watchDependencies ({ dir, match, name = 'service', log = console.log, onNewer, ...rest } = {}) {
  const stops = installedDeps({ dir, match }).map(({ pkg, version }) => watchForUpdate({
    ...rest,
    current: version,
    source: 'npm',
    pkg,
    onNewer: (r) => {
      log(`[update] ${name}: ${pkg} ${r.version} is available (running ${r.current}): bump it in package.json`)
      onNewer?.({ ...r, pkg })
    }
  }))
  return () => { for (const stop of stops) stop() }
}
