import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.')
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(b64))
  } catch {
    return { error: 'token inválido' }
  }
}

export function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms))
}
