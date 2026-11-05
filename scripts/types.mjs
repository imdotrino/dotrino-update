/**
 * LOS TIPOS PUBLICADOS SALEN DEL CÓDIGO. Genera `types/` con `tsc` (los `.d.ts` de cada
 * subruta, sacados del JSDoc) y copia al lado `src/types.d.ts`, que es la forma de los datos
 * escrita a mano y a la que apuntan los generados (`import('./types.js')`).
 *
 * Uso: `node scripts/types.mjs [dirDeSalida]` (por defecto, `types/`). La prueba
 * `test/types-up-to-date.test.mjs` lo corre en un directorio aparte y compara.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.resolve(process.argv[2] || path.join(root, 'types'))
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

fs.rmSync(out, { recursive: true, force: true })
execFileSync(process.execPath, [tsc, '-p', path.join(root, 'tsconfig.types.json'), '--outDir', out], { cwd: root, stdio: 'inherit' })
fs.copyFileSync(path.join(root, 'src', 'types.d.ts'), path.join(out, 'types.d.ts'))
