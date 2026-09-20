# @dotrino/update

Enterarse de que hay versión nueva, y traerla **verificada** cuando lo diga una persona.

Lo usan los daemons, servicios y CLIs del ecosistema: el vault, el proxio, geo, reputation,
los selladores, los agentes.

## Por qué existe

El 2026-09-19 el replicador de Cepi llevaba **quince días** corriendo la 0.98.0 y las dos
bóvedas estaban en la 0.121.0 con la 0.123.0 publicada. Ninguna pantalla lo decía. Instalar
fueron tres comandos; enterarse costó una tarde.

## La línea que no se cruza

> no existe ningún interruptor remoto. Nadie —tampoco Dotrino— puede dejar sin funcionar el
> software que alguien se instaló en su máquina. — `CLAUDE.md`

Un auto-descargador es esa misma puerta en el otro sentido. Por eso esto son **dos mitades**
y solo una es automática:

| | Quién lo dispara | Puede romper algo |
|---|---|---|
| **Mirar** (`checkForUpdate`, `watchForUpdate`) | la pieza, sola, una vez al día | no: es una lectura |
| **Traer** (`fetchVerified`) | una persona | por eso verifica antes de tocar el disco |

## Mirar

```js
import { watchForUpdate } from '@dotrino/update'

// Un servicio que corre desde npm
watchForUpdate({
  current: VERSION, source: 'npm', pkg: '@dotrino/vaultd',
  onNewer: (r) => log(`[svc] hay ${r.version} publicada (esta es la ${r.current})`)
})

// Una pieza que se baja como binario de su release
watchForUpdate({ current: VERSION, source: 'github', repo: 'imdotrino/dotrino-vault', onNewer })
```

`checkForUpdate` contesta una de tres, y **nunca** confunde dos de ellas:

```js
{ ok: true,  newer: true,  version: '0.123.0' }   // hay
{ ok: true,  newer: false }                        // al día
{ ok: false, reason: 'timed out' }                 // NO SE PUDO MIRAR ≠ al día
```

Esa última distinción es el punto entero: una máquina que no pudo preguntar no está al día,
está sin saber. Tratarlas igual es cómo algo pasa quince días atrás pareciendo sano.

## Traer

```js
import { pickAsset, fetchVerified } from '@dotrino/update/fetch'

const { asset, kind } = pickAsset(r.assets, [
  { kind: 'deb', re: /_amd64\.deb$/, when: () => fs.existsSync('/usr/bin/dpkg') },
  { kind: 'tar', re: /-linux-x64\.tar\.gz$/ }
])
const v = await fetchVerified(asset, { repo: 'imdotrino/dotrino-vault' })
if (!v.ok) { console.error(v.reason); process.exit(1) }   // NO se instala nada
```

La verificación es `gh attestation verify` contra la atestación de sigstore que el
`release.yml` deja al construir: ata el archivo a su commit y a su workflow. **Sin `gh` no
hay con qué comprobar, así que se para y se dice** — no se instala «porque la URL era la
buena», que es exactamente lo que cree quien ya está siendo atacado.

Para que esto funcione, el `release.yml` del producto tiene que atestiguar sus artefactos:

```yaml
- uses: actions/attest-build-provenance@v1
  with:
    subject-path: |
      dist/*.deb
      dist/*.tar.gz
```

## En un comando (`dotrino-env`, `dotrino-vault`, los agentes)

Un daemon mira una vez al día y no le corre prisa. Un comando dura medio segundo y se
invoca cien veces al día, así que aquí manda otra regla: **avisar no puede hacer lenta la
orden**.

```js
import { printUpdateNotice } from '@dotrino/update/notice'

// AL FINAL del comando, cuando el trabajo ya está hecho
await printUpdateNotice({
  current: VERSION, source: 'npm', pkg: '@dotrino/env', product: 'dotrino-env',
  how: 'actualiza con: npm i -g @dotrino/env'
})
```

- Se mira **una vez al día**; el resto sale de una caché (`~/.cache/dotrino/update/`).
- Tope de **1,5 s**, y solo en la consulta que toca.
- Sale por **stderr**, nunca por stdout: lo de un comando se canaliza —`dotrino-env run`
  mete su salida en otro programa— y colarle ahí una línea de cortesía es romperle la
  tubería a alguien.
- `DOTRINO_NO_UPDATE_NOTICE=1` lo apaga.
- Si no se pudo mirar, **la caché no se pisa**: apuntar «al día» cuando lo que pasó es que
  no había red deja una máquina convencida para siempre de que está actualizada.

## Instalar

No lo hace este paquete: dónde va un binario es cosa de cada producto (un `.deb` pide root,
un tarball no, y un servicio de npm ni siquiera se instala así). Esto deja el archivo
verificado y dice dónde.

## Licencia

MIT
