export const metadata = {
  title: 'Forever — AI Tutor',
  description: 'Source-grounded AI tutor course platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#faf5ec', fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
