import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { Nav } from '@/components/nav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Spectra',
  description: 'Content capture dashboard',
}

// Runs before paint so the accent/surface theme never flashes indigo-then-
// swaps. Reads `?theme` straight off `location.search` — no cookie, no
// server round trip. Absent or `theme=indigo` leaves no attribute (indigo
// is the `:root` default in globals.css).
const NO_FLASH_THEME_SCRIPT = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    var theme = params.get('theme');
    if (theme && theme !== 'indigo') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (e) {}
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{ // nosec: NO_FLASH_THEME_SCRIPT is a static compile-time constant (standard no-flash theme init script), not user input
            __html: NO_FLASH_THEME_SCRIPT,
          }}
        />
      </head>
      <body className="min-h-screen bg-zinc-950 font-sans text-zinc-50 antialiased">
        <Nav />
        {children}
      </body>
    </html>
  )
}
