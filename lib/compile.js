'use strict'

const assert = require('assert')

const scan = require('scope-analyzer')
const { replace, VisitorOption } = require('estraverse')
const { generate } = require('escodegen')

// TODO ensure graph doesn't come with dependency cycles
async function traverse ({ resolve, graph, entry }, iterate) {
  const visited = new Set()
  await (async function visit (parent, path) {
    const module = await resolve(parent, path)
    const dependencies = new Map()

    for (const { w: imported } of graph.outEdges(path)) {
      if (visited.has(imported)) {
        continue
      }
      visited.add(imported)
      await visit(module, imported)
    }

    await iterate({ parent, module, dependencies })
  })(null, entry)
}

const findImportSpecifier = node => {
  let cursor = node
  while ((cursor = cursor.parent)) {
    if (cursor.type === 'ImportSpecifier') return cursor
    if (cursor.type === 'ImportDefaultSpecifier') return cursor
  }
  assert.fail('Could not find import specifier from ' + generate(node))
}

// TODO can we share memory between modules?
const bindingsToVariables = async ({
  module,
  bindingVariables,
  createVariable,
  resolve,
  graph
}) => {
  const toReplace = new Map()

  for (const { statement, source, imports } of module.imports({ grouped: true })) {
    for (const imp of imports) {
      if (imp.proxyExport) continue

      // TODO store resolved filename in graph
      const importFromModule = await resolve(module, source)

      const proxy = graph.node(importFromModule.src).proxyExports.get(imp.importedName)

      const variableName = bindingVariables.get(
        proxy
          ? proxy.join('/:/')
          : `${importFromModule.src}/:/${imp.importedName}`
      )

      if (imp.identifier && !imp.commonjs) {
        for (const ref of scan.getBinding(imp.identifier).references) {
          if (ref === imp.identifier) continue
          ref.name = variableName
        }

        const specifier = findImportSpecifier(imp.identifier)
        const impParent = specifier.parent
        impParent.specifiers.splice(impParent.specifiers.indexOf(specifier), 1)
      } else if (imp.commonjs) {
        toReplace.set(statement, {
          type: 'Identifier',
          name: variableName
        })
      } else if (imp.dynamic) {
        assert.fail('import() expression not supported')
      } else if (!imp.importedName && !imp.name && imp.module) {
        // importing just for the side effects
      } else {
        assert.fail('Unsupported import type')
      }
    }
  }

  const makeDecl = (decls) => ({
    type: 'VariableDeclaration',
    kind: 'var',
    declarations: decls.map(({ id, init }) => ({
      type: 'VariableDeclarator',
      id,
      init
    }))
  })

  for (const { statement, exports } of module.exports({ grouped: true })) {
    let decls = []
    let commonjs = false

    if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.source
    ) {
      decls = [] // this gets dealt with in the imports.
    } else if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.declaration
    ) {
      decls = statement.declaration.declarations

      for (const decl of decls) {
        if (decl.id.type === 'Identifier') {
          decl.id.name = createVariable(module, decl.id.name)
          continue
        }
        replace(decl, {
          enter (node, parent) {
            if (node.type === 'Property' && parent.type === 'ObjectPattern') {
              const { type, name } = node.value
              if (type === 'Identifier') {
                // Key and value is *the same* node. Gotta clone.
                node.value = {
                  ...node.value,
                  name: createVariable(module, name)
                }
                node.shorthand = false
                return VisitorOption.Skip
              }
            } else if (node.type === 'Identifier' && parent.type === 'ArrayPattern') {
              node.name = createVariable(module, node.name)
              return VisitorOption.Skip
            }
          }
        })
      }
    } else {
      commonjs = statement.type === 'AssignmentExpression'

      for (const exp of exports) {
        const { name, exported } = exp

        decls.push({
          id: {
            type: 'Identifier',
            name: createVariable(module, name)
          },
          init: exported
        })
      }
    }

    if (!commonjs) {
      const parentBody = statement.parent.body
      parentBody[parentBody.indexOf(statement)] = makeDecl(decls)
    } else {
      toReplace.set(statement, makeDecl(decls))
    }
  }

  if (toReplace.size) {
    module.tree = replace(module.tree, {
      enter (node) {
        const replacement = toReplace.get(node)
        if (replacement) return replacement
      }
    })
  }

  // Cleanup time!
  module.tree = replace(module.tree, {
    leave (node) {
      if (node.type === 'VariableDeclaration' && !node.declarations.length) {
        return VisitorOption.Remove
      }
      if (node.type === 'ExportNamedDeclaration') {
        if (!node.declaration) return VisitorOption.Remove
        return node.declaration // export const x = 'unused' => const x = 'unused'
      }
      if (node.type === 'ImportDeclaration' && node.specifiers.length === 0) {
        return VisitorOption.Remove
      }
    }
  })
}

exports.compile = async ({
  entry,
  graph,
  push, // TODO pushMap
  minify,
  resolve
}) => {
  const bindingVariables = new Map()
  let i = 1000
  const createVariable = (module, name) => {
    const moduleFile = typeof module === 'string' ? module : module.src
    const variableName = `_$_${i++}_${name}`
    bindingVariables.set(`${moduleFile}/:/${name}`, variableName)
    return variableName
  }
  await traverse({ resolve, graph, entry }, async ({ parent, module }) => {
    await bindingsToVariables({
      bindingVariables,
      module,
      createVariable,
      resolve,
      graph
    })

    push(generate(module.tree))
  })
}
