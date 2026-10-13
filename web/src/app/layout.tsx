import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const body = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'StudyMind — your study buddy for cited answers and curious questions',
  description:
    'Upload lectures, textbooks and slides. Get source-cited answers, adaptive quizzes, and a mastery model that knows what you have actually learned.',
  keywords: ['AI tutor', 'RAG', 'adaptive learning', 'study companion'],
  openGraph: {
    title: 'StudyMind — a study buddy for cited and general answers',
    description:
      'Answers grounded in your material cite the page, slide or timestamp. General-knowledge answers are clearly labelled and kept separate.',
    type: 'website',
    images: [{ url: '/images/og.webp', width: 1200, height: 630, alt: 'StudyMind illustrations for source-based learning' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/images/og.webp'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#059669',
};

/**
 * Applies the persisted theme before paint to avoid a light-mode flash, and
 * exposes a tiny global so the header toggle can flip it without a reload.
 */
const THEME_INIT = `
(function(){try{
  var t = localStorage.getItem('studymind.theme');
  if (t === 'dark') {
    document.documentElement.classList.add('dark');
  }
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}