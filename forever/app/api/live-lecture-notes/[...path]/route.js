import { proxyRaw, rawOptions } from '../../../../lib/focus/proxy-raw.js';
export async function OPTIONS() { return rawOptions(); }
export async function GET(request, { params }) { const { path } = await params; return proxyRaw(request, 'live-lecture-notes/' + (path || []).join('/')); }
export async function POST(request, { params }) { const { path } = await params; return proxyRaw(request, 'live-lecture-notes/' + (path || []).join('/')); }
