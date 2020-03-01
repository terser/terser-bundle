'use strict'

const assert = require('assert').strict
const { buildGraph } = require('../lib/graph.js')
const { makeModules } = require('./utils')

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
