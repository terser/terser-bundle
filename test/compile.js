'use strict'

const { makeGraph, jsEqual } = require('./utils')
const { compile } = require('../lib/compile')

describe('compile', () => {
  const opt = async (entry, resolve, graph) => {
    const out = []
    const push = out.push.bind(out)

    await compile({
      entry,
      graph,
      push,
      resolve,
      minify: x => ({ code: x }),
      sourceMap: false
    })

    return out.join('\n').replace(/\n+/g, '\n')
  }

  it('a single module', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': 'alert(1)'
    })

    jsEqual(await opt('/index.js', resolve, graph), 'alert(1);')
  })

  it('imports', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import a from "./a.js"
        alert(a)
      `,
      '/a.js': `
        export default 'a'
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      "var _$_1000_default = 'a';\nalert(_$_1000_default);"
    )
  })

  it('imports of multiple names', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import { a as b, c as d } from "./a.js"
        import "./nothing.js"
        alert(b, d)
      `,
      '/a.js': `
        export const a = 'a'
        export const c = 'c'
      `,
      '/nothing.js': 'nothing()'
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_a = 'a';
        var _$_1001_c = 'c';
        nothing();
        alert(_$_1000_a, _$_1001_c);
      `
    )
  })

  it('Multiple imports of the same module', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import x from "./a.js"
        import y from "./b.js"
        alert(x, y)
      `,
      '/a.js': `
        import b from "./b.js"
        export default b
      `,
      '/b.js': `
        export default 42
      `
    })

    jsEqual(await opt('/index.js', resolve, graph), `
      var _$_1000_default = 42;
      var _$_1001_default = _$_1000_default;
      alert(_$_1001_default, _$_1000_default);
    `)
  })

  it('require calls', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        foo(require('./x.js'))
      `,
      '/x.js': `
        module.exports = 42
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_default = 42;
        ;  // <- TODO what's this?
        foo(_$_1000_default);
      `
    )
  })

  it('require calls with variable assignment', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        const foo = require('./x.js')
        alert(foo)
      `,
      '/x.js': `
        module.exports = 42
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_default = 42;
        ;  // <- TODO what's this?
        const foo = _$_1000_default;
        alert(foo)
      `
    )
  })

  // TODO Test all permutations of
  //
  // const { foo } = require('./x.js')
  // const foo = require('./x.js')
  // const { foo } = require(...), and in other module const x = require(...)
  //
  // and
  //
  // exports.x = 6
  // module.exports = 6
  // module.exports = { a: 6, b: 6 }
  // module.exports = ... ; module.exports.xxx = yyy
  //
  it('require calls with destructuring assignment')

  it('require calls with the same module required as default and as a chunk')

  it('nested named exports (export const [[{x}]] = ...)', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import { e as c, c as e } from './a.js'
        alert(c, e)
      `,
      '/a.js': `
        export const { c, d: [e] } = { c: 'c', d: ['e'] }
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      "var { c: _$_1000_c, d: [_$_1001_e] } = { c: 'c', d: ['e'] };\nalert(_$_1001_e, _$_1000_c);"
    )
  })

  it('proxy exports (export from)', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import { d } from './a.js'
        import { d as c } from './b.js'
        alert(d, c)
      `,
      '/a.js': `
        export { c as d } from "./b.js"
      `,
      '/b.js': `
        export const { c, d } = { c: 'c', d: 'd' }
      `
    })

    jsEqual(await opt('/index.js', resolve, graph), `
      var {
        c: _$_1000_c,
        d: _$_1001_d
      } = {
        c: 'c',
        d: 'd'
      }
      alert(_$_1000_c, _$_1001_d);
    `)
  })

  it('proxy exports with nested names', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import { d } from './a.js'
        import { d as c } from './b.js'
        alert(d, c)
      `,
      '/a.js': `
        export { c as d } from "./b.js"
      `,
      '/b.js': `
        export const { x: [c], d } = { x: ['c'], d: 'd' }
      `
    })

    jsEqual(await opt('/index.js', resolve, graph), `
      var {
        x: [_$_1000_c],
        d: _$_1001_d
      } = {
        x: ['c'],
        d: 'd'
      }
      alert(_$_1000_c, _$_1001_d);
    `)
  })
})
