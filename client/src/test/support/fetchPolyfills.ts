const normalizeHeaderName = (key: string) => key.toLowerCase();

const appendHeaderValue = (current: string | undefined, next: string) =>
  current ? `${current}, ${next}` : next;

const consumeHeaderInit = (
  store: Map<string, string>,
  init?: HeadersInit,
): void => {
  if (!init) return;

  if (Array.isArray(init)) {
    for (const [key, value] of init) {
      store.set(
        normalizeHeaderName(key),
        appendHeaderValue(store.get(normalizeHeaderName(key)), String(value)),
      );
    }
    return;
  }

  if (typeof init === 'object' && 'forEach' in init) {
    const headers = init as Headers;
    headers.forEach((value: string, key: string) => {
      store.set(
        normalizeHeaderName(key),
        appendHeaderValue(store.get(normalizeHeaderName(key)), String(value)),
      );
    });
    return;
  }

  for (const [key, value] of Object.entries(init)) {
    store.set(
      normalizeHeaderName(key),
      appendHeaderValue(store.get(normalizeHeaderName(key)), String(value)),
    );
  }
};

export class SimpleHeaders {
  private store = new Map<string, string>();

  constructor(init?: HeadersInit) {
    consumeHeaderInit(this.store, init);
  }

  append(key: string, value: string) {
    const normalized = normalizeHeaderName(key);
    this.store.set(
      normalized,
      appendHeaderValue(this.store.get(normalized), String(value)),
    );
  }

  delete(key: string) {
    this.store.delete(normalizeHeaderName(key));
  }

  forEach(
    callback: (value: string, key: string, parent: SimpleHeaders) => void,
  ) {
    for (const [key, value] of this.store.entries()) {
      callback(value, key, this);
    }
  }

  get(key: string) {
    return this.store.get(normalizeHeaderName(key)) ?? null;
  }

  has(key: string) {
    return this.store.has(normalizeHeaderName(key));
  }

  set(key: string, value: string) {
    this.store.set(normalizeHeaderName(key), String(value));
  }

  entries() {
    return this.store.entries();
  }

  keys() {
    return this.store.keys();
  }

  values() {
    return this.store.values();
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

export class SimpleResponse {
  status: number;
  statusText: string;
  headers: Headers;
  private bodyValue: unknown;

  constructor(body?: BodyInit | null, init: ResponseInit = {}) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? '';
    this.headers = new SimpleHeaders(init.headers) as unknown as Headers;
    this.bodyValue = body ?? null;
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  async json() {
    if (typeof this.bodyValue === 'string') return JSON.parse(this.bodyValue);
    return this.bodyValue;
  }

  async text() {
    if (typeof this.bodyValue === 'string') return this.bodyValue;
    return JSON.stringify(this.bodyValue ?? '');
  }

  clone() {
    return new SimpleResponse(this.bodyValue as BodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
    });
  }
}

export class SimpleRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;

  constructor(input: RequestInfo | URL, init: RequestInit = {}) {
    this.url = typeof input === 'string' ? input : input.toString();
    this.method = init.method ?? 'GET';
    this.headers = new SimpleHeaders(init.headers) as unknown as Headers;
    this.body = init.body;
  }

  clone() {
    return this;
  }
}
