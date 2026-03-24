type KVNamespace = {
  get(key: string, options?: unknown): Promise<any>
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: unknown): Promise<void>
  delete(key: string): Promise<void>
}

type R2ObjectBody = {
  json(): Promise<any>
}

type R2Bucket = {
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream, options?: unknown): Promise<void>
  get(key: string): Promise<R2ObjectBody | null>
}