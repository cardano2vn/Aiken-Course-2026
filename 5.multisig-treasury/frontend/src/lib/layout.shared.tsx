import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Link from 'next/link';
import Image from 'next/image';
import { images } from '@/public/images';
import { routers } from '@/constants/routers';

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: 'fuma-nama',
  repo: 'fumadocs',
  branch: 'main',
};

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
            <div className="flex flex-col items-start gap-3">
                <Link href={routers.home} className="flex items-center gap-3">
                    <Image className="h-12 w-auto animate-pulse" loading="lazy" src={images.logo} alt="Cardano2vn" />
                    <h3 className="text-2xl font-bold text-gray-950 dark:text-gray-300 font-stretch-50%">Multisig Treasury</h3>
                </Link>
            </div>
        ),
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
