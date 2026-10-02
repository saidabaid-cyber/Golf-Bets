import test from "node:test";
import assert from "node:assert/strict";
import {ADMIN_CATALOG_COPY,adminSaveLabel,adminSavedMessage,adminReferenceMessage} from "../lib/admin-ui";
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
