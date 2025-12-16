import { Metadata } from 'next';
import TokenDetailsClient from './TokenDetailsClient';
import { getTokenMetadata } from '@/lib/utils/token';

interface TokenPageProps {
  params: Promise<{
    address: string;
  }>;
}

export async function generateMetadata({ params }: TokenPageProps): Promise<Metadata> {
  const { address } = await params;
  const tokenInfo = getTokenMetadata(address);
  const token = tokenInfo?.token;

  if (!token) {
    return {
      title: 'Token Details | Vaulto Swap',
      description: 'View detailed token information including price data, charts, and trading information.',
    };
  }

  return {
    title: `${token.name} (${token.symbol}) | Vaulto Swap`,
    description: `View detailed information about ${token.name} including price data, charts, and trading information.`,
  };
}

export default async function TokenPage({ params }: TokenPageProps) {
  const { address } = await params;
  const tokenInfo = getTokenMetadata(address);

  // Show page even if token is not in config - we'll fetch what we can
  const chainId = tokenInfo?.chainId || 1;

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-black via-gray-900 to-black relative w-full">
      {/* Subtle Gold Gradient Overlays - matching main page */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {/* Top-left gold glow */}
        <div className="absolute -top-32 -left-32 w-[800px] h-[800px] animate-[float_20s_ease-in-out_infinite]">
          <div className="w-full h-full bg-gradient-to-br from-yellow-400/20 via-yellow-300/15 to-transparent blur-3xl"></div>
        </div>
        
        {/* Top-right gold glow */}
        <div className="absolute -top-32 -right-32 w-[700px] h-[700px] animate-[float_25s_ease-in-out_infinite_reverse]">
          <div className="w-full h-full bg-gradient-to-bl from-yellow-300/18 via-yellow-400/12 to-transparent blur-3xl"></div>
        </div>
        
        {/* Bottom center gold shimmer */}
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[900px] h-[900px] animate-[pulse_30s_ease-in-out_infinite]">
          <div className="w-full h-full bg-gradient-to-t from-yellow-500/20 via-yellow-300/12 to-transparent blur-3xl"></div>
        </div>
        
        {/* Bottom-right purple glow */}
        <div className="absolute -bottom-32 -right-32 w-[800px] h-[800px] animate-[float_22s_ease-in-out_infinite]">
          <div className="w-full h-full bg-gradient-to-tl from-purple-500/35 via-purple-400/25 to-transparent blur-3xl"></div>
        </div>
      </div>
      
      <main className="relative z-10 h-full overflow-hidden">
        <div className="container mx-auto py-8 h-full overflow-hidden">
          <TokenDetailsClient address={address} chainId={chainId} />
        </div>
      </main>
    </div>
  );
}
