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
          .forever-shot { animation: foreverShot 0.45s ease; }
          :root { --caveat: ${caveat.style.fontFamily}; }
        `}</style>
      </head>
      <body style={{ margin: 0, background: '#faf5ec', fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
