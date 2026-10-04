import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TrainMe', template: '%s · TrainMe' },
  description: 'Track training sessions ball by ball, set by set – and see your progress.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#5B5BF7' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
