import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-900 to-teal-400 text-white">
      {/* Navbar */}
      <nav className="w-full flex justify-between items-center px-6 max-w-7xl mx-auto h-20">
        <div className="flex flex-row items-center gap-4">
          <Image
            src="/card_goblin_logo_simple_2.svg"
            alt="CardGoblin logomark"
            width={64}
            height={64}
          />
          <h1 className="hidden lg:block text-3xl font-extrabold tracking-tight">
            Card Goblin
          </h1>
        </div>
        <div className="flex space-x-6 items-center">
          {/* Documentation now points at the in-app wiki (/docs), which renders
              the markdown under docs/wiki/ — same files GitHub readers see. */}
          <Link href="/docs" className="hover:underline">
            Documentation
          </Link>
          <a
            href="editor"
            className="hidden lg:block bg-white text-teal-600 px-4 py-2 rounded-xl font-semibold hover:bg-gray-200"
          >
            Try the Editor
          </a>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="flex flex-col justify-center items-center text-center flex-1 p-10">
        <Image
          className="mb-6"
          src="/card_goblin_logo.svg"
          alt="CardGoblin logomark"
          width={300}
          height={300}
        />
        <h1 className="text-5xl font-extrabold tracking-tight">
          Create & Design Cards Effortlessly
        </h1>
        <p className="mt-4 text-lg max-w-2xl">
          A powerful tool for board game designers to create print-and-play
          cards with ease.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <a
            href="editor"
            className="bg-white text-teal-600 px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:bg-gray-200"
          >
            Start Editing
          </a>
          <Link
            href="/docs"
            className="border border-white/60 px-6 py-3 rounded-xl text-lg font-semibold hover:bg-white/10"
          >
            Read the Docs
          </Link>
        </div>
      </header>

      {/* Info & Call to Action */}
      <section className="bg-white text-gray-900 p-12 flex flex-col items-center text-center">
        <h2 className="text-3xl font-bold">Why Use Our Editor?</h2>
        <p className="max-w-3xl mt-4 text-lg">It’s FREE</p>
        <p className="max-w-3xl mt-4 text-lg">
          but also, simplify your board game design process with our intuitive,
          real-time editing and automation features.
        </p>
        <a
          href="editor"
          className="mt-6 bg-teal-600 text-white px-6 py-3 rounded-xl text-lg font-semibold shadow-lg hover:bg-teal-800"
        >
          Try it Now
        </a>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 text-sm text-center p-4">
        Icons by{" "}
        <a
          href="https://speakthesky.itch.io/typeface-dicier"
          className="underline hover:text-white"
        >
          Dicier
        </a>{" "}
        by Speak the Sky, licensed under{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          className="underline hover:text-white"
        >
          CC BY 4.0
        </a>
        .
      </footer>
    </div>
  );
}
