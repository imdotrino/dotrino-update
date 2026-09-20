/**
 * EL AVISO DE UN COMANDO: que avise, que no moleste y que no mienta.
 *
 * La regla que ordena todo esto es que **avisar no puede hacer lenta la orden**. Un
 * `dotrino-env run` que tarda dos segundos más por ir a preguntar a npm es peor que no
 * avisar, así que se mira una vez al día y lo demás sale de la caché.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { updateNotice, cacheFile } from '../src/notice.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notice-'))
const ok = (v) => { let n = 0; const f = async () => { n++; return { ok: true, json: async () => ({ latest: v }) } }; f.veces = () => n; return f }
const cae = () => async () => ({ ok: false, status: 503 })
const base = (dir) => ({ current: '0.1.0', source: 'npm', pkg: '@dotrino/env', product: 'dotrino-env', env: { XDG_CACHE_HOME: dir } })

test('avisa cuando hay versión nueva, y calla cuando no', async () => {
  const d = tmp()
  assert.match(await updateNotice({ ...base(d), fetchImpl: ok('0.2.0') }), /0\.2\.0/)
  assert.equal(await updateNotice({ ...base(tmp()), current: '0.2.0', fetchImpl: ok('0.2.0') }), null)
})

test('una vez al día: la segunda invocación NO vuelve a preguntar', async () => {
  const d = tmp()
  const f = ok('0.2.0')
  await updateNotice({ ...base(d), fetchImpl: f })
  await updateNotice({ ...base(d), fetchImpl: f })
  await updateNotice({ ...base(d), fetchImpl: f })
  assert.equal(f.veces(), 1, 'preguntó ' + f.veces() + ' veces: eso es tiempo en CADA comando')

  // Pasado el plazo, sí.
  await updateNotice({ ...base(d), fetchImpl: f, now: Date.now() + 25 * 60 * 60_000 })
  assert.equal(f.veces(), 2)
})

/**
 * Lo que NO puede pasar: que una red caída deje la caché diciendo «al día». Sería una
 * máquina convencida para siempre de que está actualizada — el fallo que esto viene a
 * arreglar, pero peor, porque ahora tendría una pantalla confirmándolo.
 */
test('si no se pudo mirar, la caché NO se pisa con un «al día»', async () => {
  const d = tmp()
  await updateNotice({ ...base(d), fetchImpl: ok('0.2.0') })          // caché: hay 0.2.0
  const f = cacheFile('@dotrino/env', { env: { XDG_CACHE_HOME: d } })
  const antes = JSON.parse(fs.readFileSync(f, 'utf8'))

  // Plazo vencido y la red caída: se sigue avisando de lo que se sabía.
  const linea = await updateNotice({ ...base(d), fetchImpl: cae(), now: Date.now() + 25 * 60 * 60_000 })
  assert.match(linea, /0\.2\.0/, 'se olvidó de lo que ya sabía')
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), antes, 'la caché quedó intacta')
})

test('se puede apagar, porque en un script estorba', async () => {
  const d = tmp()
  const r = await updateNotice({ ...base(d), env: { XDG_CACHE_HOME: d, DOTRINO_NO_UPDATE_NOTICE: '1' }, fetchImpl: ok('0.9.0') })
  assert.equal(r, null)
})

test('la primera vez, sin caché y sin red, no dice nada ni revienta', async () => {
  assert.equal(await updateNotice({ ...base(tmp()), fetchImpl: cae() }), null)
})
