// 🎯 Focus — the Study Focus extension's results dashboard (survey of on-task vs distracted).
import { FocusDashboard } from '../../components/focus/focus-dashboard.js';

export default function FocusPage() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
      <FocusDashboard deviceId="device" />
    </div>
  );
}
