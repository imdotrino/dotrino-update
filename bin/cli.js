#!/usr/bin/env node
/**
 * `dotrino-update integrity <archivo.tgz>…` — imprime el `npm-integrity.json` de esos
 * tarballs. Es lo que corre el `release.yml` de cada repo, por npx:
 *
 *   npx --yes @dotrino/update@latest integrity *.tgz > npm-integrity.json
 */
import { buildIntegrity } from '../src/integrity.js'

const [cmd, ...args] = process.argv.slice(2)
if (cmd !== 'integrity' || !args.length || args.some((a) => a.startsWith('-'))) {
  console.error('usage: dotrino-update integrity <file.tgz>... > npm-integrity.json')
  process.exit(2)
}
try {
  process.stdout.write(JSON.stringify(buildIntegrity(args), null, 2) + '\n')
} catch (e) {
  console.error(`dotrino-update integrity: ${e.message}`)
  process.exit(1)
}
