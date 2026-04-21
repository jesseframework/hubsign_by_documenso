import { Outlet } from 'react-router';

export default function Layout() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      {/* Subtle gradient background */}
      <div
        className="absolute inset-0 -z-10 opacity-40"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, hsla(254, 97%, 67%, 0.12) 0%, transparent 60%), radial-gradient(ellipse at 80% 100%, hsla(43, 96%, 52%, 0.08) 0%, transparent 50%)',
        }}
      />

      <div className="relative w-full max-w-lg">
        <Outlet />
      </div>
    </main>
  );
}
