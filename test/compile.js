'use strict'

const assert = require('assert')
const { makeGraph, jsEqual } = require('./utils')
const { compile } = require('../lib/compile')

const opt = async (entry, resolve, graph) => {
  const out = []
  const push = out.push.bind(out)

  await compile({
    entry,
    graph,
    push,
    resolve,
    sourceMap: false
  })

  return out.join('\n').replace(/\n+/g, '\n')
}

describe('compile', () => {
  it('a single module', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': 'alert(1)'
    })

    jsEqual(await opt('/index.js', resolve, graph), 'alert(1);')
  })

  it('require calls', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        alert(require('./a.js'))
        alert(require('./b.js'))
      `,
      '/a.js': `
        module.exports = 69
      `,
      '/b.js': `
        exports.foo = 'foo'
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_default = 69;
        ;
        var _$_1001_foo = 'foo';
        ;
        alert(_$_1000_default);
        alert({
          get foo() {
            return _$_1001_foo
          },
          set foo(value) {
            _$_1001_foo = value
          },
        });
      `
    )
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

  it('imports all', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import * as a from "./a.js"
        alert(a)
      `,
      '/a.js': `
        export const x = 4
        export let y = 5
        export default 6
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_x = 4
        var _$_1001_y = 5
        var _$_1002_default = 6
        var a = {
          get x() {
            return _$_1000_x
          },
          get y() {
            return _$_1001_y
          },
          set y(value) {
            _$_1001_y = value
          },
          get default() {
            return _$_1002_default
          }
        }
        alert(a)
      `
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

  it('default imports from commonjs default exports', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import foo, { bar } from "./a.js"
        alert(foo, bar)
      `,
      '/a.js': `
        module.exports = { bar: 42 }
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_bar = 42;
        ;
        var foo = {
          get bar() {
            return _$_1000_bar
          },
          set bar(value) {
            _$_1000_bar = value
          }
        }
        alert(foo, _$_1000_bar)
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

  it('require calls with destructuring', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        const { foo } = require('./foo.js')
        alert(foo)
      `,
      '/foo.js': `
        exports.foo = 42
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        var _$_1000_foo = 42;
        ;  // <- TODO what's this?
        const { foo: foo } = { foo: _$_1000_foo };
        alert(foo)
      `
    )
  })

  it('avoids conflicts between globals and top-level variables of modules', async () => {
    const [resolve, graph] = await makeGraph({
      '/index.js': `
        import "./x.js"
        const x = 4
        const globalConflict = ''
      `,
      '/x.js': `
        const x = 6
        function y() {
          globalConflict()
        }
      `
    })

    jsEqual(
      await opt('/index.js', resolve, graph),
      `
        const x = 6
        function y() {
          globalConflict()
        }
        const _$_1000_x = 4
        const _$_1001_globalConflict = ''
      `
    )
  })

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
      `
        var { c: _$_1000_c, d: [_$_1001_e] } = { c: 'c', d: ['e'] };
        alert(_$_1001_e, _$_1000_c);
      `
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

describe('import/export types permutations', () => {
  // TODO Test all permutations of
  //
  // const { foo } = require('./x.js')
  // const foo = require('./x.js')
  // const { foo } = require(...), and in other module const x = require(...)
  // import foo from "./x.js"
  // import { foo }  from "./x.js"
  // import bar, { foo } from "./x.js"
  //
  // and
  //
  // exports.x = 6
  // module.exports = 6
  // module.exports = { a: 6, b: 6 }
  // module.exports = ... ; module.exports.xxx = yyy
  // const x = 6; export { 6 }
  // export const foo = 6
  // export default 6
  // export { foo } from "./proxy.js"
  // export * from "./proxy.js"
  const importModes = [
    {
      modeName: 'cjs pick',
      code: 'const { foo } = require("./a.js")',
      imports: [false, true]
    },
    {
      modeName: 'cjs all',
      code: 'const all = require("./a.js")',
      imports: [true, false]
    },
    {
      modeName: 'cjs two requires',
      code: 'const { foo } = require("./a.js"); const all = require("./a.js")',
      imports: [true, true]
    },
    {
      modeName: 'esm pick',
      code: `
        import { foo as foo_x } from "./a.js"
        var foo = foo_x
      `,
      imports: [false, true]
    },
    {
      modeName: 'esm default',
      code: `
        import all_x from "./a.js"
        var all = all_x
      `,
      imports: [true, false]
    },
    // TODO import *
    {
      modeName: 'esm two imports',
      code: `
        import { foo as x } from "./a.js"
        import all_x from "./a.js"
        var foo = x
        var all = all_x
      `,
      imports: [true, true]
    }
  ]

  const exportModes = [
    {
      modeName: 'export default',
      code: 'export default 42',
      exports: [42, null]
    },
    {
      modeName: 'export const',
      code: 'export const foo = 42',
      exports: [null, 42]
    },
    {
      modeName: 'export const and default',
      code: 'export const foo = 41; export default 42',
      exports: [42, 41]
    },
    {
      modeName: 'export variables',
      code: 'const foo = 41; export { foo }',
      exports: [null, 41]
    },
    {
      modeName: 'cjs pick',
      code: 'exports.foo = 42',
      exports: [null, 42]
    },
    {
      modeName: 'cjs pick (with module.exports)',
      code: 'module.exports.foo = 42',
      exports: [null, 42]
    },
    {
      modeName: 'cjs export all',
      code: 'module.exports = 42',
      exports: [42, null]
    },
    {
      modeName: 'cjs object',
      code: 'module.exports = { foo: 42 }',
      exports: [{ foo: 42 }, 42]
    }
    /*
    {
      modeName: 'cjs all-then-pick',
      code: 'const x = eval("{ bar: 41 }"); module.exports = x; module.exports.foo = 42',
      exports: [{foo: 42, bar: 41}, 42]
    }
    */
  ]

  for (const { modeName, code, imports } of importModes) {
    for (const { modeName: exportModeName, code: exportCode, exports } of exportModes) {
      const exportSideCoversImportSide = ![0, 1].every(i =>
        !!imports[i] === !!exports[i])

      if (exportSideCoversImportSide) {
        continue
      }

      it(`import: ${modeName}, export: ${exportModeName}`, async () => {
        const [resolve, graph] = await makeGraph({
          '/index.js': code,
          '/a.js': exportCode
        })

        const result = await opt('/index.js', resolve, graph)

        const [allExport, fooExport] = exports

        // Need to place results here because
        // const, let, import bindings don't escape eval scope
        const importedStuff = {}

        /* eslint-disable-next-line no-eval */
        eval(`
          ${result};

          if (typeof all !== 'undefined') {
            importedStuff.all = all
          }
          if (typeof foo !== 'undefined') {
            importedStuff.foo = foo
          }
        `)

        try {
          // Need non-strict equal because null == undefined
          /* eslint-disable node/no-deprecated-api */
          if (allExport) {
            assert.deepEqual(importedStuff.all, allExport)
          }

          if (fooExport) {
            assert.deepEqual(importedStuff.foo, fooExport)
          }
          /* eslint-enable node/no-deprecated-api */
        } catch (assertionError) {
          console.log(`\n## result:\n\n${result}\n`)
          console.log({ importedStuff })
          throw assertionError
        }
      })
    }
  }
})
