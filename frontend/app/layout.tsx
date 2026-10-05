import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'API Gateway Management Console',
  description: 'Manage API Routes, API Keys, Rate Limiting, and Traffic Analytics',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
