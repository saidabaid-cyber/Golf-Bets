import test from "node:test";
import assert from "node:assert/strict";
import {ADMIN_CATALOG_COPY,adminSaveLabel,adminSavedMessage,adminReferenceMessage,newestBetDraftRows} from "../lib/admin-ui";

test("bet draft list selects the latest revision even when response ordering changes",()=>{
 const rows=[{id:"old",variant_id:"one",version:1,base_version:0},{id:"other",variant_id:"two",version:4,base_version:3},{id:"new",variant_id:"one",version:2,base_version:0}];
 const snapshot=JSON.stringify(rows);
 assert.deepEqual(newestBetDraftRows(rows).map(row=>row.id),["new","other"]);
 assert.equal(newestBetDraftRows(rows)[0].base_version,0);
 assert.equal(JSON.stringify(rows),snapshot);
});

test("already published and stale bet drafts stay out of the everyday list",()=>{
 const rows=[{variant_id:"published",version:1,base_version:0},{variant_id:"fresh",version:4,base_version:3},{variant_id:"new",version:1,base_version:0}];
 assert.deepEqual(newestBetDraftRows(rows,[{variant_id:"published",version:2},{variant_id:"fresh",version:3}]).map(row=>row.variant_id),["fresh","new"]);
});
test("catalog copy uses the correct domain and edit/create verbs",()=>{
 assert.equal(ADMIN_CATALOG_COPY.competitions.search,"Buscar torneos…");
 assert.equal(adminSaveLabel("courses",true),"Guardar cambios");
 assert.equal(adminSaveLabel("courses",false),"Crear campo");
 assert.equal(adminSaveLabel("equipment",false),"Agregar equipo");
 assert.equal(adminSaveLabel("balls",false),"Agregar bola");
});
test("saving a revision never claims it has been published",()=>{
 assert.match(adminSavedMessage("courses","draft"),/Pendientes de publicar/);
 assert.equal(adminSavedMessage("courses","archive-record"),"Campo archivado");
 assert.equal(adminSavedMessage("courses","delete-record"),"Campo eliminado");
});
test("referenced records show archive guidance rather than promising deletion",()=>{
 assert.match(adminReferenceMessage("campo",127,false),/no puede eliminarse definitivamente/);
 assert.match(adminReferenceMessage("campo",0,false),/debe conservarse/);
 assert.match(adminReferenceMessage("campo",0,true),/eliminar definitivamente/);
});
