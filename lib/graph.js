'use strict'

const assignParent = require('estree-assign-parent')
const { traverse, VisitorOption } = require('estraverse')
const scan = require('scope-analyzer')
const { Graph } = require('@dagrejs/graphlib')
const {
  _isRequireCall,
  _isCjsExportsAssignment,
  _isMutable
} = require('./utils')

// TODO const evalFinder = tree => {}, returns a set of function/Program nodes where eval()-like is used or eval is used within

class Module {
  constructor ({ tree, src }) {
    this.tree = assignParent(tree)
    scan.crawl(this.tree)
    this.src = src
  }

  exports ({ grouped = false } = {}) {
    const exported = []
    const push = (statement, ...exports) => {
      if (grouped) {
        exported.push({ statement, exports })
      } else {
        exported.push(...exports)
      }
    }
    const iterPush = (statement, iterable, cb) => {
      if (grouped) {
        const exports = []
        for (const item of iterable) {
          exports.push(cb(item))
        }
        exported.push({ statement, exports })
      } else {
        for (const item of iterable) {
          exported.push(cb(item))
        }
      }
    }
    traverse(this.tree, {
      enter: node => {
        const { type } = node
        if (node.type === 'ExportAllDeclaration') {
          push(node, {
            proxyExport: true,
            name: '*',
            module: node.source.value,
            mutable: 'unknown'
          })
        } else if (type === 'ExportNamedDeclaration') {
          const { declaration, source } = node
          if (!declaration && source) {
            // export { x } from "foo"
            iterPush(node, node.specifiers, specifier => ({
              proxyExport: true,
              name: specifier.exported.name,
              importedName: specifier.local.name, // <- yes, it's "local"
              module: source.value,
              mutable: 'unknown'
            }))
          } else if (!declaration) {
            // multiple names (export {a,b,c})
            iterPush(node, node.specifiers, specifier => {
              const binding = scan.getBinding(specifier.local)
              const mutable = binding.definition
                ? _isMutable(binding.definition)
                : true
              return {
                name: specifier.exported.name,
                exported: specifier.local,
                mutable
              }
            })
          } else if (
            declaration.type === 'FunctionDeclaration' ||
            declaration.type === 'ClassDeclaration'
          ) {
            // export function x ...
            // export class x ...
            const { id: { name } } = declaration
            const mutable = declaration.type === 'FunctionDeclaration'
            push(node, { name, exported: declaration, declaration, mutable })
          } else if (declaration.type === 'VariableDeclaration') {
            // export const x = ...
            const mutable = declaration.kind !== 'const'
            const exports = []
            for (const decl of declaration.declarations) {
              if (decl.id.type === 'Identifier') {
                exports.push({
                  name: decl.id.name,
                  exported: decl.init,
                  declaration: decl,
                  mutable
                })
                continue
              }

              traverse(decl.id, {
                enter (node) {
                  if (node.type === 'ObjectPattern') {
                    for (const prop of node.properties) {
                      if (prop.value.type === 'Identifier') {
                        exports.push({
                          name: prop.value.name,
                          mutable
                        })
                      }
                    }
                  } else if (node.type === 'ArrayPattern') {
                    for (const elm of node.elements) {
                      if (elm.type === 'Identifier') {
                        exports.push({
                          name: elm.name,
                          mutable
                        })
                      }
                    }
                  }
                }
              })
            }

            push(node, ...exports)
          } else {
            throw new Error('unknown declaration type ' + declaration.type)
          }
        } else if (node.type === 'ExportDefaultDeclaration') {
          push(node, {
            name: 'default',
            exported: node.declaration,
            mutable: false
          })
        } else if (node.type === 'AssignmentExpression') {
          // TODO don't even do this check if we're not in the top scope
          const cjsExportName = _isCjsExportsAssignment(node.left)
          if (cjsExportName) {
            if (
              cjsExportName === 'default' &&
              node.right.type === 'ObjectExpression' &&
              node.right.properties.every(p =>
                p.type === 'Property' &&
                p.kind === 'init' &&
                !p.computed &&
                p.key.type === 'Identifier'
              )
            ) {
              // module.exports = { a, b, c }
              iterPush(node, node.right.properties, prop => ({
                commonjs: true,
                name: prop.key.name,
                exported: prop.value,
                mutable: true
              }))
            } else {
              push(node, {
                commonjs: true,
                name: cjsExportName,
                exported: node.right,
                mutable: true
              })
            }
          }
        }
      }
    })
    return exported
  }

  imports ({ grouped = false } = {}) {
    const imported = []
    const push = (statement, source, ...imports) => {
      if (grouped) {
        imported.push({ statement, source, imports })
      } else {
        imported.push(...imports)
      }
    }
    const iterPush = (statement, source, iterable, cb) => {
      if (grouped) {
        const imports = []
        for (const item of iterable) {
          imports.push(cb(item))
        }
        imported.push({ statement, source, imports })
      } else {
        for (const item of iterable) {
          imported.push(cb(item))
        }
      }
    }
    traverse(this.tree, {
      enter: node => {
        if (node.type === 'ImportDeclaration') {
          const module = node.source.value
          if (!node.specifiers.length) {
            push(node, module, { importedName: null, name: null, module })
          } else {
            iterPush(node, module, node.specifiers, specifier => {
              if (specifier.type === 'ImportDefaultSpecifier') {
                return {
                  importedName: 'default',
                  name: specifier.local.name,
                  module,
                  identifier: specifier.local
                }
              } else if (specifier.type === 'ImportSpecifier') {
                return {
                  importedName: specifier.imported.name,
                  name: specifier.local.name,
                  module,
                  identifier: specifier.local
                }
              } else {
                throw new Error('Unknown import specifier type ' + specifier.type)
              }
            })
          }
          return VisitorOption.Skip
        } else if (node.type === 'ExportNamedDeclaration' && node.source) {
          // export { x } from "y.js"
          iterPush(node, node.source.value, node.specifiers, specifier => ({
            proxyExport: true,
            importedName: specifier.local.name,
            module: node.source.value
          }))
          return VisitorOption.Skip
        } else if (node.type === 'ExportAllDeclaration') {
          // export * from "x.js"
          push(node, node.source.value, {
            proxyExport: true,
            importedName: '*',
            module: node.source.value
          })
        } else if (node.type === 'ImportExpression') {
          const { source } = node
          if (source.type !== 'Literal') {
            throw new Error('Dynamic imports not supported')
          }
          push(node, source.value, {
            dynamic: true,
            importedName: '*',
            module: source.value,
            identifier: null,
            expression: node
          })
          return VisitorOption.Skip
        } else if (_isRequireCall(node)) {
          const declId = node.parent.type === 'VariableDeclarator'
            ? node.parent.id
            : null

          const simpleObjectPattern = declId &&
            declId.type === 'ObjectPattern' &&
            declId.properties.length &&
            declId.properties.every(prop =>
              prop.type === 'Property' &&
              !prop.computed &&
              prop.key.type === 'Identifier' &&
              prop.value.type === 'Identifier'
            )

          const module = node.arguments[0].value

          if (simpleObjectPattern) {
            iterPush(node, module, declId.properties, prop => ({
              commonjs: true,
              importedName: prop.key.name,
              name: prop.value.name,
              module: node.arguments[0].value,
              identifier: prop.value,
              expression: node
            }))
          } else if (!declId || declId.type === 'Identifier') {
            push(node, module, {
              commonjs: true,
              importedName: 'default',
              name: declId ? declId.name : null,
              module: node.arguments[0].value,
              identifier: declId,
              expression: node
            })
          }
        }
      }
    })

    return imported
  }
}

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
