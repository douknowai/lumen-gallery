import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * api.mjs 的类型声明，供 vite.config.ts（TypeScript）动态 import 时使用。
 * 实际实现为纯 JS（api.mjs），不受 tsc 类型检查。
 */
export function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;