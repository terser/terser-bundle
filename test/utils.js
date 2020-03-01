'use strict'

const assert = require('assert').strict
const path = require('path')
const { generate } = require('escodegen')
const { parseModule } = require('meriyah')
const { Module, buildGraph } = require('../lib/graph.js')

const makeModules = sources => {
  const modules = new Map()
  for (const [filename, source] of Object.entries(sources)) {
    const module = new Module({
      src: filename,
      tree: parseModule(source)
    })
    modules.set(filename, module)
  }
  const resolve = (module, filename) => {
    const modFile = module === null ? filename : path.resolve(path.dirname(module.src), filename)

    return modules.get(modFile)
  }
  return resolve
}

const makeGraph = async sources => {
  const rootFile = Object.keys(sources)[0]

  const resolve = await makeModules(sources)

  const graph = await buildGraph(rootFile, { resolve })

  return [resolve, graph]
}

const jsEqual = (value, expected) => {
  value = generate(parseModule(value))
  expected = generate(parseModule(expected))
  assert.equal(value, expected)
}

module.exports = { makeModules, makeGraph, jsEqual }
