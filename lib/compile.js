'use strict'

const assert = require('assert')

const scan = require('scope-analyzer')
const { replace, VisitorOption } = require('estraverse')
const { generate } = require('escodegen')
const { traverse } = require('./graph')

const renameVariable = ({ scope, name, newName }) => {
  const binding = scope.bindings.get(name)

  for (const reference of binding.references) {
    reference.name = newName
  }

  scope.bindings.delete(binding.name)
  binding.name = newName
  scope.bindings.set(newName, binding)
}

const findImportSpecifier = node => {
  let cursor = node
  while ((cursor = cursor.parent)) {
    if (cursor.type === 'ImportSpecifier') return cursor
    if (cursor.type === 'ImportDefaultSpecifier') return cursor
    if (cursor.type === 'ImportNamespaceSpecifier') return cursor
  }
  assert.fail('Could not find import specifier from ' + generate(node))
}

// TODO place these all-exporters at the export site, not import site, to avoid duplication
const getAllExportsObject = (importedNode, bindingVariables) => {
  return {
    type: 'ObjectExpression',
    properties: importedNode.exports.flatMap(exp => {
      const variableKey = exp.proxy
        ? exp.proxy.join('/:/')
        : `${importedNode.src}/:/${exp.name}`
      const name = bindingVariables.get(variableKey)

      const getSet = [
        {
          type: 'Property',
          computed: false,
          kind: 'get',
          key: { type: 'Identifier', name: exp.name },
          value: {
            type: 'FunctionExpression',
            id: null,
            params: [],
            body: {
              type: 'BlockStatement',
              body: [
                {
                  type: 'ReturnStatement',
                  argument: { type: 'Identifier', name }
                }
              ]
            }
          }
        }
      ]

      if (exp.mutable) {
        getSet.push({
          type: 'Property',
          computed: false,
          kind: 'set',
          key: { type: 'Identifier', name: exp.name },
          value: {
            type: 'FunctionExpression',
            id: null,
            params: [{ type: 'Identifier', name: 'value' }],
            body: {
              type: 'BlockStatement',
              body: [
                {
                  type: 'ExpressionStatement',
                  expression: {
                    type: 'AssignmentExpression',
                    operator: '=',
                    left: { type: 'Identifier', name },
                    right: { type: 'Identifier', name: 'value'}
                  }
                }
              ]
            }
          }
        })
      }

      return getSet
    })
  }
}

const makeDecl = declarations => {
  const parent = {
    type: 'VariableDeclaration',
    kind: 'var',
    declarations: [],
    parent: null
  }

  parent.declarations = declarations.map(([id, init]) => {
    const declarator = {
      type: 'VariableDeclarator',
      id,
      init,
      parent
    }

    id.parent = init.parent = declarator

    return declarator
  })

  return parent
}

