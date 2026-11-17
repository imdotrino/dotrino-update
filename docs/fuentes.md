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
1. El último firmado que se bajó (`$XDG_CONFIG_HOME/dotrino/sources.json`), si su `seq` supera al del código.
2. El del código (`BUILTIN_SOURCES`): npmjs y GitHub.

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

## Lo que falta

2. **Rellenar el espejo en S3** (decisión del dueño). El bucket existe desde el 2026-11-17:
   **`https://dotrino-deps.s3.amazonaws.com/`** (cuenta de Dotrino, us-east-1, versionado, lectura
   y listado públicos; todo lo que contiene es público). Listar es público a propósito: sin ese
   permiso S3 contesta 403 a lo que falta, y la pieza no podría distinguir «no existe» de «no
   pude mirar». Las URLs con `%2f` (paquetes con scope) funcionan: S3 las decodifica.
   Base para el directorio: `https://dotrino-deps.s3.amazonaws.com/npm` y
   `https://dotrino-deps.s3.amazonaws.com/releases/{repo}/{tag}/{file}`.
   Rutas que tiene que servir para `@dotrino/x` 1.2.3:
   - `npm/-/package/@dotrino/x/dist-tags` → `{ "latest": "1.2.3" }`
   - `npm/@dotrino/x` (packument) y `npm/@dotrino/x/1.2.3` (con `dist.tarball` apuntando al bucket)
   - `npm/@dotrino/x/-/x-1.2.3.tgz`
   - `releases/imdotrino/dotrino-x/v1.2.3/npm-integrity.json`
   - las **dependencias de terceros** de cada pieza (su cierre completo), o `npm install --registry`
     no las encuentra.
   Lo rellena un paso del `release.yml` de cada repo.
3. **Una firma del paquete que no dependa del sitio**: el bundle de sigstore del `.tgz`, guardado
   junto a él. Hoy, con npm **y** GitHub caídos a la vez, la medida y el paquete saldrían los dos
   del bucket. Eso es un solo canal, y la pieza no se instala.
3. **Binarios** (la bóveda): `latestVersion({ source: 'github' })` y las atestaciones siguen yendo
   a `api.github.com`.
4. `npm ci` de los servicios desplegados desde git, y las landings que cargan de jsDelivr.
