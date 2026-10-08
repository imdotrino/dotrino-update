# @dotrino/update

Enterarse de que hay versión nueva, traerla **verificada** e instalarla sola.

Lo usan los daemons, servicios y CLIs del ecosistema: el vault, el proxio, geo, reputation,
los selladores, los agentes.

## Por qué existe

El 2026-09-19 el replicador de Cepi llevaba **quince días** corriendo la 0.98.0 y las dos
bóvedas estaban en la 0.121.0 con la 0.123.0 publicada. Ninguna pantalla lo decía. Instalar
fueron tres comandos; enterarse costó una tarde.

## La línea que no se cruza

> no existe ningún interruptor remoto. Nadie —tampoco Dotrino— puede dejar sin funcionar el
> software que alguien se instaló en su máquina. — `CLAUDE.md`

Nada de esto lo dispara Dotrino: la pieza mira el registro público por su cuenta. Y lo que
baja **se comprueba antes de tocar el disco**; si no se puede comprobar, no se instala.

| | Quién lo dispara | Qué lo protege |
|---|---|---|
| **Mirar** (`checkForUpdate`, `watchForUpdate`) | la pieza, sola, una vez al día | es una lectura |
| **Traer un binario** (`fetchVerified`) | el producto | atestación de sigstore del release |
| **Actualizarse por npm** (`./npm`) | la pieza, sola (decisión del dueño, 2026-10-08) | procedencia de npm firmada; y aprobación, si esa instancia la encendió |

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

## Actualizarse sola por npm (`@dotrino/update/npm`)

Para un daemon instalado con `npm install -g`. **Por defecto se actualiza sin preguntar y
avisa de que lo hizo.** Las dos cosas son preferencias de **cada instancia** (no de la
bóveda), en `update-prefs.json` dentro de su carpeta de datos.

```js
import { watchSelfUpdateNpm, updatePrefsCommand, updateStatusText } from '@dotrino/update/npm'

const stop = watchSelfUpdateNpm({
  pkg: '@dotrino/terminal-agent',            // el paquete que corre
  current: VERSION,                          // su versión, la que está en marcha
  repo: 'imdotrino/dotrino-terminal',        // de dónde tiene que haber salido
  dir: instanceDir,                          // carpeta de datos de ESTA instancia
  // Solo se llama si la instancia encendió `approval`. true = sí · false = no o venció · lanza = no pude preguntar.
  mayUpdate: ({ pkg, version, from }) => askTheVault({ product: pkg, version, from }),
  // Con la versión nueva ya en el disco. `restart` solo es true si hay quien lo levante.
  onInstalled: async ({ version, restart }) => { if (restart) { await closeCleanly(); process.exit(0) } },
  // Una vez, al arrancar ya en la versión nueva, si la instancia no apagó `notify`.
  onUpdated: ({ version, from }) => tellTheVault({ product: pkg, version, from }),
  onResult: (r) => { lastUpdate = r },       // para la pantalla de estado
  log: (line) => console.log(line)
})

// En la CLI del agente: `<agente> update [--approval on|off] [--notify on|off]`
const r = updatePrefsCommand(args, { dir: instanceDir, lang })
if (r.handled) { (r.ok ? console.log : console.error)(r.text); process.exit(r.ok ? 0 : 2) }

// En su `info`/estado: una línea, o '' si no hay nada que decir.
const line = updateStatusText({ dir: instanceDir, current: VERSION, lang })
```

Mira al arrancar y una vez al día; si no pudo mirar, reintenta en una hora.

### Las dos preferencias de cada instancia

`readUpdatePrefs(dir)` → `{ approval, notify }` · `writeUpdatePrefs(dir, { approval?, notify? })`
cambia solo lo que se le pasa y devuelve cómo quedaron.

| | Por defecto | Qué hace |
|---|---|---|
| `approval` | `false` | apagada: se instala sin llamar a `mayUpdate`. Encendida: sin un sí no se instala |
| `notify` | `true` | avisar (`onUpdated`) cuando la versión nueva ya corre |

Un archivo que existe y no se puede leer **no** es «los valores por defecto»: lanza con
`code: 'prefs-unreadable'`, y `selfUpdateNpm` no instala.

### El contrato de `mayUpdate` (solo con `approval` encendida)

Se pide **una vez por versión**; el permiso vale un día y vencido es no.

| `mayUpdate` | Significa | Qué pasa |
|---|---|---|
| devuelve `true` | sí | se verifica y se instala |
| devuelve `false` (o cualquier otra cosa) | no, **o pasó un día sin respuesta** | queda apuntado: esa versión **no se vuelve a preguntar**. Solo una versión más nueva dispara otro pedido |
| **lanza** | no se pudo preguntar (la bóveda no contesta, no hay red) | **no es una negativa**: no se apunta nada y se reintenta en la próxima pasada |

