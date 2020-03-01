'use strict'

const { Graph } = require('@dagrejs/graphlib')
const { Module } = require('./module')

async function buildGraph (roots, { resolve }) {
  if (!Array.isArray(roots)) roots = [roots]

  const graph = new Graph()
  graph.setNode(':root', ':root')

  const getNodeInfo = src => {
    let nodeInfo = graph.node(src)
    if (!nodeInfo) {
      nodeInfo = {
        exportedNames: new Set(),
        proxyExports: new Map()
      }
      graph.setNode(src, nodeInfo)
    }
    return nodeInfo
  }

  const getEdge = (src, dest) => {
    let edge = graph.edge(src, dest)

    if (!edge) {
      edge = {
        imports: []
      }
      graph.setEdge(src, dest, edge)
    }

    return edge
  }

  const ensureExportedName = (name, { module, imported }) => {
    if (!name) return

    if (!graph.node(imported.src).exportedNames.has(name)) {
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

      for (const { source, imports } of module.imports({ grouped: true })) {
        const imported = await resolve(module, source)
        const edge = getEdge(module.src, imported.src)

        for (const imp of imports) {
          if (imp.importedName) {
            edge.imports.push(imp)
          }
        }

        await findDeps(imported)

        for (const imp of imports) {
          ensureExportedName(imp.importedName, { module, imported })
        }
      }

      // Get proxy exports only:
      const nodeInfo = getNodeInfo(module.src)
      for (const { statement, exports } of module.exports({ grouped: true })) {
        if (statement.source) {
          const otherMod = await resolve(module, statement.source.value)
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

        for (const exp of exports) {
          nodeInfo.exportedNames.add(exp.name)
        }
      }
    })(module)
  }

  return graph
}

module.exports = {
  Module,
  buildGraph
}
