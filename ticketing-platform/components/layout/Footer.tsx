import Link from 'next/link';

export function Footer() {
  return (
    <footer className="bg-stone-900 text-white">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center">
                <span className="text-white text-lg font-bold">S</span>
              </div>
              <div>
                <h3 className="text-xl font-bold">Showfront</h3>
                <p className="text-xs text-stone-400">Events & Experiences</p>
              </div>
            </div>
            <p className="text-stone-400 max-w-md">
              Your premier destination for booking tickets to the most
              exclusive events in Tunisia. Creating unforgettable moments, one
              ticket at a time.
            </p>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4">Quick Links</h4>
            <ul className="space-y-3 text-stone-400">
              <li>
                <Link href="/" className="hover:text-amber-400 transition">
                  Events
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="hover:text-amber-400 transition"
                >
                  About Us
                </Link>
              </li>
              <li>
                <Link
                  href="/contact"
                  className="hover:text-amber-400 transition"
                >
                  Contact
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-lg mb-4">Contact</h4>
            <ul className="space-y-3 text-stone-400">
              <li>support@showfront.events</li>
              <li>+216 71 000 000</li>
              <li>Tunis, Tunisia</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-stone-800 mt-12 pt-8 text-center text-stone-500 text-sm">
          <p>© 2026 Showfront Events. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
