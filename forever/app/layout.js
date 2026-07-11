import 'katex/dist/katex.min.css';
import { Caveat, Fraunces, Inter, Newsreader } from 'next/font/google';

const caveat = Caveat({ subsets: ['latin'], variable: '--font-caveat' });
// PREMIUM_UI_SPEC §B: serif/sans tension reads expensive — Fraunces for display,
// Inter for everything interactive, Newsreader italic for editorial accents.
const fraunces = Fraunces({ subsets: ['latin'], variable: '--font-fraunces' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const newsreader = Newsreader({ subsets: ['latin'], style: ['italic'], variable: '--font-newsreader' });

export const metadata = {
  title: 'Forever — AI Tutor',
  description: 'Source-grounded AI tutor course platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${caveat.variable} ${fraunces.variable} ${inter.variable} ${newsreader.variable}`}>
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
          :root {
            --caveat: ${caveat.style.fontFamily};
            /* PREMIUM_UI_SPEC §A — every neutral warm-tinted, coral as highlight never canvas */
            --bg: #F7EBE5; --surface: #FFFDFB; --surface-sunken: #F1E2DA;
            --border: #EBD6CB; --border-strong: #DDBCAE;
            --ink: #2A1713; --ink-body: #45302A; --ink-muted: #84685E;
            --coral: #F47368; --coral-deep: #BC3F34; --amber: #B87F24;
            --theater-bg: #1B100D; --theater-surface: #291815; --theater-ink: #F7E9E3;
            /* §C depth recipe — blush-hue-matched layered shadows, top light inset */
            --shadow-hue: 14deg 45% 42%;
            --card-shadow:
              0 1px 2px hsl(var(--shadow-hue) / .06), 0 2px 4px hsl(var(--shadow-hue) / .06),
              0 4px 8px hsl(var(--shadow-hue) / .05), inset 0 1px 0 rgba(255,255,255,.65);
            --card-shadow-lift:
              0 2px 3px hsl(var(--shadow-hue) / .07), 0 6px 12px hsl(var(--shadow-hue) / .07),
              0 16px 32px hsl(var(--shadow-hue) / .06), inset 0 1px 0 rgba(255,255,255,.65);
            --ease-out-soft: cubic-bezier(.22, 1, .36, 1);
          }
          /* PREMIUM SURFACE (beyond flat): a whisper of radial warmth at the top of the page —
             depth without a background image, so dense lesson content stays readable. */
          body {
            background:
              radial-gradient(1200px 500px at 50% -10%, #fff7f4 0%, rgba(255,247,244,0) 70%),
              linear-gradient(180deg, #fdf3f1 0%, #fbece7 100%);
            background-attachment: fixed;
          }
          /* Every slider in the app rides the coral brand, never the browser default blue. */
          input[type="range"] { accent-color: #e8604c; }
          /* Premium buttons: coral gradient + soft lift on hover (used via className). */
          .forever-btn {
            background: linear-gradient(180deg, #f4776a 0%, #e8604c 100%);
            color: #fff; border: none; border-radius: 10px;
            box-shadow: 0 2px 8px rgba(232,96,76,0.35), inset 0 1px 0 rgba(255,255,255,0.25);
            transition: transform 0.15s ease, box-shadow 0.15s ease;
          }
          .forever-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(232,96,76,0.45), inset 0 1px 0 rgba(255,255,255,0.25); }
          .forever-chip {
            background: #fffcfa; border: 1px solid #f0dcd5; border-radius: 10px;
            box-shadow: 0 1px 3px rgba(190,120,100,0.10);
            transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
          }
          .forever-chip:hover { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(190,120,100,0.18); background: #fff; }
        `}</style>
      </head>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
