"use client";

import Image from "next/image";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  GolfClubCatalog,
  GolfShaftCatalog,
  PlayerClub,
} from "../../lib/golf-equipment";
import { sortCurrentWedges } from "../../lib/equipment-bag-management";
import type { ProfileHandedness } from "../../lib/equipment-editor-selection";
import { CatalogProductMedia } from "./catalog-product-media";
import { EQUIPMENT_CATEGORY_ASSETS } from "./equipment-category-assets";
import { ClubEditor } from "./equipment-editors";
import { BottomBackAction } from "./bottom-back-action";
import styles from "./wedge-collection-editor.module.css";

type WedgeCollectionEditorProps = {
  userId: string;
  catalog: readonly GolfClubCatalog[];
  shafts: readonly GolfShaftCatalog[];
  wedges: readonly PlayerClub[];
  defaultHandedness?: ProfileHandedness | null;
  backLabel?: string;
  onBack: () => void;
  onSave: (club: PlayerClub) => boolean | void;
  onDelete: (club: PlayerClub) => boolean | void;
  onManageDistance?: (club: PlayerClub) => void;
};

type EditorSelection = PlayerClub | "new" | null;

function wedgeLoft(club: PlayerClub) {
  return club.loft === null ? "Loft sin indicar" : `${club.loft}°`;
}

function wedgeName(club: PlayerClub, catalogById: ReadonlyMap<string, GolfClubCatalog>) {
  const catalogClub = club.catalogClubId ? catalogById.get(club.catalogClubId) : null;
  return [
    catalogClub?.brand || club.customBrand,
    catalogClub?.model || club.customModel,
  ].filter(Boolean).join(" ") || "Wedge guardado";
}

