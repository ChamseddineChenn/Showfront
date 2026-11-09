export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background Image with Overlay */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: "url('/images/Showfront_Event_Banner.png')",
        }}
      ></div>

      {/* Dark Overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-br from-stone-900/80 via-stone-800/75 to-stone-900/80"></div>

      {/* Pattern Overlay */}
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50"></div>

      <div className="relative max-w-7xl mx-auto px-6 lg:px-8 py-24 lg:py-32">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 text-amber-400 px-4 py-2 rounded-full text-sm font-medium mb-8 border border-amber-500/20">
            <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
            Premium Event Experiences in Tunisia
          </div>

          <h2 className="text-4xl md:text-6xl font-bold text-white leading-tight mb-6">
            Create Memories That Last a{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500">
              Lifetime
            </span>
          </h2>

          <p className="text-xl text-stone-300 mb-10 leading-relaxed max-w-2xl">
            Discover and book exclusive tickets to the most extraordinary
            events. From concerts to conferences, your next unforgettable
            experience awaits.
          </p>

          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="#events"
              className="bg-gradient-to-r from-amber-500 to-amber-600 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:from-amber-600 hover:to-amber-700 transition shadow-xl shadow-amber-500/25 text-center"
            >
              Explore Events
            </a>
          </div>
        </div>
      </div>

      {/* Decorative Elements */}
      <div className="absolute top-20 right-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-10 left-10 w-96 h-96 bg-amber-500/5 rounded-full blur-3xl"></div>
    </section>
  );
}
