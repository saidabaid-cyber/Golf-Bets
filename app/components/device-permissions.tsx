"use client";
import { useEffect, useRef, useState } from 'react';
import { requestCourseLocation } from '../../lib/browser-course-location';
export function DevicePermissions({ kind = 'all' }: { kind?: 'all' | 'location' | 'notifications' }) {
  const [location, setLocation] = useState('consultando');
  const [notification, setNotification] = useState('consultando');
  const [message, setMessage] = useState('');
  const cancel = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true;
    let permission: PermissionStatus | undefined;
    const refresh = async () => {
      if (!alive) return;
      setNotification('Notification' in window ? Notification.permission : 'unsupported');
      if (!navigator.geolocation) { setLocation('unsupported'); return; }
      try {
        const value = await navigator.permissions.query({ name: 'geolocation' });
        if (!alive) return;
        if (permission) permission.onchange = null;
        permission = value; setLocation(value.state);
        value.onchange = () => { if (alive) setLocation(value.state); };
      } catch { if (alive) setLocation('prompt'); }
    };
    void refresh(); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { alive = false; cancel.current(); if (permission) permission.onchange = null; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const label = (state: string) => ({ granted: 'Permitido', denied: 'Bloqueado en este navegador', prompt: 'Sin solicitar', default: 'Sin solicitar', unsupported: 'No disponible en este navegador', loading: 'Solicitando permiso…', consultando: 'Consultando…' })[state] || 'No disponible';
  return <div className="devicePermissions">
    {kind !== 'notifications' && <section><h3>Ubicación</h3><p>Para encontrar campos cercanos. No guardamos ni enviamos tu ubicación.</p><p role="status">{label(location)}</p><button type="button" className="secondary" disabled={location === 'loading' || location === 'unsupported'} onClick={() => {
      cancel.current(); setLocation('loading'); setMessage('');
      cancel.current = requestCourseLocation(navigator.geolocation, result => { setLocation(result.status === 'located' ? 'granted' : result.status === 'denied' ? 'denied' : 'prompt'); if (result.status !== 'located') setMessage('No se obtuvo ubicación. Puedes buscar campos manualmente y administrar el permiso en los ajustes del sitio.'); });
    }}>Administrar ubicación</button></section>}
    {kind !== 'location' && <section><h3>Permiso de notificaciones</h3><p role="status">{label(notification)}</p><p>El permiso es de este dispositivo. No activa por sí solo un servicio de envío push. En iPhone puede requerir instalar la app.</p><button type="button" className="secondary" disabled={notification === 'unsupported' || notification === 'loading'} onClick={async () => { if (!('Notification' in window)) return; setNotification('loading'); try { setNotification(await Notification.requestPermission()); } catch { setNotification(Notification.permission); setMessage('Revisa el permiso en los ajustes del sitio de tu navegador.'); } }}>Administrar notificaciones</button></section>}
    <small>Puedes revocar permisos desde los ajustes de este sitio en tu navegador. Son opcionales y no bloquean jugar.</small>{message && <p role="status">{message}</p>}
  </div>;
}
