"use client";

import { useState } from "react";
import { ModalShell } from "./modal-shell";

export function GhinPlaceholder() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary ghinPlaceholderButton" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      VINCULAR GHIN <small>PRÓXIMAMENTE</small>
    </button>
    <ModalShell open={open} onClose={() => setOpen(false)} labelledBy="ghin-placeholder-title">
      <h2 id="ghin-placeholder-title">Integración GHIN oficial pendiente</h2>
      <p>The Backyard conservará tu HCP manual. La vinculación se habilitará únicamente mediante un proveedor autorizado, sin scraping ni solicitud de credenciales no oficiales.</p>
      <div className="dialogActions"><button type="button" className="primary" onClick={() => setOpen(false)}>Entendido</button></div>
    </ModalShell>
  </>;
}
