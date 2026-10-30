// Hand-written types for the plain-JS hooks-spec module (used by the tests).
export interface HookHandler {
  type: string;
  url?: string;
  timeout?: number;
  [k: string]: unknown;
}

export interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [k: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [k: string]: unknown;
}

export function resolvePort(env?: NodeJS.ProcessEnv): number;
export const EVENTS: readonly string[];
export function hookUrl(port: number): string;
export function handler(port: number): HookHandler;
export function isOurs(h: HookHandler | undefined, port: number): boolean;
export function mergeHooks(settings: ClaudeSettings, port: number): { settings: ClaudeSettings; added: string[] };
export function removeHooks(settings: ClaudeSettings, port: number): { settings: ClaudeSettings; removed: string[] };
export function parseCliArgs(argv: string[]): { dryRun: boolean; file: string };
export function loadSettings(file: string, opts?: { missingOk?: boolean }): { raw: string; settings: ClaudeSettings };
export function writeSettingsAtomic(file: string, settings: ClaudeSettings, raw: string): void;
export function renderSettings(settings: ClaudeSettings, raw: string): string;
