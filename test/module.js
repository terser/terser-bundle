'use strict'

const assert = require('assert').strict
const { parseModule } = require('meriyah')
const { Module } = require('../lib/module.js')

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
        destructuring: true,
        importedName: 'x',
        name: 'x',
        module: './test.js',
        identifier: x.value,
        expression
      },
      {
        commonjs: true,
        destructuring: true,
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
