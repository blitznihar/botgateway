import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bot Control Plane',
  description: 'Centrally managed, embeddable AI chatbots',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
