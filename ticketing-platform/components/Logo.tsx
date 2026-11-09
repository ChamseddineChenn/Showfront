'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { scrollToTop } from '@/lib/utils/scroll';

interface LogoProps {
  isAdmin?: boolean;
}

export function Logo({ isAdmin = false }: LogoProps) {
  const router = useRouter();

  const handleClick = () => {
    scrollToTop();
    if (isAdmin) {
      router.push('/admin');
    }
  };

  const logoContent = (
    <>
      <Image
        src="/Showfront_logo.png"
        alt="Showfront Logo"
        width={160}
        height={160}
        className="w-12 h-12 sm:w-14 sm:h-14 object-contain flex-shrink-0"
        priority
      />
      <div>
        <h1 className="text-base sm:text-2xl font-bold text-stone-900 tracking-tight">
          Showfront
        </h1>
        <p className="text-xs sm:text-sm text-stone-500 -mt-0.5 hidden sm:block">
          Events & Experiences
        </p>
      </div>
    </>
  );

  // Admin users: clickable div with router navigation
  if (isAdmin) {
    return (
      <div
        onClick={handleClick}
        className="flex items-center gap-2 sm:gap-3 cursor-pointer hover:opacity-80 transition-opacity"
      >
        {logoContent}
      </div>
    );
  }

  // Regular users: Link to home
  return (
    <Link
      href="/"
      onClick={scrollToTop}
      className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition-opacity"
    >
      {logoContent}
    </Link>
  );
}
