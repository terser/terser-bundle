'use strict'

const { traverse } = require('estraverse')
const scan = require('scope-analyzer')

const entityDeclarators = new Set([
  'ClassExpression',
  'ClassDeclaration',
  'FunctionExpression',
  'FunctionDeclaration',
  'VariableDeclarator'
])

function _findReassignment (node) {
  while ((node = node.parent)) {
    if (
      node.type === 'Program' ||
      functions.has(node.type)
    ) {
      return false
    }
    if (node.type === 'MemberExpression') continue
    if (node.type === 'AssignmentExpression') return node
  }
}

function _toSequence (expressions, byDefault) {
  if (!expressions.length) {
    if (!byDefault) throw new Error('_toSequence() with zero expressions called without a default value')
    return byDefault
  }
  if (expressions.length === 1) {
    return expressions[0]
  }
  return { type: 'SequenceExpression', expressions }
}

function _insideDestructuringDeclaration (ident) {
  // If we're in an ArrayPattern, we might be in an assignment like `[x,y] = [y,x]`
  // We return true if it's `const [x,y] = ...` or `const {_: [...]} = ...`
  let cursor = ident
  while ((cursor = cursor.parent)) {
    if (!(cursor.type === 'ArrayPattern' || cursor.type === 'Property' || cursor.type === 'ObjectPattern')) {
      return entityDeclarators.has(cursor.type) ? cursor : null
    }
  }
  return null
}

// finds decl in parents
function _findDeclaration (ident) {
  const { parent } = ident
  const parentType = parent.type
  if (
    (entityDeclarators.has(parentType) && parent.id === ident) ||
    parentType === 'LabeledStatement' ||
    (parentType === 'ImportDefaultSpecifier' && parent.local === ident) ||
    (parentType === 'ImportSpecifier' && parent.local === ident)
  ) {
    return parent
  }
  if (
    (parentType === 'Property' && parent.key === ident) ||
    parentType === 'ArrayPattern'
  ) {
    return _insideDestructuringDeclaration(ident)
  }
  return null
}

function _findDefaultExport (node) {
  while ((node = node.parent)) {
    if (node.type === 'ExportDefaultDeclaration') return node
  }
  return null
}

function _declarationValue (decl) {
  if (entityDeclarators.has(decl.type)) return decl.init
  if (decl.type === 'ImportSpecifier' || decl.type === 'ImportDefaultSpecifier') return decl.local
  return null
}

function _isMutable (ident) {
  const decl = _findDeclaration(ident)
  if (!decl) return true
  const { type, parent } = decl
  if (type === 'VariableDeclarator') {
    return parent.kind !== 'const'
  } else if (type === 'ClassDeclaration') {
    return false
  }
  return true
}

function isGlobalRef (ident) {
  const isDefined = scan.getBinding(ident).definition

  return !isDefined
}

function _isRequireCall (node) {
  if (!(node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 && node.arguments[0].type === 'Literal' && typeof node.arguments[0].value === 'string')) return false

  if (!isGlobalRef(node.callee)) return false

  const isTopScope = scan.nearestScope(node, /* blockScope */true).type === 'Program'
  return isTopScope
}

function _isCjsExportsAssignment (node) {
  if (node.type !== 'MemberExpression' || node.computed) return

  let isDefault, isModuleExports

  if (!(
    node.type === 'MemberExpression' &&
    !node.computed &&
    (
      (isDefault = node.object.name === 'module') ||
      (isModuleExports =
        node.object.type === 'MemberExpression' &&
        node.object.object.type === 'Identifier' &&
        node.object.object.name === 'module' &&
        node.object.property.type === 'Identifier' &&
        node.object.property.name === 'exports'
      ) ||
      node.object.name === 'exports'
    ) &&
    node.property.type === 'Identifier' &&
    (isDefault ? node.property.name === 'exports' : true)
  )) {
    return false
  }

  const isTopScope = scan.nearestScope(node, /* blockScope */true).type === 'Program'
  if (!isTopScope) return false

  const rootIdent =
    isModuleExports
      ? node.object.object
      : node.object

  if (!isGlobalRef(rootIdent)) return false

  return isDefault ? 'default' : node.property.name
}

function _isReference (ident) {
  if (ident.type !== 'Identifier') return false
  if (_findDeclaration(ident)) return false
  const { parent } = ident
  if (parent.type === 'MemberExpression' && parent.property === ident) {
    return false
  }
  if (functions.has(parent.type) && parent.body !== ident) return false
  return true
}

function _findReferences (node) {
  if (_isReference(node)) return [node]
  const refNodes = []
  traverse(node, {
    enter (node) {
      if (_isReference(node)) refNodes.push(node)
    }
  })
  return refNodes
}

function _bodyArray (fn) {
  if (fn.body.type !== 'BlockStatement') {
    return [fn.body]
  }
  return fn.body.body
}

const functions = new Set([
  'FunctionExpression',
  'FunctionDeclaration',
  'ArrowFunctionExpression'
])

const classes = new Set([
  'ClassExpression',
  'ClassDeclaration'
])

const functionsAndClasses = new Set([
  ...functions,
  ...classes
])

module.exports = {
  _insideDestructuringDeclaration,
  _findDeclaration,
  _findDefaultExport,
  _declarationValue,
  _isMutable,
  _isRequireCall,
  _isCjsExportsAssignment,
  _isReference,
  _findReassignment,
  _bodyArray,
  _toSequence,
  _findReferences,
  functionsAndClasses,
  functions,
  entityDeclarators
}
