/**
 * @dotrino/update/integrity — EL LADO DE CI de la verificación de un paquete de npm.
 *
 * El `release.yml` de cada repo mide el `.tgz` que va a publicar y adjunta el resultado a
 * SU release de GitHub (`npm-integrity.json`). La pieza que se actualiza baja el tarball de
 * npm y ese JSON de GitHub, y exige que coincidan (`./npm`, `verifyNpmPackage`): son dos
 * canales distintos, y para colar un paquete hay que comprometer los dos.
 *
 * Sin dependencias: el tarball se abre aquí mismo (gzip de Node + la cabecera de tar, que
 * son 512 bytes con el nombre y el tamaño), solo para leer su `package/package.json`.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import crypto from 'node:crypto'

export const INTEGRITY_FILE = 'npm-integrity.json'

const fail = (code, message) => Object.assign(new Error(message), { code })

/** El `integrity` de npm de esos bytes: `sha512-<base64>`. */
export const integrityOf = (bytes) => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64')

/** `{ name, version }` del `package/package.json` de un `.tgz` de `npm pack`. */
export function packageOfTarball (bytes) {
  let tar
  try { tar = zlib.gunzipSync(bytes) } catch (e) { throw fail('bad-tarball', `not a gzip tarball: ${e.message}`) }
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512)
    if (head.every((b) => b === 0)) break
    const str = (from, len) => { const s = head.subarray(from, from + len); const end = s.indexOf(0); return s.subarray(0, end === -1 ? len : end).toString('utf8') }
    const prefix = str(345, 155)
    const name = (prefix ? prefix + '/' : '') + str(0, 100)
    const size = parseInt(str(124, 12).trim() || '0', 8)
    if (!Number.isFinite(size)) throw fail('bad-tarball', 'unreadable tar header')
    if (name === 'package/package.json') {
      let pkg
      try { pkg = JSON.parse(tar.subarray(at + 512, at + 512 + size).toString('utf8')) } catch (e) { throw fail('bad-tarball', `its package.json cannot be read: ${e.message}`) }
      if (typeof pkg?.name !== 'string' || typeof pkg?.version !== 'string') throw fail('bad-tarball', 'its package.json has no name or version')
      return { name: pkg.name, version: pkg.version }
    }
    at += 512 + Math.ceil(size / 512) * 512
  }
  throw fail('bad-tarball', 'no package/package.json inside: is this the output of `npm pack`?')
}

/**
 * El contenido de `npm-integrity.json` para esos `.tgz`:
 * `{ v: 1, packages: { "<nombre>": { version, integrity } } }`. Un repo puede publicar varios
 * paquetes; dos tarballs del MISMO paquete es un error, no «gana el último».
 */
export function buildIntegrity (files, { readFile = fs.readFileSync } = {}) {
  if (!files?.length) throw fail('no-files', 'buildIntegrity: at least one .tgz is required')
  const packages = {}
  for (const f of files) {
    const bytes = readFile(f)
    const { name, version } = packageOfTarball(bytes)
    if (packages[name]) throw fail('duplicate-package', `${name} appears twice (${f})`)
    packages[name] = { version, integrity: integrityOf(bytes) }
  }
  return { v: 1, packages }
}
