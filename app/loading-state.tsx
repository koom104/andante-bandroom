import { LoaderCircle } from "lucide-react";

export function LoadingStatus({ label, className = "" }: { label: string; className?: string }) {
  return <div className={`loading-status ${className}`} role="status" aria-live="polite">
    <LoaderCircle className="loading-status-spinner" size={17} strokeWidth={1.7} aria-hidden="true" />
    <span>{label}</span>
  </div>;
}

export function LoadingScreen({ label }: { label: string }) {
  return <main className="app-viewport loading-screen" aria-busy="true">
    <div className="loading-screen-content">
      <div className="loading-brand-glass" aria-hidden="true">
        <img src="/icon-192.png" width={56} height={56} alt="" />
      </div>
      <h1>Andante</h1>
      <LoadingStatus label={label} />
    </div>
  </main>;
}
