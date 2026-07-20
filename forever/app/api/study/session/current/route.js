import { proxyFocus, focusOptions } from '../../../../../lib/focus/proxy.js';
export async function OPTIONS() { return focusOptions(); }
export async function GET(request) { return proxyFocus(request, 'session/current'); }
