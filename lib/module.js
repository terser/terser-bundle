'use strict'

const { traverse, VisitorOption } = require('estraverse')
const scan = require('scope-analyzer')
const {
  _isRequireCall,
  _isCjsExportsAssignment,
  _isMutable
} = require('./utils')

// TODO
const initialCrawl = tree => {
  traverse(tree, {
    enter (node, parent) {
      node.parent = parent

      if (node.type === 'Property' && node.shorthand && node.key === node.value) {
        // Need to duplicate key and value
        // so we can rename key and value independently
        node.value = { ...node.value }

        // TODO remove following line when
        // https://github.com/goto-bus-stop/scope-analyzer/pull/5
        // is merged.
        node.shorthand = false
      }
    }
  })
}

class Module {
  constructor ({ tree, src }) {
    initialCrawl(tree)
    scan.crawl(tree)
    this.tree = tree
    this.src = src
  }

  globalScope () {
    return scan.scope(this.tree)
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
              } else if (specifier.type === 'ImportNamespaceSpecifier') {
                return {
                  importedName: '*',
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
              destructuring: true,
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

module.exports = { Module }
