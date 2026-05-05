// Minimal layout for unauthenticated routes (currently /login). No sidebar,
// no company switcher — just the form on a centered card so it works
// before any of the in-app context is available.

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <p className="text-base font-semibold text-slate-900">Contractor OS</p>
          <p className="text-xs text-slate-500 mt-0.5">Sign in to continue</p>
        </div>
        {children}
      </div>
    </div>
  );
}
