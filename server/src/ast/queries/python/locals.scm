(function_definition) @local.scope
(class_definition) @local.scope
(block) @local.scope

(function_definition name: (identifier) @local.definition)
(class_definition name: (identifier) @local.definition)
(parameters (identifier) @local.definition)
(assignment left: (pattern (identifier) @local.definition))
(assignment left: (pattern_list (pattern (identifier) @local.definition)))

(identifier) @local.reference
