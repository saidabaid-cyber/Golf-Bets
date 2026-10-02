"use client";
import {useEffect,useId,useRef,type ReactNode} from "react";
import {createPortal} from "react-dom";

/** Native modal provides focus trapping and Escape; portal avoids nested forms. */
export function AdminSheet({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose),id=useId();
 useEffect(()=>{close.current=onClose;},[onClose]);
 useEffect(()=>{
  const element=dialog.current;if(!element)return;
  const previous=document.activeElement as HTMLElement|null;
  element.showModal();
  const prior=document.body.style.overflow;document.body.style.overflow="hidden";
  return()=>{document.body.style.overflow=prior;element.close();previous?.focus();};
 },[]);
 return createPortal(<dialog ref={dialog} aria-labelledby={id} className="adminV2 adminV2Sheet" onCancel={event=>{event.preventDefault();close.current();}}><header className="adminV2SheetHeader"><h2 id={id}>{title}</h2><button type="button" className="secondary" aria-label="Cerrar" onClick={onClose}>×</button></header>{children}</dialog>,document.body);
}
