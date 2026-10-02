"use client";
import Link from "next/link";
import { useBackyardAccount } from "./account-provider";
export function AdminModeMenu() {
  const { adminAccess, logout } = useBackyardAccount();
  if (!adminAccess.hasAccess) return null;
  return <details className="adminV2ModeMenu"><summary>Administrador</summary><nav aria-label="Cambiar modo"><Link href="/">Modo jugador</Link><Link href="/manage">Modo administrador</Link><button type="button" onClick={() => void logout()}>Cerrar sesión</button></nav></details>;
}
