import React from 'react';

interface SpiderEmblemProps {
  size?: number;
  className?: string;
}

export const SpiderEmblem: React.FC<SpiderEmblemProps> = ({ size = 40, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="RIKZEN Spider Emblem"
    >
      <defs>
        <linearGradient id="rikzenGoldGrad" x1="18" y1="12" x2="102" y2="108" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F5E6B3" />
          <stop offset="48%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#9C7316" />
        </linearGradient>
      </defs>
      {/* Subtle octagonal shield */}
      <circle cx="60" cy="60" r="54" stroke="url(#rikzenGoldGrad)" strokeOpacity="0.35" strokeWidth="1.5" />
      {/* Cephalothorax & Abdomen */}
      <polygon points="60,36 70,46 65,58 55,58 50,46" fill="url(#rikzenGoldGrad)" />
      <polygon points="60,59 73,71 67,92 60,98 53,92 47,71" fill="url(#rikzenGoldGrad)" />
      {/* Faceted inner detail */}
      <path d="M60 62V94M53 72L60 77L67 72" stroke="#09090B" strokeWidth="1.6" strokeLinecap="round" />
      {/* Pedipalps */}
      <path d="M55 37L51 28L55 24" stroke="url(#rikzenGoldGrad)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M65 37L69 28L65 24" stroke="url(#rikzenGoldGrad)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* 8 Articulated Geometric Legs */}
      <path d="M52 45L33 27L22 18" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 50L25 43L14 34" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 56L24 66L16 80" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M53 63L35 84L30 102" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />

      <path d="M68 45L87 27L98 18" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M70 50L95 43L106 34" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M70 56L96 66L104 80" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M67 63L85 84L90 102" stroke="url(#rikzenGoldGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};
