/** El vigía del checkout: cuatro respuestas, y «no se pudo mirar» nunca es «al día». */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkCheckout, watchCheckout } from '../src/checkout.js'

const A = 'a'.repeat(40); const B = 'b'.repeat(40)
const gh = (sha) => async () => ({ ok: true, json: async () => ({ sha }) })
/** Un git de mentira: HEAD es `head`, y `known` son los commits que el clon contiene. */
const fakeGit = (head, known = [head]) => (cmd, args) => {
  if (args.includes('rev-parse')) { if (!head) throw new Error('not a repo'); return head + '\n' }
  if (args.includes('merge-base')) { if (!known.includes(args[args.indexOf('--is-ancestor') + 1])) throw new Error('no'); return '' }
  throw new Error('unexpected git call')
}
const base = { dir: '/srv/x', repo: 'imdotrino/x' }

test('mismo commit: al día', async () => {
  assert.deepEqual(await checkCheckout({ ...base, run: fakeGit(A), fetchImpl: gh(A) }), { ok: true, behind: false, running: A, latest: A })
})

test('la rama tiene un commit que aquí no está: atrás', async () => {
  const r = await checkCheckout({ ...base, run: fakeGit(A), fetchImpl: gh(B) })
  assert.deepEqual([r.ok, r.behind], [true, true])
})

test('por delante de la rama (máquina de desarrollo): no es atrás', async () => {
  const r = await checkCheckout({ ...base, run: fakeGit(A, [A, B]), fetchImpl: gh(B) })
  assert.deepEqual([r.ok, r.behind], [true, false])
})

test('una carpeta copiada a mano no es un clon, y se dice', async () => {
  const r = await checkCheckout({ ...base, run: fakeGit(null), fetchImpl: gh(B) })
  assert.deepEqual([r.ok, r.code], [false, 'not-a-checkout'])
})

test('no se pudo mirar NO es al día', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 403 }), async () => { throw new Error('down') }, gh('nope')]) {
    const r = await checkCheckout({ ...base, run: fakeGit(A), fetchImpl })
    assert.deepEqual([r.ok, r.code], [false, 'could-not-check'])
  }
  assert.equal((await checkCheckout({})).code, 'could-not-check')
})

test('el vigía: habla si va atrás o no es un clon; calla al día y si no pudo mirar', async () => {
  const say = async (run, fetchImpl) => {
    const lines = []
    const stop = watchCheckout({ ...base, name: 'signer', run, fetchImpl, log: (l) => lines.push(l) })
    await new Promise((r) => setTimeout(r, 30)); stop()
    return lines
  }
  assert.match((await say(fakeGit(A), gh(B)))[0], /signer: imdotrino\/x@main is at bbbbbbb and this is running aaaaaaa/)
  assert.match((await say(fakeGit(null), gh(B)))[0], /is not a git checkout: cannot tell which commit is running/)
  assert.deepEqual(await say(fakeGit(A), gh(A)), [])
  assert.deepEqual(await say(fakeGit(A), async () => ({ ok: false, status: 500 })), [])
})
