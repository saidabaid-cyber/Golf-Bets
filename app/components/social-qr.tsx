"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QA_SOCIAL_ORIGIN, socialIdFromQr, socialProfileLink } from "../../lib/social-connections";
import { ProfileAvatarMedia } from "./profile-avatar-media";
import styles from "./social-qr.module.css";
export const PENDING_SOCIAL_KEY="backyard-pending-social-profile-v1";
export function CaptureSocialProfileLink(){useEffect(()=>{const id=socialIdFromQr(location.href,location.origin);if(id){try{sessionStorage.setItem(PENDING_SOCIAL_KEY,id);}catch{/* Keep URL available. */}}},[]);return null;}
export function PersonalQr({userId,name,username,avatar,onClose}:{userId:string;name:string;username:string;avatar:string;onClose:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),avatarElement=useRef<HTMLDivElement>(null),[link,setLink]=useState(""),[ready,setReady]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{let live=true;setReady(false);const origin=location.hostname.endsWith("-saha8.vercel.app")?QA_SOCIAL_ORIGIN:location.origin;const url=socialProfileLink(userId,origin);setLink(url);
 void (async()=>{const qr=document.createElement("canvas");await QRCode.toCanvas(qr,url,{width:420,margin:4,errorCorrectionLevel:"M"});if(!live||!canvas.current)return;const out=canvas.current;out.width=600;out.height=800;const ctx=out.getContext("2d")!;ctx.fillStyle="#fff";ctx.fillRect(0,0,600,800);ctx.fillStyle="#073f32";ctx.font="bold 28px sans-serif";ctx.textAlign="center";ctx.fillText("THE BACKYARD",300,45);ctx.font="24px sans-serif";ctx.fillText(name,300,185,540);ctx.drawImage(qr,90,205);ctx.font="bold 28px sans-serif";ctx.fillText(username?`@${username}`:"Configura tu nombre de usuario",300,685,550);ctx.font="18px sans-serif";ctx.fillText("Escanea para ver mi perfil",300,740);
 ctx.fillStyle="#e5eddf";ctx.beginPath();ctx.arc(300,110,42,0,Math.PI*2);ctx.fill();ctx.fillStyle="#073f32";ctx.font="34px sans-serif";ctx.fillText(avatarElement.current?.textContent?.trim()||name[0]||"J",300,123,75);
 const img=avatarElement.current?.querySelector("img"),svg=avatarElement.current?.querySelector("svg");
 if(img||svg){try{const image=new Image();image.crossOrigin="anonymous";image.src=svg?`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`:img!.currentSrc||img!.src;await image.decode();if(!live)return;ctx.save();ctx.beginPath();ctx.arc(300,110,42,0,Math.PI*2);ctx.clip();ctx.drawImage(image,258,68,84,84);ctx.restore();}catch{if(live)setMessage("La imagen descargable usa iniciales porque no pudimos leer la foto. Tu avatar guardado no cambió.");}}
 if(live)setReady(true);
 })().catch(()=>setMessage("No pudimos crear el QR. Reintenta."));return()=>{live=false;};},[userId,name,username,avatar]);
 async function share(image:boolean){try{if(image){const blob=await new Promise<Blob|null>(resolve=>canvas.current?.toBlob(resolve,"image/png"));if(!blob)throw new Error();const file=new File([blob],"backyard-mi-qr.png",{type:"image/png"});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title:"Mi QR Backyard"});else{const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}else if(navigator.share)await navigator.share({url:link,title:`${name} · Backyard`});else{await navigator.clipboard.writeText(link);setMessage("Enlace copiado.");}}catch(e){if(!(e instanceof DOMException&&e.name==="AbortError"))setMessage("No se pudo compartir. Puedes copiar el enlace de abajo.");}}
 return <section className={`card ${styles.panel}`}><button type="button" className="textButton" onClick={onClose}>← Social</button><h2>Mi QR</h2><div ref={avatarElement} className={styles.avatar}><ProfileAvatarMedia value={avatar} fallback={name[0]||"J"}/></div><b>{name}</b><canvas ref={canvas} className={styles.qr} aria-label={`Tarjeta QR de ${name}`}/><p>{username?`@${username}`:"Configura tu username desde Perfil"}</p><div className={styles.actions}><button type="button" className="primary" disabled={!ready} onClick={()=>void share(false)}>Compartir enlace</button><button type="button" className="secondary" disabled={!ready} onClick={()=>void share(true)}>Guardar / compartir imagen</button></div><input readOnly value={link} aria-label="Enlace de perfil" onFocus={e=>e.target.select()}/><p className="hint">Sin correo ni credenciales. Cambiar tu username no cambia el identificador del QR. La privacidad sigue vigente.</p>{message&&<p role="status">{message}</p>}</section>;
}
export function SocialQrScanner({onFound,onClose}:{onFound:(id:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),generation=useRef(0);
 const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 function stop(){generation.current++;if(timer.current)clearTimeout(timer.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setActive(false);setBusy(false);}
 useEffect(()=>()=>{generation.current++;if(timer.current)clearTimeout(timer.current);stream.current?.getTracks().forEach(t=>t.stop());},[]);
 function found(value:string){const id=socialIdFromQr(value,location.origin);if(!id){setMessage("QR inválido: elige un enlace de perfil de The Backyard.");return false;}stop();onFound(id);return true;}
 async function decode(source:CanvasImageSource,width:number,height:number){const canvas=document.createElement("canvas");const scale=Math.min(1,1600/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);const ctx=canvas.getContext("2d",{willReadFrequently:true})!;ctx.drawImage(source,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);const jsQR=(await import("jsqr")).default;return jsQR(pixels.data,pixels.width,pixels.height)?.data;}
 async function camera() {
  stop(); const run = generation.current; setBusy(true); setMessage("");
  try {
   if (!navigator.mediaDevices?.getUserMedia) throw new Error();
   const media = await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
   if (run !== generation.current) { media.getTracks().forEach(t => t.stop()); return; }
   stream.current = media; setActive(true);
   if (video.current) { video.current.srcObject = media; await video.current.play(); }
   const scan = async () => {
    if (run !== generation.current || !stream.current) return;
    try {
     const v = video.current;
     if (v?.videoWidth) {
      const value = await decode(v,v.videoWidth,v.videoHeight);
      if (run !== generation.current) return;
      if (value && found(value)) return;
     }
    } catch { if (run === generation.current) setMessage("No pudimos leer esta imagen; prueba desde la galería."); }
    if (run === generation.current) timer.current = setTimeout(() => void scan(),350);
   };
   void scan();
  } catch {
   if (run === generation.current) { setMessage("No pudimos abrir la cámara. Permite su acceso o elige una imagen de la galería."); stop(); }
  } finally { if (run === generation.current) setBusy(false); }
 }
 async function gallery(file?:File){if(!file)return;stop();setMessage("");if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>20*1024*1024){setMessage("Elige una imagen JPEG, PNG o WEBP menor a 20 MB.");return;}setBusy(true);const run=generation.current;try{const bitmap=await createImageBitmap(file);const value=await decode(bitmap,bitmap.width,bitmap.height);bitmap.close();if(run!==generation.current)return;if(!value)setMessage("No encontramos un QR. Usa una imagen clara y completa.");else found(value);}catch{setMessage("No pudimos leer la imagen. Prueba otra captura.");}finally{setBusy(false);}}
 return <section className={`card ${styles.panel}`}><button type="button" className="textButton" onClick={()=>{stop();onClose();}}>← Social</button><h2>Escanear QR</h2><video ref={video} playsInline muted className={styles.video} hidden={!active}/><div className={styles.actions}><button type="button" className="primary" disabled={busy} onClick={()=>void camera()}>Usar cámara</button>{active&&<button type="button" onClick={stop}>Cerrar cámara</button>}<label className="uploadButton">Elegir imagen de la galería<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>void gallery(e.target.files?.[0])}/></label></div><p>Mostraremos el perfil antes de enviar cualquier solicitud. La imagen se lee sólo en tu dispositivo.</p>{message&&<p role="status">{message}</p>}</section>;
}
