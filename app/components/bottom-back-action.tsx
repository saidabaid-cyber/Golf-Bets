import styles from "./bottom-back-action.module.css";

type BottomBackActionProps = {
  label: string;
  onBack: () => void;
  disabled?: boolean;
};

/** Mirrors a secondary screen's top exit after its primary content. */
export function BottomBackAction({ label, onBack, disabled = false }: BottomBackActionProps) {
  return <div className={styles.container} data-bottom-back-action>
    <button type="button" className={`secondary ${styles.button}`} disabled={disabled} onClick={onBack}>{label}</button>
  </div>;
}
