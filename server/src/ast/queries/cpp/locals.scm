(function_definition) @local.scope
(compound_statement) @local.scope

(function_definition
  declarator: (function_declarator declarator: (identifier) @local.definition))
(function_definition declarator: (identifier) @local.definition)
(parameter_declaration declarator: (identifier) @local.definition)
(init_declarator declarator: (identifier) @local.definition)
(field_declaration declarator: (field_identifier) @local.definition)

(identifier) @local.reference
