"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";

export function AppInfoTrigger({ children = "Andante", className = "" }: { children?: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={`app-info-trigger ${className}`} aria-label="안단테 정보" aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</button>
    {open && createPortal(<AppInfoDialog onClose={() => setOpen(false)} />, document.body)}
  </>;
}

function AppInfoDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { ref.current?.showModal(); }, []);
  const close = () => ref.current?.close();
  return <dialog ref={ref} className="app-info-dialog" aria-labelledby={titleId} onClose={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="app-info-content">
      <div className="app-info-heading">
        <div className="app-info-identity"><img src="/icon-192.png" width={44} height={44} alt="" /><h2 id={titleId}>Andante</h2></div>
        <button type="button" className="app-info-close" aria-label="닫기" onClick={close}><X size={20} /></button>
      </div>
      <p className="app-info-credit">41기 구강민 제작</p>
      <a className="app-info-github" href="https://github.com/koom104/andante-bandroom" target="_blank" rel="noopener noreferrer">GitHub <ArrowUpRight size={17} aria-hidden="true" /></a>
      <div className="app-info-contact"><h3>문의</h3><p>카카오톡 ID <strong>koom104</strong>로 문의해 주세요.</p></div>
    </div>
  </dialog>;
}
