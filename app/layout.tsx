export const metadata = {
  title: "Pinterest Top Images Downloader",
  description: "Find most-liked Pinterest images and download them as a ZIP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui, Arial, sans-serif', background: '#0b1015', color: '#e5e7eb' }}>
        <div style={{ maxWidth: 920, margin: '0 auto', padding: '32px 20px' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
