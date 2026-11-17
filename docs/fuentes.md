# El directorio de fuentes

> Regla del dueño, 2026-11-17: ninguna pieza queda atada para siempre a npm ni a otro tercero.
> npmjs se sigue usando. Lo que se exige es poder irse —por decisión o por fuerza mayor— sin que
> sea un candado. Norma: `CONVENCIONES-APPS.md` §15.2.

## El problema

Las ubicaciones estaban escritas en el código: `registry.npmjs.org` (última versión, tarball),
`github.com` (la medida `npm-integrity.json`) y `api.github.com` (releases, atestaciones). Si
npm fallaba, ninguna pieza se podía actualizar. Moverlas a otro sitio exigía publicar una versión
nueva, y esa versión había que bajarla del sitio que había fallado.

## La idea

**La confianza va en la verificación, no en la ubicación.** Si lo que se baja se comprueba igual
venga de donde venga, el sitio se puede cambiar sin tocar la seguridad. El directorio dice dónde
buscar, y nada más.

## Formato

```json
{
  "v": 1,
  "seq": 7,
  "issued": "2026-11-17T00:00:00Z",
  "default": {
    "npm": ["https://registry.npmjs.org"],
    "releases": ["https://github.com/{repo}/releases/download/{tag}/{file}"]
  },
  "packages": {
    "@dotrino/proxy": { "npm": ["https://deps.dotrino.com/npm"] }
  },
  "directory": ["https://deps.dotrino.com/sources.json"]
}
```

| Campo | Qué es |
|---|---|
| `npm` | registros con el protocolo de npm, en orden. Uno estático vale (solo GET) |
| `releases` | plantillas de un archivo de release. `{file}` es obligatorio |
| `packages` | lo que cambia para una pieza, por paquete o `owner/repo`. Lo que no dice, lo pone `default` |
| `directory` | dónde leer la versión siguiente de este directorio |
| `seq` | sube en cada versión; uno menor o igual no se acepta |

Publicado va firmado: `{ "kid": "k-…", "payload": "<el JSON en texto>", "sig": "<Ed25519, base64>" }`.
Se firma el texto exacto, así no hace falta canonicalizar el JSON.

## De dónde sale, en orden

1. `DOTRINO_SOURCES`: ruta a un JSON **sin firmar**. Lo pone el dueño de esa máquina.
2. El último firmado que se bajó (`$XDG_CONFIG_HOME/dotrino/sources.json`), si su `seq` supera al del código.
3. El del código (`BUILTIN_SOURCES`): npmjs y GitHub.

Si el guardado no pasa la firma, **se para y se dice**: es un fallo o una manipulación, y volver
en silencio al del código lo taparía.

## Mover una pieza

```bash
# 1. editar dir.json: subir seq, cambiar packages["@dotrino/<pieza>"]
# 2. firmar con la llave del cajón `sources`
dotrino-env run --ns sources -- dotrino-update sources sign dir.json > sources.json
# 3. publicarlo en TODAS las direcciones de `directory`
```

Cada pieza lo recoge en su siguiente vuelta diaria (`selfUpdateNpm` llama a `refreshSources` antes
de mirar).

## La llave

- Ed25519, **propia de esto**. No es la maestra (que solo firma el acta y regenera sobres).
- `dotrino-update sources keygen` da `{ kid, publicKey, privateKey }`. La privada va al cajón
  `sources` de la bóveda de Dotrino; la pública, a `TRUSTED_KEYS` en `src/sources.js`, con una
  versión nueva del paquete.
