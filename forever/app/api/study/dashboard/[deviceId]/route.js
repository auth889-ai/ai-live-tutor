import { proxyFocus, focusOptions } from '../../../../../lib/focus/proxy.js';
export async function OPTIONS() { return focusOptions(); }
export async function GET(request, { params }) { const { deviceId } = await params; return proxyFocus(request, 'dashboard/' + deviceId); }
export async function POST(request, { params }) { const { deviceId } = await params; return proxyFocus(request, 'dashboard/' + deviceId); }
