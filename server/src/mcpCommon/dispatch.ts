import { isObject } from './guards.js';

export type DispatchHandlers<Id = unknown, Response = unknown> = {
  initialize: (id: Id) => Response | Promise<Response>;
  resourcesList: (id: Id) => Response | Promise<Response>;
  resourcesListTemplates: (id: Id) => Response | Promise<Response>;
  toolsList: (id: Id) => Response | Promise<Response>;
  toolsCall: (id: Id, params: unknown) => Response | Promise<Response>;
  methodNotFound: (id: Id) => Response | Promise<Response>;
  invalidRequest: (id: Id) => Response | Promise<Response>;
};

export type DispatchOptions<Id = unknown, Response = unknown> = {
  message: unknown;
  getId: (message: unknown) => Id;
  handlers: DispatchHandlers<Id, Response>;
  validateRequest?: (message: unknown) => message is {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
  };
};

function defaultValidateRequest(
  message: unknown,
): message is { jsonrpc: '2.0'; method: string; params?: unknown } {
  if (!isObject(message)) return false;
  return message.jsonrpc === '2.0' && typeof message.method === 'string';
}

export async function dispatchJsonRpc<Id = unknown, Response = unknown>(
  options: DispatchOptions<Id, Response>,
): Promise<Response> {
  const { message, getId, handlers } = options;
  const id = getId(message);
  const validateRequest = options.validateRequest ?? defaultValidateRequest;

  if (!validateRequest(message)) {
    return handlers.invalidRequest(id);
  }

  const method = message.method;

  if (method === 'initialize') {
    return handlers.initialize(id);
  }

  if (method === 'resources/list') {
    return handlers.resourcesList(id);
  }

  if (method === 'resources/listTemplates') {
    return handlers.resourcesListTemplates(id);
  }

  if (method === 'tools/list') {
    return handlers.toolsList(id);
  }

  if (method === 'tools/call') {
    return handlers.toolsCall(id, message.params);
  }

  return handlers.methodNotFound(id);
}
