'use client';

import dynamic from 'next/dynamic';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        width: '100vw',
        backgroundColor: '#0b0f19',
        color: '#f8fafc',
        fontFamily: "'Host Grotesk', -apple-system, sans-serif",
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: '3px solid rgba(59, 130, 246, 0.2)',
          borderTopColor: '#3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <div style={{ fontSize: '14px', letterSpacing: '0.05em', color: '#94a3b8' }}>
        LOADING 3D METRO ENGINE...
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  ),
});

export default function Home() {
  return (
    <main style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <MapComponent />
    </main>
  );
}
