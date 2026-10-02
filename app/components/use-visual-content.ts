"use client";
import {useEffect,useState} from "react";
type Published={target_kind:string;target_key:string;values:{title?:string;body?:string;description?:string;instructions?:string;active?:boolean;icon?:string;order?:number}};
export function useVisualContent(){const [items,setItems]=useState<Published[]>([]);useEffect(()=>{const controller=new AbortController();void fetch("/api/catalog/presentation",{signal:controller.signal}).then(r=>r.ok?r.json():null).then(body=>{if(body?.items)setItems(body.items);}).catch(()=>{});return()=>controller.abort();},[]);return items;}
