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
| **Actualizarse por npm** (`./npm`) | la pieza, sola (decisión del dueño, 2026-10-08) | el tarball de npm tiene que cuadrar con lo que midió la release de su repo; y aprobación, si esa instancia la encendió |

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

## En un servicio desplegado desde git (`@dotrino/update/deps`)

Su código es siempre el de `main`; lo que se queda atrás son sus **dependencias**, que van
con versión exacta y nadie sube si nadie se entera.

```js
import { watchDependencies } from '@dotrino/update/deps'

// Un vigía por cada `@dotrino/*` de su package.json, contra la versión INSTALADA.
const stop = watchDependencies({ dir: __dirname, name: 'geo' })
// [update] geo: @dotrino/identity 0.109.0 is available (running 0.62.0): bump it in package.json
```

Solo mira y lo dice. Una dependencia declarada y sin instalar **lanza**
(`code: 'deps-not-installed'`): es un despliegue a medias, no «al día». `installedDeps({ dir })`
da la lista para una pantalla de estado. Desde CommonJS: `await import('@dotrino/update/deps')`.

Para un **comando** que corre desde un checkout (un bot de cron), al terminar la orden:
`await printDependencyNotices({ dir })` — una línea por stderr por cada pilar atrasado, con
la caché de un día de `printUpdateNotice`.

## Un servicio sin pilares: mirar el checkout (`@dotrino/update/checkout`)

Si no usa ningún `@dotrino/*`, no tiene dependencias que se queden atrás: lo que se queda
atrás es **el checkout**. Un webhook que falló, una carpeta copiada a mano, un remoto que
apunta al repo de antes.

```js
import { watchCheckout } from '@dotrino/update/checkout'

watchCheckout({ dir: __dirname, repo: 'imdotrino/dotrino-signer', name: 'signer' })
// [update] signer: imdotrino/dotrino-signer@main is at 3f2a9c1 and this is running cd962aa: the deploy did not land
// [update] signer: /srv/signer is not a git checkout: cannot tell which commit is running
```

`checkCheckout` contesta una de cuatro: al día, atrás, `not-a-checkout` o `could-not-check`.
Ir por delante de la rama (una máquina de desarrollo) no es ir atrás. Un servicio que sí usa
pilares puede llevar los dos vigías.

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
  tag: (v) => 'agent-v' + v,                 // solo si la release no se llama `v<versión>`
  dir: instanceDir,                          // carpeta de datos de ESTA instancia
  // Solo se llama si la instancia encendió `approval`. true = sí · false = no o venció · lanza = no pude preguntar.
  mayUpdate: ({ pkg, version, from }) => askTheVault({ product: pkg, version, from }),
  // Con la versión nueva ya en el disco. `restart` solo es true si hay quien lo levante.
  onInstalled: async ({ version, restart }) => { if (restart) { await closeCleanly(); process.exit(0) } },
  // Una vez, al arrancar ya en la versión nueva, si la instancia no apagó `notify`.
  onUpdated: ({ version, from }) => tellTheVault({ product: pkg, version, from }),
  // Hay versión nueva y el prefijo global es de root: una vez por versión, si `notify` está encendida.
  // Se conecta con `reportUpdateNeedsRoot` de `@dotrino/vault/service` (≥ 0.82.0).
  onNeedsRoot: ({ version, from }) => reportUpdateNeedsRoot({ product: pkg, version, from }),
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

### Cuando hace falta root

Si el prefijo global es de root, no se intenta nada: el resultado es `needs-root` y se llama a
`onNeedsRoot({ version, from })` para que el daemon se lo diga a los aprobadores («hay
actualización y necesita root»). **Una vez por versión** (se apunta en
`update-needs-root.json`, así que un reinicio no lo repite; una versión más nueva vuelve a
avisar), solo con `dir` y con `notify` encendida. Si `onNeedsRoot` lanza no queda como
avisado y se reintenta en la próxima pasada. `updateStatusText` también lo dice: *«hay una X
publicada y esta instalación necesita permisos de administrador para actualizarse:
instálala a mano»*.

### Avisar de que se actualizó

Al instalar, `selfUpdateNpm` deja en `dir` un marcador (`updated.json`: `{ from, to, at }`).
Al arrancar, si la versión que corre es la instalada, `onUpdated({ version, from })` se llama
una vez y el marcador se borra; **si `onUpdated` lanza, el marcador se queda** y se reintenta
en el próximo arranque. Con `notify` apagada no se llama. Para quien arme otro flujo:
`takeUpdateMarker({ dir, current })` → `{ from, to }` (y lo borra) o `null`.

**Lo preferido es instalar como usuario** (un Node de nvm, o un prefijo de npm del usuario:
`npm config set prefix ~/.local`). Es lo único que se actualiza solo.

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
| `needs-root` | no | el prefijo global no es de este usuario; no se intentó, y se avisó (`onNeedsRoot`) |
| `prefs-unreadable` | no | las preferencias de la instancia existen y no se pueden leer |
| `asked-unreadable` | no | lo ya preguntado existe y no se puede leer (o no se pudo apuntar) |
| `no-approver` | no | `approval` encendida y no se pasó `mayUpdate`: no hay a quién preguntar |
| `could-not-ask` | no | `mayUpdate` lanzó: se reintenta en la próxima pasada (`why` trae su `code`) |
| `not-approved` | no | `mayUpdate` no devolvió `true`; esa versión no se vuelve a preguntar |
| `already-declined` | no | esa versión ya se preguntó y no se aprobó (`askedAt`) |
| `unverified` | no | no cuadra con la release de su repo, o no se pudo comprobar (`why` trae el motivo) |
| `install-failed` | no | npm falló, o dijo que sí y dejó otra versión |

### La verificación: dos canales, sin firma

`verifyNpmPackage({ pkg, version, repo, tag? })` baja **el tarball de npm** y **su hash de la
release de GitHub del repo** (`https://github.com/<repo>/releases/download/<tag>/npm-integrity.json`,
que adjunta el `release.yml` al publicar). `tag` es una función `(version) => string` que da el
tag de la release de una versión; por defecto `v<versión>`. Un repo que publica su paquete junto
a otra cosa usa otro (`tag: (v) => 'agent-v' + v`), y se pasa igual a `selfUpdateNpm` y a
`watchSelfUpdateNpm`. Un `tag` que no devuelve un texto sin `/` ni espacios es `BAD_ARGS`. Calcula el sha512 de lo bajado y exige que sea el
que dice GitHub, para ese paquete y esa versión. Después se instala **ese mismo archivo**
(`--ignore-scripts`), no una segunda descarga. No necesita `gh` ni ninguna otra herramienta.

→ `{ ok: true, file, dir, integrity }` (quien llama borra `dir`) o `{ ok: false, code, reason }`.

**Qué garantiza:** lo que entrega npm es, byte a byte, lo que midió el workflow de release
de ese repo. Para colar otro paquete hay que comprometer npm **y** la release de GitHub.

**Qué no garantiza, sin adornos:**

- **No hay firma.** Antes se comprobaba la procedencia de sigstore con `gh`; se quitó (dueño,
  2026-10-08) para no exigir `gh` en cada máquina. La confianza es HTTPS hacia github.com más
  el control de la release: quien pueda editar la release del repo puede cambiar el hash, y
  no hay registro de transparencia que lo delate. La procedencia de npm se sigue publicando
  (la genera el registro al publicar desde CI), pero **esto no la comprueba**.
- Las **dependencias** del paquete: las resuelve npm al instalar, con su comprobación de
  integridad, no con esta.
- Que el código del repo sea bueno.

**Sin con qué comprobar no se instala.** Los motivos, por su `code` (llega como `why` en
`unverified`):

| `code` | Qué pasó |
|---|---|
| `NO_INTEGRITY_FILE` | la release no trae el archivo (publicada antes de esto, o no existe) |
| `INTEGRITY_UNREACHABLE` | GitHub no contestó, contestó un error, o el archivo no se puede leer |
| `WRONG_PACKAGE` | el archivo no nombra ese paquete en esa versión |
| `REGISTRY_UNREACHABLE` | npm no contestó, o señaló un tarball fuera del registro |
| `DOWNLOAD_FAILED` | no se pudo bajar el tarball |
| `INTEGRITY_MISMATCH` | lo que da npm no es lo que midió el release |

Consecuencia: **una versión solo se instala sola si su release adjuntó `npm-integrity.json`**.
Las anteriores a esto no lo traen.

### El lado de CI: la receta del `release.yml`

El archivo es `{ "v": 1, "packages": { "<nombre npm>": { "version": "<x.y.z>", "integrity": "sha512-<base64>" } } }`
(un repo puede publicar varios paquetes), y lo genera este mismo paquete:

```bash
npx --yes @dotrino/update@latest integrity <archivo.tgz>... > npm-integrity.json
```

Lee el `package/package.json` de cada `.tgz` para el nombre y la versión, y calcula su sha512.
En el workflow se empaqueta **una vez**, se mide **ese** archivo y se publica **ese** archivo,
para que lo publicado sea byte a byte lo que se midió. Sin secretos nuevos: basta el
`GITHUB_TOKEN` del propio workflow.

```yaml
permissions:
  contents: write      # crear la release y adjuntarle el archivo
  id-token: write      # la publicación de confianza de npm

    steps:
      # … checkout, setup-node, npm install, npm test, roadmap check …
      - name: Empaquetar
        run: npm pack
      - name: Medir lo que se va a publicar
        run: npx --yes @dotrino/update@latest integrity ./*.tgz > npm-integrity.json
      - name: Publicar en npm ESE archivo
        run: npm publish ./*.tgz --access public
      - name: Adjuntar la medida a la release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          V=$(node -p "require('./package.json').version")
          gh release view "v$V" >/dev/null 2>&1 || gh release create "v$V" --generate-notes
          gh release upload "v$V" npm-integrity.json --clobber
```

- **Varios paquetes en un repo:** un `npm pack` por paquete, todos los `.tgz` en el mismo
  comando `integrity`, y un `npm publish <archivo>` por cada uno.
- **Si el último paso falla** después de publicar, esa versión existe en npm sin su medida y
  ninguna pieza la instalará sola (`NO_INTEGRITY_FILE`): se arregla volviendo a correr ese
  paso, no publicando otra vez.
- El tag es `v<versión>` salvo que el daemon pase otro en `tag`: de ahí sale la URL que consulta
  quien se actualiza, así que los dos lados tienen que decir el mismo.

Las piezas sueltas (`installKind`, `verifyNpmPackage`, `installNpmGlobal`, `supervised`,
`findNpm`, `takeUpdateMarker`) se exportan para quien arme otro flujo; `buildIntegrity`,
`packageOfTarball` e `integrityOf` están en `@dotrino/update/integrity`.

## Instalar un binario

No lo hace este paquete: dónde va un binario es cosa de cada producto (un `.deb` pide root,
un tarball no). `./fetch` deja el archivo verificado y dice dónde.

## Licencia

MIT
