const assert = require('assert').strict
const { parseModule } = require('meriyah')
const { Module, buildGraph } = require('../lib/graph.js')
const { makeModules } = require('./utils')

describe('Module', () => {
  it('stores tree and src', () => {
    const code = parseModule('42')

    const { tree, src } = new Module({ tree: code, src: 'index.js' })

    assert.equal(tree, code)
    assert.equal(src, 'index.js')
  })

  it('finds exports', () => {
    const mod = new Module({
      tree: parseModule(`
        export function a() { }
        export const b = () => null, b2 = 42
        export default c
        export { d, e }
        export class f {}
        export {gee as g, G as G} from 'g.js'
      `),
      src: 'index.js'
    })

    const [
      { declaration: a },
      { declaration: { declarations: [b, b2] } },
      { declaration: c },
      { specifiers: [{ local: d }, { local: e }] },
      { declaration: f }
    ] = mod.tree.body

    const exports = mod.exports()

    assert.deepEqual(exports[0], {
      name: 'a',
      declaration: a,
      exported: a,
      mutable: true
    })

    assert.deepEqual(exports[1], {
      name: 'b',
      declaration: b,
      exported: b.init,
      mutable: false
    })

    assert.deepEqual(exports[2], {
      name: 'b2',
      declaration: b2,
      exported: b2.init,
      mutable: false
    })

    assert.deepEqual(exports[3], {
      name: 'default',
      exported: c,
      mutable: false
    })

    assert.deepEqual(exports[4], {
      name: 'd',
      exported: d,
      mutable: true
    })

    assert.deepEqual(exports[5], {
      name: 'e',
      exported: e,
      mutable: true
    })

    assert.deepEqual(exports[6], {
      name: 'f',
      exported: f,
      declaration: f,
      mutable: false
    })

    assert.deepEqual(exports[7], {
      name: 'g',
      importedName: 'gee',
      module: 'g.js',
      mutable: 'unknown',
      proxyExport: true
    })

    assert.deepEqual(exports[8], {
      name: 'G',
      importedName: 'G',
      module: 'g.js',
      mutable: 'unknown',
      proxyExport: true
    })
  })

  it('finds CJS non-default exports', () => {
    const mod = new Module({
      tree: parseModule(`
        exports.foo = 'bar'
      `),
      src: 'index.js'
    })

    const exported = mod.tree.body[0].expression.right

    assert.deepEqual(mod.exports(), [{
      commonjs: true,
      name: 'foo',
      exported,
      mutable: true
    }])
  })

  it('finds CJS default exports', () => {
    const mod = new Module({
      tree: parseModule(`
        module.exports = 'bar'
      `),
      src: 'index.js'
    })

    const exported = mod.tree.body[0].expression.right

    assert.deepEqual(mod.exports(), [{
      commonjs: true,
      name: 'default',
      exported,
      mutable: true
    }])
  })

  it('splits CJS object exports into multiple names', () => {
    const mod = new Module({
      tree: parseModule(`
        module.exports = { a, b }
      `),
      src: 'index.js'
    })

    const {
      properties: [
        { value: a },
        { value: b }
      ]
    } = mod.tree.body[0].expression.right

    assert.deepEqual(mod.exports(), [
      {
        commonjs: true,
        name: 'a',
        exported: a,
        mutable: true
      },
      {
        commonjs: true,
        name: 'b',
        exported: b,
        mutable: true
      }
    ])
  })

  it('finds proxy exports', () => {
    const mod = new Module({
      tree: parseModule(`
        export { x as y } from "z"
        export * from "w"
      `),
      src: 'index.js'
    })

    const exports = mod.exports()

    assert.deepEqual(exports, [
      {
        name: 'y',
        importedName: 'x',
        module: 'z',
        mutable: 'unknown',
        proxyExport: true
      },
      {
        name: '*',
        module: 'w',
        mutable: 'unknown',
        proxyExport: true
      }
    ])
  })

  it('finds nested named exports', () => {
    const mod = new Module({
      tree: parseModule(`
        export const { x } = 42
        export const { x: [y] } = 42
        export let [[ex]] = 42
      `),
      src: 'index.js'
    })

    assert.deepEqual(mod.exports(), [
      { name: 'x', mutable: false },
      { name: 'y', mutable: false },
      { name: 'ex', mutable: true }
    ])
  })

  it('marks exports as mutable', () => {
    const mod = new Module({
      tree: parseModule(`
        export let x = 6
        let y = 3
        class C {}
        export { y, f, C }
      `),
      src: 'index.js'
    })

    const exports = mod.exports()

    const [xMut, yMut, fMut, cMut] = exports.map(e => e.mutable)

    assert(xMut)
    assert(yMut)
    assert(fMut)
    assert(!cMut)
  })

  it('finds imports', () => {
    const mod = new Module({
      tree: parseModule(`
        import "a.js"
        import b, { c, dee as d } from "b.js"
        export {eee as e, E as E} from "e.js"
        export * from "f.js"
      `),
      src: 'index.js'
    })

    const { specifiers: [{ local: b }, { local: c }, { local: d }] } = mod.tree.body[1]

    const imports = mod.imports()

    assert.deepEqual(imports[0], {
      importedName: null,
      name: null,
      module: 'a.js'
    })

    assert.deepEqual(imports[1], {
      importedName: 'default',
      name: 'b',
      module: 'b.js',
      identifier: b
    })

    assert.deepEqual(imports[2], {
      importedName: 'c',
      name: 'c',
      module: 'b.js',
      identifier: c
    })

    assert.deepEqual(imports[3], {
      importedName: 'dee',
      name: 'd',
      module: 'b.js',
      identifier: d
    })

    assert.deepEqual(imports[4], {
      proxyExport: true,
      importedName: 'eee',
      module: 'e.js'
    })

    assert.deepEqual(imports[5], {
      proxyExport: true,
      importedName: 'E',
      module: 'e.js'
    })

    assert.deepEqual(imports[6], {
      proxyExport: true,
      importedName: '*',
      module: 'f.js'
    })
  })

  it('finds imports in groups', () => {
    const mod = new Module({
      src: '/code/index.js',
      tree: parseModule(`
        import { a as b, c as d } from "./a.js"
      `)
    })

    assert.deepEqual(
      mod.imports(),
      mod.imports({ grouped: true })[0].imports
    )
  })

  it('finds commonjs-style require calls', () => {
    const mod = new Module({
      src: '/code/index.js',
      tree: parseModule(`
        const x = require('./test.js')
      `)
    })

    const {
      id: identifier,
      init: expression
    } = mod.tree.body[0].declarations[0]

    const imports = mod.imports()

    assert.deepEqual(imports, [{
      commonjs: true,
      importedName: 'default',
      name: 'x',
      module: './test.js',
      identifier,
      expression
    }])
  })

  it('finds simple destructured require calls', () => {
    const mod = new Module({
      src: '/code/index.js',
      tree: parseModule(`
        const { x, y: zed } = require('./test.js')
      `)
    })

    const decl = mod.tree.body[0].declarations[0]

    const [x, y] = decl.id.properties

    const expression = decl.init

    const imports = mod.imports()

    assert.deepEqual(imports, [
      {
        commonjs: true,
        importedName: 'x',
        name: 'x',
        module: './test.js',
        identifier: x.value,
        expression
      },
      {
        commonjs: true,
        importedName: 'y',
        name: 'zed',
        module: './test.js',
        identifier: y.value,
        expression
      }
    ])
  })

  it('finds randomly placed require calls', () => {
    const mod = new Module({
      src: '/code/index.js',
      tree: parseModule(`
        if (require('x')) x()
      `)
    })

    const expression = mod.tree.body[0].test

    assert.deepEqual(mod.imports(), [
      {
        commonjs: true,
        importedName: 'default',
        name: null,
        module: 'x',
        identifier: null,
        expression
      }
    ])
  })

  it('finds dynamic imports', () => {
    const mod = new Module({
      src: '/code/index.js',
      tree: parseModule(`
        if (true) {
          import("./test.js")
        }
      `)
    })

    const expression = mod.tree.body[0].consequent.body[0].expression

    assert.deepEqual(mod.imports(), [{
      dynamic: true,
      importedName: '*',
      module: './test.js',
      identifier: null,
      expression
    }])
  })
})

