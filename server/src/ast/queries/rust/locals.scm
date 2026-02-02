(function_item) @local.scope
(impl_item) @local.scope
(block) @local.scope

(function_item name: (identifier) @local.definition)
(let_declaration pattern: (identifier) @local.definition)
(let_declaration pattern: (mut_pattern (identifier) @local.definition))
(parameter pattern: (identifier) @local.definition)
(parameter pattern: (mut_pattern (identifier) @local.definition))

(identifier) @local.reference
