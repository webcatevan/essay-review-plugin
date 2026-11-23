/**
 * 极简工具定义助手（从 aiwork 的 bundle 里复制，保持插件零依赖）。
 * 宿主只要求 tools.register 收到 name/description/parameters/output/execute。
 */

/** 把内部参数描述转换成 JSON Schema。 */
export function toJsonSchema(spec) {
  if (spec.type === 'json') return annotations(spec)
  if (spec.oneOf !== undefined) return { ...annotations(spec), oneOf: spec.oneOf.map(toJsonSchema) }
  if (spec.type === 'object') {
    const node = { type: 'object', additionalProperties: spec.additionalProperties ?? false, ...annotations(spec) }
    if (spec.properties !== undefined) {
      const required = Object.entries(spec.properties)
        .filter(([, property]) => property.required === true)
        .map(([name]) => name)
      node.properties = Object.fromEntries(
        Object.entries(spec.properties).map(([name, property]) => [name, toJsonSchema(property)]),
      )
      if (required.length > 0) node.required = required
    }
    return node
  }
  if (spec.type === 'array') {
    return { ...(spec.items === undefined ? {} : { items: toJsonSchema(spec.items) }), type: 'array', ...annotations(spec) }
  }
  return { ...(spec.type === undefined ? {} : { type: spec.type }), ...annotations(spec) }
}

/** 只搬运显式声明的注解字段。 */
function annotations(spec) {
  const carried = {}
  for (const key of ['description', 'title', 'default', 'examples', 'enum', 'const']) {
    if (spec[key] !== undefined) carried[key] = spec[key]
  }
  return carried
}

/** 参数表转换成对象根 schema。 */
export function parameterRoot(parameters) {
  const required = Object.entries(parameters)
    .filter(([, property]) => property.required === true)
    .map(([name]) => name)
  const root = {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(parameters).map(([name, property]) => [name, toJsonSchema(property)]),
    ),
  }
  if (required.length > 0) root.required = required
  return root
}

/** 定义并返回一个 JSON 工具。 */
export function defineJsonTool(spec) {
  return {
    name: spec.name,
    description: spec.description,
    parameters: parameterRoot(spec.parameters),
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value ?? null, null, 2) }] },
    execute: async (args) => spec.execute((args ?? {})),
  }
}