describe('buildGraph', () => {
  it('builds a graph with no dependencies', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        alert('hi')
      `,
      '/code/index2.js': `
        alert('hi')
      `
    })

    const graph = await buildGraph(['/code/index.js', '/code/index2.js'], { resolve })

    assert.deepEqual(graph.nodes(), [':root', '/code/index.js', '/code/index2.js'])

    assert.deepEqual(graph.edges(), [
      { v: ':root', w: '/code/index.js' },
      { v: ':root', w: '/code/index2.js' }
    ])
  })
  it('builds a graph with dependencies', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import a from "./a.js";
      `,
      '/code/a.js': `
        import b from "../b.js"
        export default 1
      `,
      '/b.js': `
        alert('hi')
        export default 42
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(graph.nodes(), [
      ':root',
      '/code/index.js',
      '/code/a.js',
      '/b.js'
    ])

    assert.deepEqual(graph.edges(), [
      { v: ':root', w: '/code/index.js' },
      { v: '/code/index.js', w: '/code/a.js' },
      { v: '/code/a.js', w: '/b.js' }
    ])
  })

  it('handles modules with multiple deps', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import a from "./a.js";
      `,
      '/code/a.js': `
        import b from "./b.js"
        import c from "./c.js"
        export default { b, c }
      `,
      '/code/b.js': `
        import c from "./c.js"
        export default null
      `,
      '/code/c.js': `
        alert('hi')
        export default null
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(graph.nodes(), [
      ':root',
      '/code/index.js',
      '/code/a.js',
      '/code/b.js',
      '/code/c.js'
    ])

    assert.deepEqual(graph.edges(), [
      { v: ':root', w: '/code/index.js' },
      { v: '/code/index.js', w: '/code/a.js' },
      { v: '/code/a.js', w: '/code/b.js' },
      { v: '/code/b.js', w: '/code/c.js' },
      { v: '/code/a.js', w: '/code/c.js' }
    ])
  })

  it('handles direct dependency cycles with root modules', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import a from "./a.js";
        export default null
      `,
      '/code/a.js': `
        import "./index.js"
        export default 42
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(graph.nodes(), [
      ':root',
      '/code/index.js',
      '/code/a.js'
    ])

    assert.deepEqual(graph.edges(), [
      { v: ':root', w: '/code/index.js' },
      { v: '/code/index.js', w: '/code/a.js' },
      { v: '/code/a.js', w: '/code/index.js' }
    ])
  })

  it('handles indirect dependency cycles', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import a from "./a.js";
      `,
      '/code/a.js': `
        import "./b.js"
        export default null
      `,
      '/code/b.js': `
        import "./c.js"
        export default null
      `,
      '/code/c.js': `
        import "./a.js"
        import "./b.js"
        export default null
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(graph.nodes(), [
      ':root',
      '/code/index.js',
      '/code/a.js',
      '/code/b.js',
      '/code/c.js'
    ])

    assert.deepEqual(graph.edges(), [
      { v: ':root', w: '/code/index.js' },
      { v: '/code/index.js', w: '/code/a.js' },
      { v: '/code/a.js', w: '/code/b.js' },
      { v: '/code/b.js', w: '/code/c.js' },
      { v: '/code/c.js', w: '/code/a.js' },
      { v: '/code/c.js', w: '/code/b.js' }
    ])
  })

  it('supports nested named exports', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import { a, b } from './a.js'

        console.log({ a, b })
      `,
      '/code/a.js': `
        export const [[a]] = [[42]]
        export const { x: { y: [ b ] } } = { x: { y: [ 43 ] } }
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    const { imports } = graph.edge('/code/index.js', '/code/a.js')

    assert.deepEqual(
      imports.map(i => i.importedName),
      ['a', 'b']
    )

    const { exportedNames } = graph.node('/code/a.js')

    assert.deepEqual(
      exportedNames,
      new Set(['a', 'b'])
    )
  })

  it('collects imported names', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import { theFunction, anUnusedFunction } from "./a.js";
        import "./b.js";

        console.log(theFunction())
      `,
      '/code/a.js': `
        export const theFunction = () => null

        export const anUnusedFunction = () => alert(1)
      `,
      '/code/b.js': `
        sideEffect()
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    const { imports } = graph.edge('/code/index.js', '/code/a.js')

    assert.deepEqual(
      imports.map(i => i.importedName),
      ['theFunction', 'anUnusedFunction']
    )
  })

  it('collects proxy exports (export ... from)', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import { y } from './a.js'
        alert(y)
      `,
      '/code/a.js': `
        export { x as y } from './b.js'
      `,
      '/code/b.js': `
        export const x = 42
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(
      graph.node('/code/a.js'),
      {
        exportedNames: new Set(['y']),
        proxyExports: new Map([
          ['y', ['/code/b.js', 'x']]
        ])
      }
    )
  })

  it('collects indirect proxy exports (export ... from)', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import { y } from './a.js'
        alert(y)
      `,
      '/code/a.js': `
        export { x as y } from './b.js'
      `,
      '/code/b.js': `
        export { z as x } from './c.js'
      `,
      '/code/c.js': `
        export const z = 'z'
      `
    })

    const graph = await buildGraph('/code/index.js', { resolve })

    assert.deepEqual(
      graph.node('/code/a.js').proxyExports,
      new Map([
        ['y', ['/code/c.js', 'z']]
      ])
    )

    assert.deepEqual(
      graph.node('/code/b.js').proxyExports,
      new Map([
        ['x', ['/code/c.js', 'z']]
      ])
    )
  })

  it('collects export all statements (export * from)')

  it('collects indirect export all statements (export * from)')

  it('borks when importing a non-exported name', async () => {
    const resolve = makeModules({
      '/code/index.js': `
        import { theFunction, aMissingFunction } from "./a.js";

        console.log(theFunction())
      `,
      '/code/a.js': `
        export const theFunction = () => null
      `
    })

    await assert.rejects(async () => {
      await buildGraph('/code/index.js', { resolve })
    }, /aMissingFunction/)
  })

  it.skip('borks when importing a non-existing module')
})
