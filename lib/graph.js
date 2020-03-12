'use strict'

const { Graph } = require('@dagrejs/graphlib')
const { Module } = require('./module')

async function buildGraph (roots, { resolve }) {
  if (!Array.isArray(roots)) roots = [roots]

  const usedNames = new Map()

  const graph = new Graph()
  graph.setNode(':root', ':root')

  const getNodeInfo = src => {
    let nodeInfo = graph.node(src)
    if (!nodeInfo) {
      nodeInfo = {
        exportedNames: new Set(),
        proxyExports: new Map(),
        globals: new Set(),
        topLevelNames: new Set(),
        depSrc: new Map(),
        exportsAll: false
      }
      graph.setNode(src, nodeInfo)
    }
    return nodeInfo
  }

  const getEdge = (src, dest) => {
    let edge = graph.edge(src, dest)

    if (!edge) {
      edge = {
        importedNames: []
      }
      graph.setEdge(src, dest, edge)
    }

    return edge
  }

  const ensureExportedName = (name, { module, imported }) => {
    if (!name || name === '*') return

    const node = graph.node(imported.src)

    if (
      !node.hasCommonJSExport &&
      !node.exportedNames.has(name)
    ) {
      name = name === 'default' ? name : `"${name}"`
      throw new Error(
        `Module ${imported.src} (imported from ${module.src
        }) is missing ${name} export.`
      )
    }
  }

  const visited = new Set()

  for (const rootFile of roots) {
    const module = await resolve(null, rootFile)

    graph.setEdge(':root', module.src)

    await (async function findDeps (module) {
      if (visited.has(module.src)) return
      visited.add(module.src)

      const nodeInfo = getNodeInfo(module.src)

      for (const { source, imports } of module.imports({ grouped: true })) {
        const imported = await resolve(module, source)
        nodeInfo.depSrc.set(source, imported.src)
        const edge = getEdge(module.src, imported.src)

        await findDeps(imported)

        for (const imp of imports) {
          if (imp.importedName) {
            edge.importedNames.push(imp.importedName)
          }

          ensureExportedName(imp.importedName, { module, imported })
        }
      }

      const modExports = []
      let modHasCommonJSExport = false
      let modHasCommonJSDefaultExport = false

      for (const { statement, exports } of module.exports({ grouped: true })) {
        // Get proxy exports:
        if (statement.source) {
          const otherMod = await resolve(module, statement.source.value)
          nodeInfo.depSrc.set(statement.source.value, otherMod.src)
          const otherModInfo = getNodeInfo(otherMod.src)

          for (const exp of exports) {
            const indirectProxyExport = otherModInfo.proxyExports.get(exp.importedName)
            if (indirectProxyExport) {
              // Indirect proxy export
              nodeInfo.proxyExports.set(exp.name, [...indirectProxyExport])
            } else {
              nodeInfo.proxyExports.set(exp.name, [otherMod.src, exp.importedName])
            }
          }
        }

        // Get other exports
        for (const exp of exports) {
          if (exp.commonjs) {
            modHasCommonJSExport = true
            if (exp.name === 'default') {
              modHasCommonJSDefaultExport = true
            }
          }
          nodeInfo.exportedNames.add(exp.name)
          modExports.push(exp)
        }
      }

      const globalScope = module.globalScope()

      for (const name of globalScope.undeclaredBindings.keys()) {
        usedNames.set(name, true)
      }

      for (const name of globalScope.bindings.keys()) {
        if (usedNames.has(name) || nodeInfo.exportedNames.has(name)) continue
        usedNames.set(name, module.src)
      }

      nodeInfo.exports = modExports
      nodeInfo.src = module.src
      nodeInfo.hasCommonJSExport = modHasCommonJSExport
      nodeInfo.hasCommonJSDefaultExport = modHasCommonJSDefaultExport
    })(module)
  }

  graph.usedNames = usedNames

  // Calculate need for the all-exports object
  await traverse(graph, ':root', (module, parent) => {
    if (!parent) return

    const node = graph.node(module)

    if (node.hasCommonJSDefaultExport) {
      // we don't want to split up the commonjs exports
      return
    }

    const edge = graph.edge(parent, module)

    for (const importedName of edge.importedNames) {
      if (importedName === '*') {
        node.exportsAll = true
      }

      if (node.hasCommonJSExport && importedName === 'default') {
        node.exportsAll = true
      }
    }
  })

  return graph
}

// TODO ensure graph doesn't come with dependency cycles
async function traverse (graph, entry, iterate) {
  if (entry === ':root') {
    for (const { w: entrypoint } of graph.outEdges(entry)) {
      await traverse(graph, entrypoint, iterate)
    }
    return
  }

  const visited = new Set()
  await (async function visit (parent, module) {
    for (const { w: imported } of graph.outEdges(module)) {
      if (visited.has(imported)) {
        continue
      }
      visited.add(imported)
      await visit(module, imported)
    }

    await iterate(module, parent)
  })(null, entry)
}

module.exports = {
  Module,
  buildGraph,
  traverse
}
