// 🔖 Bookmarks — dashboard-shell page (sidebar + session), content client-side.
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { BookmarksContent } from '../../components/dashboard/bookmarks-content.js';

export default async function BookmarksPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');
  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start' }}>
      <DashboardSidebar email={session.email} active="bookmarks" />
      <main style={{ flex: 1, minWidth: 0 }}><BookmarksContent /></main>
    </div>
  );
}