Lo preguntado se apunta **al pedir** (`update-asked.json`: `{ pkg, version, askedAt, result }`),
así que un reinicio con el pedido a medias cuenta como ya preguntada. Por eso `mayUpdate`
tiene que esperar la respuesta (hasta un día) y devolver `false` al vencer, no lanzar.
`updateStatusText` lo enseña: *«se pidió permiso para instalar la X el <fecha> y no se
aprobó: no se vuelve a pedir · instálala con: npm i -g <pkg>@X»*.

### Avisar de que se actualizó

Al instalar, `selfUpdateNpm` deja en `dir` un marcador (`updated.json`: `{ from, to, at }`).
Al arrancar, si la versión que corre es la instalada, `onUpdated({ version, from })` se llama
una vez y el marcador se borra; **si `onUpdated` lanza, el marcador se queda** y se reintenta
en el próximo arranque. Con `notify` apagada no se llama. Para quien arme otro flujo:
`takeUpdateMarker({ dir, current })` → `{ from, to }` (y lo borra) o `null`.

**Qué se actualiza solo** (`installKind()`):

| Instalación | ¿Sola? | Si no, qué se dice |
|---|---|---|
| `global` — cuelga de la raíz global de npm (también con nvm o un prefijo de usuario) | sí | — |
| `global` en un prefijo de root (`/usr/lib/node_modules`) | no: `needs-root` | `sudo npm install -g …`, o pasar a un Node de usuario |
| `npx` — la caché `_npx` | no | `npx <paquete>@latest`, o instalarlo global |
| `local` — el `node_modules` de un proyecto | no | manda el lockfile de ese proyecto |
| `source` — un checkout de git | no | se actualiza con git o con su despliegue |

**Qué devuelve** `selfUpdateNpm` (y `onResult`): `{ ok, code, version?, from?, reason? }`.
Nunca lanza.

| `code` | `ok` | Qué pasó |
|---|---|---|
| `up-to-date` | sí | no hay nada más nuevo |
| `installed` | sí | instalada; nadie lo levanta, así que sigue con la vieja hasta el próximo arranque |
| `installed-restart` | sí | instalada, y `onInstalled` recibió `restart: true` |
| `could-not-check` | no | no se pudo mirar — **no es «al día»** |
| `not-self-updating` | no | no es una instalación global (`kind` dice cuál) |
| `needs-root` | no | el prefijo global no es de este usuario; no se intentó |
| `prefs-unreadable` | no | las preferencias de la instancia existen y no se pueden leer |
| `asked-unreadable` | no | lo ya preguntado existe y no se puede leer (o no se pudo apuntar) |
| `no-approver` | no | `approval` encendida y no se pasó `mayUpdate`: no hay a quién preguntar |
| `could-not-ask` | no | `mayUpdate` lanzó: se reintenta en la próxima pasada (`why` trae su `code`) |
| `not-approved` | no | `mayUpdate` no devolvió `true`; esa versión no se vuelve a preguntar |
| `already-declined` | no | esa versión ya se preguntó y no se aprobó (`askedAt`) |
| `unverified` | no | la procedencia no se pudo comprobar (`why` trae el motivo) |
| `install-failed` | no | npm falló, o dijo que sí y dejó otra versión |

**Qué garantiza la verificación** (`verifyNpmPackage({ pkg, version, repo, workflow? })`).
Baja el tarball y la procedencia SLSA que npm guarda de esa versión, y `gh attestation
verify` comprueba, sin sesión ni token, que la firma de sigstore es válida, que se emitió a
una ejecución de `<repo>/.github/workflows/release.yml`, y que lo firmado es **ese** tarball
(su sha512). Después se instala **ese mismo archivo**, no una segunda descarga.

**Qué no garantiza:**

- Las **dependencias** del paquete: las resuelve npm al instalar, con su comprobación de
  integridad, no con esta.
- Que el código del repo sea bueno: ata el paquete a su workflow, no audita lo que compiló.
- Nada, si no hay con qué: sin `gh` ≥ 2.49 (`NO_GH`, `GH_TOO_OLD`), sin red
  (`REGISTRY_UNREACHABLE`, `DOWNLOAD_FAILED`) o sin procedencia (`NO_ATTESTATION`) **no se
  instala**. Los otros dos motivos son `WRONG_SOURCE` (salió de otro repo o workflow) y
  `BAD_SIGNATURE`.

Por eso **el paquete tiene que publicarse desde CI** con publicación de confianza: una
versión subida a mano no trae procedencia y ninguna pieza la instalará sola. Y la máquina
necesita `gh` (un binario de usuario en `~/.local/bin` basta, sin iniciar sesión).

Se instala con `--ignore-scripts`. Las piezas sueltas (`installKind`, `verifyNpmPackage`,
`installNpmGlobal`, `supervised`, `findNpm`, `takeUpdateMarker`) se exportan para quien arme otro flujo.

## Instalar un binario

No lo hace este paquete: dónde va un binario es cosa de cada producto (un `.deb` pide root,
un tarball no). `./fetch` deja el archivo verificado y dice dónde.

## Licencia

MIT
