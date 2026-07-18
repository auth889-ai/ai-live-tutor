// 📓 /notebooks/[id] — the notebook WORKSPACE route: full width, no app sidebar (user order:
// the document must own the screen; ← returns to the library which keeps the shell).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, verifySessionToken } from '../../../lib/auth/session.js';
import { WorkspaceRoute } from '../../../components/notebook/workspace-route.js';

export default async function NotebookWorkspacePage({ params }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');
  const { id } = await params;
  return (
    <div style={{ maxWidth: 1460, margin: '0 auto', padding: 14 }}>
      <WorkspaceRoute id={id} />
    </div>
  );
}
