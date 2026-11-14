import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { SpiderEmblem } from './SpiderEmblem';

interface WelcomeSplashProps {
  onComplete: () => void;
}

export const WelcomeSplash: React.FC<WelcomeSplashProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState<number>(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const particles = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => ({
        id: i,
        left: `${(i * 37) % 100}%`,
        top: `${(i * 53) % 100}%`,
        size: 2 + (i % 3),
        delay: (i % 7) * 0.14,
        dx: ((i % 5) - 2) * 18,
        dy: -24 - (i % 4) * 14,
      })),
    []
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);

    if (mq.matches) {
      setPhase(4);
      const t = window.setTimeout(onComplete, 1400);
      return () => clearTimeout(t);
    }

    const timers = [
      window.setTimeout(() => setPhase(1), 950),
      window.setTimeout(() => setPhase(2), 1950),
      window.setTimeout(() => setPhase(3), 2950),
      window.setTimeout(() => setPhase(4), 3950),
      window.setTimeout(() => onComplete(), 5000),
    ];

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45 }}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[#060608] text-[#F5F5F7] select-none"
        role="region"
        aria-label="RIKZEN CHAT welcome animation"
      >
        {/* 0-1s: Subtle champagne-gold radial light */}
        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: phase >= 2 ? 0.85 : 0.45, scale: phase >= 2 ? 1.15 : 0.95 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="pointer-events-none absolute h-[420px] w-[420px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(212,175,55,0.22) 0%, rgba(212,175,55,0.06) 45%, rgba(6,6,8,0) 72%)',
          }}
        />

        {/* Golden floating particles */}
        {!reducedMotion &&
          particles.map((p) => (
            <motion.span
              key={p.id}
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{
                opacity: [0, 0.75, 0.25, 0],
                x: p.dx,
                y: p.dy,
              }}
              transition={{
                duration: 3.8,
                delay: p.delay,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              className="pointer-events-none absolute rounded-full bg-[#E5C76B]"
              style={{
                left: p.left,
                top: p.top,
                width: p.size,
                height: p.size,
              }}
            />
          ))}

        {/* 1-2s: Elegant spider-web animation forming behind the emblem */}
        <div className="relative flex items-center justify-center">
          <svg
            width="280"
            height="280"
            viewBox="0 0 280 280"
            className="pointer-events-none opacity-65"
            aria-hidden="true"
          >
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, idx) => {
              const rad = (angle * Math.PI) / 180;
              const x2 = 140 + Math.cos(rad) * 130;
              const y2 = 140 + Math.sin(rad) * 130;
              return (
                <motion.line
                  key={angle}
                  x1="140"
                  y1="140"
                  x2={x2}
                  y2={y2}
                  stroke="#D4AF37"
                  strokeOpacity="0.28"
                  strokeWidth="1"
                  initial={{ pathLength: reducedMotion ? 1 : 0 }}
                  animate={{ pathLength: phase >= 1 ? 1 : 0 }}
                  transition={{ duration: 0.7, delay: idx * 0.04 }}
                />
              );
            })}
            {[36, 68, 102, 130].map((r, idx) => (
              <motion.circle
                key={r}
                cx="140"
                cy="140"
                r={r}
                fill="none"
                stroke="#D4AF37"
                strokeOpacity={0.22 - idx * 0.03}
                strokeWidth="0.9"
                strokeDasharray="4 4"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 0.7 }}
                transition={{ duration: 0.65, delay: 0.15 + idx * 0.1 }}
              />
            ))}
          </svg>

          {/* 1-3s: Golden Spider Emblem cinematic reveal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.78 }}
            animate={{
              opacity: phase >= 1 ? 1 : 0,
              scale: phase >= 2 ? 1 : 0.88,
            }}
            transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
            className="absolute flex items-center justify-center"
          >
            <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-[#D4AF37]/35 bg-[#0C0C0F] shadow-[0_0_50px_rgba(212,175,55,0.22)]">
              <img
                src="/src/assets/images/rikzen_spider_emblem_1794652828706.jpg"
                alt="RIKZEN Spider Emblem"
                referrerPolicy="no-referrer"
                className="h-24 w-24 rounded-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
              <SpiderEmblem size={64} className="pointer-events-none absolute opacity-20" />
            </div>
          </motion.div>
        </div>

        {/* 3-4s: RIKZEN CHAT + CONNECT • CHAT • SHARE */}
        <div className="mt-6 flex min-h-[110px] flex-col items-center px-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 12 }}
            transition={{ duration: 0.6 }}
            className="font-display text-3xl font-bold tracking-[0.22em] text-[#F5E6B3] sm:text-4xl"
          >
            RIKZEN CHAT
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: phase >= 3 ? 1 : 0, y: phase >= 3 ? 0 : 8 }}
            transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-2.5 text-xs font-medium tracking-[0.28em] text-[#D4AF37]/90 sm:text-sm"
          >
            CONNECT • CHAT • SHARE
          </motion.p>

          {/* 4-5s: WELCOME TO RIKZEN CHAT */}
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: phase >= 4 ? 1 : 0, y: phase >= 4 ? 0 : 6 }}
            transition={{ duration: 0.5 }}
            className="mt-5 text-sm font-medium tracking-[0.16em] text-[#F5F5F7]/85"
          >
            WELCOME TO RIKZEN CHAT
          </motion.p>
        </div>

        {/* Dedicated bottom progress & brand bar (no skip button) */}
        <div className="absolute inset-x-0 bottom-0 border-t border-[#D4AF37]/15 bg-[#08080B]/90 px-6 py-5 backdrop-blur-sm">
          <div className="mx-auto flex max-w-md flex-col items-center gap-2.5">
            <div className="h-[2px] w-44 overflow-hidden rounded-full bg-white/10">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: reducedMotion ? 1.4 : 5, ease: 'linear' }}
                className="h-full w-full origin-left bg-gradient-to-r from-[#9C7316] via-[#F5E6B3] to-[#22C55E]"
              />
            </div>
            <p className="text-[11px] font-medium tracking-[0.26em] text-[#9898A6] uppercase">
              RIKZEN • PRIVATE MESSAGING
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