- **La llave vigente es `k-ed30003dbd2c`** (2026-11-17). Cajón `dotrino/sources` de la bóveda de
  Dotrino: `DOTRINO_SOURCES_KEY` (privada, PKCS#8 DER base64, pide aprobación), y públicas
  `DOTRINO_SOURCES_KID` y `DOTRINO_SOURCES_PUB`. Aparato del cajón en la PC del dueño: `124B-DA78`.
- El directorio publicado vive en `https://dotrino-deps.s3.amazonaws.com/sources.json` (≥ 0.11.0
  lo trae como dirección por defecto).

## Por qué no es un interruptor remoto (§14)

El directorio decide **dónde**, no **qué**. El paquete se compara con la medida del release de su
repo, y la medida y el paquete no pueden venir del mismo sitio (dos canales). Un directorio malo
puede mandar a un sitio vacío: la pieza deja de actualizarse y sigue corriendo. No puede colar
código.

## El espejo: `dotrino-update mirror` (≥ 0.12.0)

El bucket: **`https://dotrino-deps.s3.amazonaws.com/`** (cuenta de Dotrino, us-east-1, versionado,
lectura y listado públicos; todo lo que contiene es público). Listar es público a propósito: sin
ese permiso S3 contesta 403 a lo que falta, y la pieza no distinguiría «no existe» de «no pude
mirar». Las URLs con `%2f` (paquetes con scope) funcionan: S3 las decodifica.

Lo rellena el `release.yml` de cada repo, después de publicar en npm:

```yaml
- name: Instalar el paquete para saber sus dependencias
  run: mkdir mirror-deps && cd mirror-deps && npm init -y >/dev/null && npm install ../*.tgz --ignore-scripts --no-audit --no-fund
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::147464502454:role/dotrino-deps-publisher
    aws-region: us-east-1
- run: |
    npx --yes @dotrino/update@latest mirror --repo "${{ github.repository }}" --tag "${{ github.ref_name }}" \
      --lock mirror-deps/package-lock.json --release npm-integrity.json \
      $(for f in *.tgz.sigstore.json; do echo --release "$f"; done) --upload s3://dotrino-deps ./*.tgz
```

- **Sin token guardado**: el workflow cambia su identidad OIDC por credenciales de un solo uso del
  rol `dotrino-deps-publisher`, que solo puede escribir en `npm/*` y `releases/*`, y solo desde un
  **tag** de un repo de `imdotrino`. La cuenta usa sujetos OIDC **inmutables** (llevan los IDs:
  `repo:imdotrino@294847950/<repo>@<id>:ref:…`), y la confianza del rol se escribe así
  (`repo:imdotrino@294847950/*:ref:refs/tags/*`): con el nombre solo, AWS lo rechaza. Un colaborador con escritura puede empujar un tag: es el mismo
  riesgo que ya tiene la publicación en npm, y el bucket versionado deja deshacerlo.
- **Las dependencias también**, sacadas del `package-lock.json` de una instalación del paquete, y
  comparadas con su `integrity` antes de subirse. Lo que ya está no se vuelve a subir.
- **El packument se suma, nunca se pisa a ciegas**; los packuments se suben al final.

Rutas para `@dotrino/x` 1.2.3: `npm/-/package/@dotrino/x/dist-tags`, `npm/@dotrino/x`,
`npm/@dotrino/x/1.2.3`, `npm/@dotrino/x/-/x-1.2.3.tgz`, y
`releases/imdotrino/dotrino-x/v1.2.3/{npm-integrity.json, x-1.2.3.tgz.sigstore.json}`.

## La firma que no depende del sitio (≥ 0.12.0)

El `release.yml` atestigua cada `.tgz` (`actions/attest-build-provenance`) y deja el bundle al
lado: `<x.tgz>.sigstore.json`, en la release de GitHub y en el espejo. Cuando el paquete y su medida
salen **del mismo sitio** (npm y GitHub caídos a la vez, todo desde el bucket), `verifyNpmPackage`
exige esa firma: un workflow de ese repo construyó ese sha256. Sin el paquete `sigstore` instalado
o sin el bundle, no se instala (`SINGLE_CHANNEL`).

La firma se busca con el nombre que le da `npm pack` (`dotrino-x-1.2.3.tgz.sigstore.json`), no con el
del registro (`x-1.2.3.tgz`); la 0.12.0 buscaba el segundo y no la encontraba (arreglado en 0.12.1).

Comprobado el 2026-11-17 con `@dotrino/update` 0.12.0: `npm install --registry` contra el espejo y
`verifyNpmPackage` con un directorio que solo apunta al bucket aceptan con la firma y niegan sin
`sigstore`, sin consultar npmjs ni GitHub. **Dependencia que queda:** la librería `sigstore` baja su
raíz de confianza (TUF) de `tuf-repo-cdn.sigstore.dev` y la guarda en caché; sin caché y sin ese
sitio, la firma no se puede comprobar.

## Estado (2026-11-17)

- **Directorio publicado: `seq` 2.** `default` = npmjs y GitHub primero, el espejo detrás. Una pieza
  con `@dotrino/update` ≥ 0.11.0 lo recoge sola en su vuelta diaria.
- **Rellenan el espejo en cada release:** `dotrino-update` (comprobado: la 0.12.1 se subió sola) y,
  desde su próximo tag, content, expenses-agent, ia, models, remote-desktop, sealers, terminal y
  tunnel. Las librerías `@dotrino/*` no llevan el paso: entran como dependencias de esos servicios,
  verificadas por la `integrity` del lockfile.

## Lo que falta

1. **Que los servicios suban a `@dotrino/update` ≥ 0.12.1.** Hasta entonces no leen el directorio.
2. **Binarios** (la bóveda): `latestVersion({ source: 'github' })` y las atestaciones siguen yendo
   a `api.github.com`.
3. `npm ci` de los servicios desplegados desde git, y las landings que cargan de jsDelivr.
4. La raíz de confianza de `sigstore` (TUF) se baja de `tuf-repo-cdn.sigstore.dev`.
