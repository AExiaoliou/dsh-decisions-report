declare module 'node:fs/promises' {
  export function readFile(path: string | URL, options: { encoding: 'utf8'; signal?: AbortSignal }): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  export type Context = any
}

declare module '@deepseek-ai/dsh-skill' {
  export const BUNDLED_SKILL_RANK: number
}
