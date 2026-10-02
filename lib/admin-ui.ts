/** Display-only copy. Publication, permissions and catalog identities stay unchanged. */
export const ADMIN_CATALOG_COPY: Record<string, {title:string; singular:string; add:string; search:string; empty:string}> = {
 courses:{title:"Campos",singular:"campo",add:"Agregar campo",search:"Buscar campos…",empty:"No hay campos que coincidan con tu búsqueda."},
 equipment:{title:"Equipment",singular:"equipo",add:"Agregar equipo",search:"Buscar marca o modelo…",empty:"No hay equipos que coincidan con tu búsqueda."},
 balls:{title:"Bolas",singular:"bola",add:"Agregar bola",search:"Buscar marca o modelo…",empty:"No hay bolas que coincidan con tu búsqueda."},
 competitions:{title:"Torneos",singular:"torneo",add:"Crear torneo",search:"Buscar torneos…",empty:"No hay torneos que coincidan con tu búsqueda."},
};
export function adminSaveLabel(module:string,existing:boolean){
 if(module==="competitions")return existing?"Guardar cambios":"Guardar borrador";
 if(existing)return "Guardar cambios";
 return module==="courses"?"Crear campo":module==="balls"?"Agregar bola":"Agregar equipo";
}
export function adminSavedMessage(module:string,operation:string){
 const noun=ADMIN_CATALOG_COPY[module]?.singular||"registro";
 if(operation==="draft")return module==="competitions"?"Torneo guardado. Pendiente de publicar.":"Cambios guardados. Pendientes de publicar.";
 if(operation==="archive-record")return `${noun[0].toUpperCase()+noun.slice(1)} archivado`;
 if(operation==="activate-record")return `${noun[0].toUpperCase()+noun.slice(1)} activado`;
 if(operation==="delete-record")return `${noun[0].toUpperCase()+noun.slice(1)} eliminado`;
 return operation==="publish"?"Cambios publicados":"Cambios guardados";
}
export function adminReferenceMessage(noun:string,references:number,canDelete:boolean){
 if(canDelete)return "Sin históricos asociados. Puedes archivar o eliminar definitivamente.";
 return references>0?`Este ${noun} tiene información o históricos asociados y no puede eliminarse definitivamente. Puedes archivarlo.`:`Este ${noun} debe conservarse por su información asociada. Puedes archivarlo.`;
}
