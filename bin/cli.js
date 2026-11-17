#!/usr/bin/env node
/**
 * `dotrino-update integrity <archivo.tgz>…` — imprime el `npm-integrity.json` de esos
 * tarballs. Es lo que corre el `release.yml` de cada repo, por npx:
 *
 *   npx --yes @dotrino/update@latest integrity *.tgz > npm-integrity.json
 *
 * `dotrino-update sources` — el directorio de fuentes (dónde está cada pieza):
 *
 *   dotrino-update sources                 el que manda en esta máquina, y de dónde salió
 *   dotrino-update sources keygen          un par nuevo para firmarlo (la privada, al cajón)
 *   dotrino-update sources sign <dir.json> lo firma; la llave en DOTRINO_SOURCES_KEY (DER base64 o PEM)
 *                                          y DOTRINO_SOURCES_KID. Por ejemplo:
 *     dotrino-env run --ns sources -- dotrino-update sources sign dir.json > sources.json
 *
 * `dotrino-update mirror` — rellena el espejo propio (lo corre el release.yml, src/mirror.js):
 *
 *   dotrino-update mirror [--repo owner/name --tag vX.Y.Z] [--lock package-lock.json]
 *                         [--release <archivo>]… [--base <url>] [--upload s3://bucket] <x.tgz>…
 *   Sin --upload solo lista lo que subiría.
 */
import fs from 'node:fs'
import { buildIntegrity } from '../src/integrity.js'
import { loadSources, signSources, generateSourcesKey, validateSources } from '../src/sources.js'
import { buildMirror, uploadMirror } from '../src/mirror.js'

const USAGE = `usage: dotrino-update integrity <file.tgz>... > npm-integrity.json
       dotrino-update sources [keygen | sign <directory.json>]
       dotrino-update mirror [--repo R --tag T] [--lock F] [--release F]... [--base URL] [--upload s3://B] <x.tgz>...`

const [cmd, ...args] = process.argv.slice(2)
/** @param {string} msg */
const die = (msg, code = 1) => { console.error(msg); process.exit(code) }

try {
  if (cmd === 'integrity') {
    if (!args.length || args.some((a) => a.startsWith('-'))) die(USAGE, 2)
    process.stdout.write(JSON.stringify(buildIntegrity(args), null, 2) + '\n')
  } else if (cmd === 'sources' && !args.length) {
    const { sources, from, file } = loadSources()
    process.stdout.write(JSON.stringify({ from, file, ...sources }, null, 2) + '\n')
  } else if (cmd === 'sources' && args[0] === 'keygen' && args.length === 1) {
    process.stdout.write(JSON.stringify(generateSourcesKey(), null, 2) + '\n')
  } else if (cmd === 'sources' && args[0] === 'sign' && args.length === 2) {
    const privateKey = process.env.DOTRINO_SOURCES_KEY
    const kid = process.env.DOTRINO_SOURCES_KID
    if (!privateKey || !kid) die('dotrino-update sources sign: DOTRINO_SOURCES_KEY and DOTRINO_SOURCES_KID are required')
    const directory = validateSources(JSON.parse(fs.readFileSync(args[1], 'utf8')))
    process.stdout.write(JSON.stringify(signSources(directory, { privateKey: /** @type {string} */ (privateKey), kid: /** @type {string} */ (kid) })) + '\n')
  } else if (cmd === 'mirror') {
    /** @type {{ repo?: string, tag?: string, lock?: string, base?: string, upload?: string, release: string[], tgz: string[] }} */
    const o = { release: [], tgz: [] }
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      const val = () => { const v = args[++i]; if (!v || v.startsWith('--')) die(`dotrino-update mirror: ${a} needs a value`, 2); return v }
      if (a === '--repo') o.repo = val()
      else if (a === '--tag') o.tag = val()
      else if (a === '--lock') o.lock = val()
      else if (a === '--base') o.base = val()
      else if (a === '--upload') o.upload = val()
      else if (a === '--release') o.release.push(val())
      else if (a.startsWith('--')) die(USAGE, 2)
      else o.tgz.push(a)
    }
    if (!o.tgz.length && !o.lock && !o.release.length) die(USAGE, 2)
    const log = (/** @type {string} */ m) => console.error(m)
    const files = await buildMirror({ tarballs: o.tgz, releaseFiles: o.release, repo: o.repo, tag: o.tag, lock: o.lock || null, ...(o.base ? { base: o.base } : {}), log })
    if (o.upload) console.error(`mirror: ${uploadMirror(files, { bucket: o.upload, log })} file(s) uploaded to ${o.upload}`)
    else for (const f of files) process.stdout.write(`${f.key}\t${f.body.length}\n`)
  } else {
    die(USAGE, 2)
  }
} catch (e) {
  die(`dotrino-update ${cmd}: ${/** @type {Error} */ (e).message}`)
}
