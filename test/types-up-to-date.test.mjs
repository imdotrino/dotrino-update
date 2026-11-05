/**
 * LOS TIPOS PUBLICADOS DE LAS SUBRUTAS SALEN DEL CÓDIGO (`npm run types`), y esta prueba
 * comprueba que no se quedaron atrás: se generan otra vez en un directorio aparte y se
 * comparan con los de `types/`. Un tipo que no casa con el código es peor que ninguno.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('types/ está al día con el código', { skip: fs.existsSync(tsc) ? false : 'sin typescript instalado' }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'update-types-'))
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'types.mjs'), out], { cwd: root, stdio: 'pipe' })
    const fresh = fs.readdirSync(out).sort()
    assert.deepEqual(fs.readdirSync(path.join(root, 'types')).sort(), fresh, 'types/ tiene archivos de más o de menos: npm run types')
    for (const f of fresh) {
      assert.equal(fs.readFileSync(path.join(root, 'types', f), 'utf8'), fs.readFileSync(path.join(out, f), 'utf8'), `types/${f} desactualizado: npm run types`)
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('cada subruta de exports declara sus tipos, y el archivo existe', () => {
  for (const [sub, target] of Object.entries(pkg.exports)) {
    assert.equal(typeof target, 'object', `${sub}: sin condiciones (falta types)`)
    assert.ok(target.types, `${sub}: sin types`)
    assert.ok(fs.existsSync(path.join(root, target.types)), `${sub}: no existe ${target.types}`)
    const js = path.basename(target.import, '.js')
    assert.equal(path.basename(target.types, '.d.ts'), js, `${sub}: types no corresponde a ${target.import}`)
  }
})
