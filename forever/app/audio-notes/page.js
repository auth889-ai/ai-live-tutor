// 🎙️ Audio → Notes — the w2 liveLectureNotes feature (audio/transcript → structured study notes).
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { AudioNotes } from '../../components/audio-notes/audio-notes.js';

export default async function AudioNotesPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');
  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start' }}>
      <DashboardSidebar email={session.email} active="audio-notes" />
      <main style={{ flex: 1, minWidth: 0 }}><AudioNotes /></main>
    </div>
  );
}
