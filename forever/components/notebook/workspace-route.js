'use client';

// Client wrapper for the full-width workspace route: back → the library page;
// [[wiki]] navigation resolves titles → ids via the API, then routes.

import { useRouter } from 'next/navigation';

import { NotebookWorkspace } from './workspace.js';

export function WorkspaceRoute({ id }) {
  const router = useRouter();
  const navigate = async (idOrTitle) => {
    if (String(idOrTitle).startsWith('nbk_')) { router.push(`/notebooks/${idOrTitle}`); return; }
    const d = await fetch('/api/notebooks').then((r) => r.json()).catch(() => null);
    const hit = (d?.notebooks ?? []).find((n) => String(n.title).trim().toLowerCase() === String(idOrTitle).trim().toLowerCase());
    if (hit) router.push(`/notebooks/${hit.id}`);
  };
  return <NotebookWorkspace id={id} onBack={() => router.push('/notebooks')} onNavigate={navigate} />;
}