const compileModule = async ({
  module,
  bindingVariables,
  createVariable,
  resolve,
  graph
}) => {
  const toReplace = new Map()

  const moduleNode = graph.node(module.src)

  for (const { statement, source, imports } of module.imports({ grouped: true })) {
    const scope = scan.scope(scan.nearestScope(statement))

    // TODO store resolved filename in graph
    const importedSrc = moduleNode.depSrc.get(source)
    const importedNode = graph.node(importedSrc)

    const getVariableName = imp => {
      const proxy = importedNode.proxyExports.get(imp.importedName)

      return bindingVariables.get(
        proxy
          ? proxy.join('/:/')
          : `${importedNode.src}/:/${imp.importedName}`
      )
    }

    if (imports[0] && imports[0].proxyExport) {
      continue
    }

    if (imports[0] && imports[0].commonjs) {
      let replacement

      if (imports[0].destructuring) {
        replacement = {
          type: 'ObjectExpression',
          properties: imports.map((imp) => ({
            type: 'Property',
            key: { type: 'Identifier', name: imp.name },
            value: { type: 'Identifier', name: getVariableName(imp) }
          }))
        }
      } else {
        replacement = {
          type: 'Identifier',
          name: getVariableName(imports[0])
        }
      }

      toReplace.set(statement, replacement)

      continue
    }

    for (const imp of imports) {
      const variableName = getVariableName(imp)

      if (imp.identifier) {
        const specifier = findImportSpecifier(imp.identifier)
        const impStatement = specifier.parent

        impStatement.specifiers.splice(impStatement.specifiers.indexOf(specifier), 1)
        renameVariable({
          scope,
          name: imp.identifier.name,
          newName: variableName
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

  for (const { statement, exports } of module.exports({ grouped: true })) {
    let decls = []

    if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.source
    ) {
      decls = [] // this gets dealt with in the imports.
    } else if (
      statement.type === 'ExportNamedDeclaration' &&
      statement.declaration
    ) {
      for (const decl of statement.declaration.declarations) {
        const scope = scan.scope(scan.nearestScope(decl, /* blockScope= */decl.parent.kind !== 'var'))
        if (decl.id.type === 'Identifier') {
          renameVariable({
            scope,
            name: decl.id.name,
            newName: createVariable(module, decl.id.name)
          })
          continue
        }
        replace(decl.id, {
          enter (node, parent) {
            if (node.type === 'Property' && parent.type === 'ObjectPattern') {
              const { type, name } = node.value
              if (type === 'Identifier') {
                renameVariable({
                  scope,
                  name,
                  newName: createVariable(module, name)
                })
                return VisitorOption.Skip
              }
            } else if (node.type === 'Identifier' && parent.type === 'ArrayPattern') {
              renameVariable({
                scope,
                name: node.name,
                newName: createVariable(module, node.name)
              })
              return VisitorOption.Skip
            }
          }
        })
      }

      decls = statement.declaration.declarations.map(d => [d.id, d.init])
    } else {
      for (const { name, exported } of exports) {
        decls.push([
          { type: 'Identifier', name: createVariable(module, name) },
          exported
        ])
      }
    }

    toReplace.set(statement, makeDecl(decls))
  }

  if (toReplace.size) {
    module.tree = replace(module.tree, {
      enter (node, parent) {
        const replacement = toReplace.get(node)
        if (replacement) {
          replacement.parent = parent
          return replacement
        }
      }
    })
  }

  if (moduleNode.exportsAll) {
    const name = createVariable(module, '*')
    if (moduleNode.hasCommonJSExport && !moduleNode.hasCommonJSDefaultExport) {
      // When a CJS module only has exports.* assignments, its default export
      // is a sum of the module's exports.
      //
      // If people want to be strict about using `import * as all from "cjs-mod"`
      // we can disable this with an option.
      bindingVariables.set(`${moduleNode.src}/:/default`, name)
    }
    module.tree.body.push(makeDecl([
      [
        { type: 'Identifier', name },
        getAllExportsObject(moduleNode, bindingVariables)
      ]
    ]))
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

function cleanUsedNames ({
  module,
  usedNames,
  createdNames,
  createVariable
}) {
  const globalScope = module.globalScope()

  for (const name of globalScope.bindings.keys()) {
    const nameOrigin = usedNames.get(name)
    if (
      !nameOrigin ||
      nameOrigin === module.src ||
      createdNames.has(name)
    ) {
      continue
    }

    const newName = createVariable(module, name)

    renameVariable({
      scope: globalScope,
      name,
      newName
    })
  }
}

exports.compile = async ({
  entry,
  graph,
  push, // TODO pushMap
  minify = false,
  resolve
}) => {
  const bindingVariables = new Map()

  let createdNames = new Set()
  let variableIndex = 1000
  const createVariable = (module, name) => {
    const moduleFile = typeof module === 'string' ? module : module.src
    const variableName = `_$_${variableIndex++}_${name === '*' ? 'all' : name}`
    bindingVariables.set(`${moduleFile}/:/${name}`, variableName)
    createdNames.add(variableName)
    return variableName
  }

  const usedNames = graph.usedNames

  await traverse({ resolve, graph, entry }, async ({ parent, module }) => {
    await compileModule({
      bindingVariables,
      module,
      createVariable,
      resolve,
      graph
    })

    cleanUsedNames({
      module,
      usedNames,
      createdNames,
      createVariable
    })

    push(generate(module.tree))
    createdNames = new Set()
  })
}
