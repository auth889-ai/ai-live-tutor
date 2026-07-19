// 🎯 Focus Guard — the Study Focus extension's results dashboard (survey of on-task vs distracted).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { FocusDashboard } from '../../components/focus/focus-dashboard.js';

export default async function FocusPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');
  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start' }}>
      <DashboardSidebar email={session.email} active="focus" />
      <main style={{ flex: 1, minWidth: 0 }}><FocusDashboard deviceId="device" /></main>
    </div>
  );
}
