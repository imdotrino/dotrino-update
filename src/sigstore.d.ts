// `sigstore` es una dependencia OPCIONAL (peerDependency): no está instalada aquí. Esto declara
// solo la parte que usa `fetch.js`, para que el chequeo de tipos no dependa de tenerla.
declare module 'sigstore' {
  export const verify: import('./types.js').SigstoreLib['verify']
}
