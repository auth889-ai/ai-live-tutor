import 'katex/dist/katex.min.css';
import { Caveat } from 'next/font/google';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat' });

export const metadata = {
  title: 'Forever — AI Tutor',
  description: 'Source-grounded AI tutor course platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={caveat.variable}>
      <head>
        {/* Crossfade for the single-focus stage (video "cut between shots" feel). */}
        <style>{`
          @keyframes foreverShot { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
          @keyframes foreverGlow {
            0%, 100% { box-shadow: 0 6px 18px rgba(244,115,104,0.30); }
            50%      { box-shadow: 0 6px 30px rgba(244,115,104,0.60), 0 0 0 4px rgba(244,115,104,0.10); }
          }
          .forever-glow { animation: foreverGlow 2.6s ease-in-out infinite; }
          @keyframes foreverPulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
          .forever-pulse { animation: foreverPulse 2.6s ease-in-out infinite; }
          @keyframes foreverRowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
          .forever-row { animation: foreverRowIn 0.45s ease both; transition: background 0.15s; }
          .forever-row:hover { background: #fbf0ec; }
          @keyframes foreverDot { 0%,100% { opacity: 0.35; } 50% { opacity: 1; } }
          .forever-dot { animation: foreverDot 1.4s ease-in-out infinite; }
          .forever-shot { animation: foreverShot 0.45s ease; }
          :root { --caveat: ${caveat.style.fontFamily}; }
        `}</style>
      </head>
      <body style={{ margin: 0, background: '#fdf3f1', fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