export function WedgeCollectionEditor({
  userId,
  catalog,
  shafts,
  wedges,
  defaultHandedness,
  backLabel = "Volver a Mi Bolsa",
  onBack,
  onSave,
  onDelete,
  onManageDistance,
}: WedgeCollectionEditorProps) {
  const titleId = useId();
  const listTitleId = useId();
  const editorTitleId = useId();
  const deleteTitleId = useId();
  const [selection, setSelection] = useState<EditorSelection>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlayerClub | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const editorRegionRef = useRef<HTMLElement>(null);
  const deleteRegionRef = useRef<HTMLElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusPendingRef = useRef(false);
  const orderedWedges = useMemo(() => sortCurrentWedges(wedges), [wedges]);
  const catalogById = useMemo(
    () => new Map(catalog.map((club) => [club.id, club])),
    [catalog],
  );
  const wedgeAsset = EQUIPMENT_CATEGORY_ASSETS.WEDGE;
  const selectedWedge = selection === "new" || selection === null ? null : selection;
  const selectedOrdinal = selection === "new"
    ? orderedWedges.length + 1
    : Math.max(1, orderedWedges.findIndex((club) => club.id === selectedWedge?.id) + 1);

  useLayoutEffect(() => {
    if (deleteTarget) {
      deleteRegionRef.current?.focus();
      return;
    }
    if (selection) {
      editorRegionRef.current?.focus();
      return;
    }
    if (!restoreFocusPendingRef.current) return;
    const returnTarget = returnFocusRef.current?.isConnected ? returnFocusRef.current : addButtonRef.current;
    returnTarget?.focus({ preventScroll: true });
    restoreFocusPendingRef.current = false;
    returnFocusRef.current = null;
  }, [deleteTarget, orderedWedges.length, selection]);

  function chooseEditor(next: EditorSelection, returnTarget?: HTMLButtonElement | null) {
    if (next) {
      returnFocusRef.current = returnTarget || null;
      restoreFocusPendingRef.current = true;
    }
    setErrorMessage("");
    setStatusMessage("");
    setDeleteTarget(null);
    setEditorDirty(false);
    setSelection(next);
  }

  function handleBack() {
    if ((selection || deleteTarget) && editorDirty && !window.confirm("Tienes cambios sin guardar. ¿Salir sin guardarlos?")) return;
    if (selection || deleteTarget) {
      chooseEditor(null);
      return;
    }
    onBack();
  }

  function saveWedge(club: PlayerClub) {
    const saved = onSave(club);
    if (saved === false) {
      setErrorMessage("No se confirmó el guardado. Revisa los datos e intenta de nuevo.");
      return false;
    }
    setErrorMessage("");
    setStatusMessage(`${wedgeName(club, catalogById)} guardado.`);
    setEditorDirty(false);
    setSelection(null);
    return saved;
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const name = wedgeName(deleteTarget, catalogById);
    const deleted = onDelete(deleteTarget);
    if (deleted === false) {
      setErrorMessage("No se confirmó la eliminación. Intenta de nuevo.");
      return;
    }
    setErrorMessage("");
    setStatusMessage(`${name} eliminado de tu bolsa.`);
    setDeleteTarget(null);
    setSelection(null);
  }

  const returnLabel = `← ${selection || deleteTarget ? "Volver a tus wedges" : backLabel}`;

  return <section className={styles.shell} aria-labelledby={titleId}>
    <header className={styles.header}>
      <button
        type="button"
        className={styles.backButton}
        onClick={handleBack}
      >
        {returnLabel}
      </button>
      <h1 id={titleId}>Agregar Wedges</h1>
      <p>Marca + modelo es suficiente. Las especificaciones son opcionales.</p>
    </header>

    <section className={styles.collection} aria-labelledby={listTitleId}>
      <div className={styles.collectionHeading}>
        <h2 id={listTitleId}>Tus wedges</h2>
        <p>Puedes configurar varios wedges y cada uno puede ser de una marca distinta.</p>
      </div>

      {orderedWedges.length > 0 ? <ol className={styles.wedgeList}>
        {orderedWedges.map((club, index) => {
          const catalogClub = club.catalogClubId ? catalogById.get(club.catalogClubId) : null;
          const name = wedgeName(club, catalogById);
          const active = selectedWedge?.id === club.id && !deleteTarget;
          return <li key={club.id}>
            <button
              type="button"
              className={styles.wedgeButton}
              data-active={active || undefined}
              aria-expanded={active}
              aria-controls={editorTitleId}
              aria-label={`Editar wedge ${index + 1}, ${club.loft === null ? "loft sin indicar" : `${club.loft} grados`}, ${name}`}
              onClick={(event) => chooseEditor(club, event.currentTarget)}
            >
              <span className={styles.wedgeMedia} aria-hidden="true">
                <CatalogProductMedia
                  item={catalogClub}
                  fallback={<Image src={wedgeAsset.src} alt="" width={wedgeAsset.width} height={wedgeAsset.height} sizes="72px" unoptimized />}
                />
              </span>
              <span className={styles.wedgeCopy}>
                <b>Wedge {index + 1} · {wedgeLoft(club)}</b>
                <small>{name}</small>
              </span>
              <strong aria-hidden="true">›</strong>
            </button>
          </li>;
        })}
      </ol> : <div className={styles.emptyState}>
        <b>Todavía no has configurado wedges.</b>
        <p>Empieza por el loft; cada wedge conservará su propia marca, modelo y configuración.</p>
      </div>}

      <button
        ref={addButtonRef}
        type="button"
        className={styles.addButton}
        aria-expanded={selection === "new" && !deleteTarget}
        aria-controls={editorTitleId}
        onClick={(event) => chooseEditor("new", event.currentTarget)}
      >
        <span aria-hidden="true">+</span>
        Agregar otro wedge
      </button>
    </section>

    <p className={styles.statusMessage} role="status" aria-live="polite">{statusMessage}</p>
    {errorMessage && <p className={styles.errorMessage} role="alert">{errorMessage}</p>}

    {deleteTarget ? <section
      ref={deleteRegionRef}
      className={styles.deleteConfirmation}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={deleteTitleId}
      tabIndex={-1}
    >
      <span>MI BOLSA · CONFIRMAR</span>
      <h2 id={deleteTitleId}>¿Eliminar {wedgeName(deleteTarget, catalogById)}?</h2>
      <p>Sólo se eliminará este wedge de Mi Bolsa. Sus distancias manuales también se quitarán. Los demás wedges y las rondas históricas no cambian.</p>
      <div className={styles.confirmationActions}>
        <button type="button" className={styles.cancelButton} onClick={() => setDeleteTarget(null)}>Cancelar</button>
        <button type="button" className={styles.deleteButton} onClick={confirmDelete}>Eliminar wedge</button>
      </div>
    </section> : selection && <section
      ref={editorRegionRef}
      id={editorTitleId}
      className={styles.editorRegion}
      aria-label={selection === "new" ? `Configurar wedge ${selectedOrdinal}` : `Editar wedge ${selectedOrdinal}`}
      tabIndex={-1}
    >
      <ClubEditor
        key={selection === "new" ? `new-wedge-${orderedWedges.length}` : selection.id}
        userId={userId}
        catalog={catalog}
        shafts={shafts}
        existing={selection === "new" ? null : selection}
        defaultHandedness={defaultHandedness}
        initialCategory="WEDGE"
        presentation="embedded"
        wedgeOrdinal={selectedOrdinal}
        wedgePeers={orderedWedges}
        onCancel={() => chooseEditor(null)}
        onSave={saveWedge}
        onRequestDelete={selection === "new" ? undefined : () => setDeleteTarget(selection)}
        onManageDistance={selection === "new" || !onManageDistance ? undefined : () => onManageDistance(selection)}
        onDirtyChange={setEditorDirty}
      />
    </section>}
    <BottomBackAction label={returnLabel} onBack={handleBack} />
  </section>;
}
