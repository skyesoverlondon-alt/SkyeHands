import { createId } from './ids'

export function createTraceId(): string {
  return createId('trace')
}

export function createJobId(): string {
  return createId('job')
}
