(method_declaration name: (identifier) @local.definition) @local.scope
(constructor_declaration name: (identifier) @local.definition) @local.scope
(local_function_statement name: (identifier) @local.definition) @local.scope
(class_declaration name: (identifier) @local.definition) @local.scope

(parameter name: (identifier) @local.definition)
(variable_declarator name: (identifier) @local.definition)

(identifier) @local.reference
