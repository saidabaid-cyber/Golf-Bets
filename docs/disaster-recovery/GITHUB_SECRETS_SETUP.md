# Configuración de secrets y variables en GitHub

**Estado: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

El propietario puede preparar estos Repository secrets y Repository variables en la ventana controlada previa al merge. La primera ejecución manual sí debe ocurrir únicamente después de que el cambio aprobado esté integrado en `main`.

> **Regla absoluta:** NUNCA pegues una contraseña, key, JSON, token, Folder ID ni ningún otro valor en un chat, issue, pull request, comentario, captura, terminal compartida o log. Los valores se pegan únicamente en el campo correspondiente de GitHub. Este documento solo muestra los nombres.

## Antes de abrir GitHub

Ten preparados, cada uno en su gestor seguro y sin copiarlos todavía al portapapeles:

- La contraseña exacta del owner Session Pooler para `BACKUP_PGPASSWORD`. No es una credencial dedicada ni una credencial que GitHub vuelva read-only; la seguridad del backup depende del preflight explícito `BEGIN TRANSACTION READ ONLY` y de ejecutar únicamente comandos de dump.
- La key server-side de Supabase Storage para `BACKUP_STORAGE_KEY`. La key puede tener capacidades más amplias; el código del backup impone una allowlist de listar buckets, listar objetos y descargar objetos, sin operaciones de escritura.
- La key de cifrado para `BACKUP_ENCRYPTION_KEY`: 32 bytes aleatorios codificados en base64. Conserva una copia de recuperación bajo custodia separada.
- El archivo JSON completo del Service Account de Google para `GDRIVE_SERVICE_ACCOUNT_JSON`.
- El Folder ID de la carpeta de Drive `The Backyard - Backups` para `GDRIVE_BACKUP_ROOT_FOLDER_ID`.

El sexto valor es literal y no secreto: `BACKUP_RETENTION_APPLY=false`.

## Abrir la pantalla correcta

1. Entra al repositorio de The Backyard en GitHub con una cuenta propietaria o administradora.
2. Haz clic en la pestaña **Settings**. Si no aparece, abre el menú del repositorio y confirma que tu cuenta tiene permiso de administración.
3. En la barra izquierda, abre **Secrets and variables**.
4. Haz clic en **Actions**.
5. Confirma que estás en la sección de configuración del repositorio, no en la de un Environment. Este workflow usa **Repository secrets** y **Repository variables**.

## Crear los cuatro Repository secrets

Abre la pestaña **Secrets**. Para cada secret, usa **New repository secret**, llena los campos **Name** y **Secret**, y termina con **Add secret**.

### 1. `BACKUP_PGPASSWORD`

1. Haz clic en **New repository secret**.
2. En **Name**, escribe exactamente `BACKUP_PGPASSWORD`.
3. Solo ahora copia la contraseña exacta del owner Session Pooler desde el gestor seguro.
4. Pégala únicamente en **Secret**. No la pegues en ningún chat ni en un campo de workflow.
5. Haz clic en **Add secret**.
6. Confirma que `BACKUP_PGPASSWORD` aparece en la lista. GitHub no debe volver a mostrar su valor.

### 2. `BACKUP_STORAGE_KEY`

1. Haz clic en **New repository secret**.
2. En **Name**, escribe exactamente `BACKUP_STORAGE_KEY`.
3. Copia la key server-side de Storage desde el gestor seguro.
4. Pégala únicamente en **Secret**. NUNCA la uses en código de navegador ni la pegues en chat.
5. Haz clic en **Add secret**.
6. Confirma que `BACKUP_STORAGE_KEY` aparece en la lista sin mostrar el valor.

### 3. `BACKUP_ENCRYPTION_KEY`

1. Haz clic en **New repository secret**.
2. En **Name**, escribe exactamente `BACKUP_ENCRYPTION_KEY`.
3. Copia desde el gestor seguro la representación base64 de la key de 32 bytes.
4. Pégala únicamente en **Secret**. No pegues la copia de recuperación en GitHub ni en chat.
5. Haz clic en **Add secret**.
6. Confirma que `BACKUP_ENCRYPTION_KEY` aparece en la lista y que la copia de recuperación sigue bajo custodia separada.

### 4. `GDRIVE_SERVICE_ACCOUNT_JSON`

1. Haz clic en **New repository secret**.
2. En **Name**, escribe exactamente `GDRIVE_SERVICE_ACCOUNT_JSON`.
3. Abre localmente el archivo JSON descargado desde Google Cloud con una herramienta que no lo sincronice ni lo publique.
4. Copia todo el contenido JSON, desde la primera llave de apertura hasta la última llave de cierre.
5. Pégalo únicamente en **Secret**. NUNCA pegues el JSON, `private_key`, token o contenido parcial en un chat.
6. Haz clic en **Add secret**.
7. Confirma que `GDRIVE_SERVICE_ACCOUNT_JSON` aparece en la lista sin mostrar el contenido.

## Crear las dos Repository variables

Abre la pestaña **Variables**. Para cada variable, usa **New repository variable**, llena **Name** y **Value**, y termina con **Add variable**.

### 5. `GDRIVE_BACKUP_ROOT_FOLDER_ID`

1. Haz clic en **New repository variable**.
2. En **Name**, escribe exactamente `GDRIVE_BACKUP_ROOT_FOLDER_ID`.
3. Abre la carpeta `The Backyard - Backups` en Google Drive.
4. Copia únicamente el Folder ID de la URL, no la URL completa.
5. Pégalo únicamente en **Value**. Aunque no sea una credencial, NUNCA lo pegues en chat.
6. Haz clic en **Add variable**.
7. Confirma que `GDRIVE_BACKUP_ROOT_FOLDER_ID` aparece en la lista y corresponde a la carpeta dedicada.

### 6. `BACKUP_RETENTION_APPLY`

1. Haz clic en **New repository variable**.
2. En **Name**, escribe exactamente `BACKUP_RETENTION_APPLY`.
3. En **Value**, escribe exactamente `false`.
4. Haz clic en **Add variable**.
5. Confirma visualmente que aparece `BACKUP_RETENTION_APPLY` con valor `false`.
6. No lo cambies a `true` durante la activación. Cualquier aplicación de retención necesita una aprobación destructiva separada del propietario.

## Confirmación final sin revelar valores

En **Settings > Secrets and variables > Actions**, confirma únicamente los nombres:

**Repository secrets (4):**

- `BACKUP_PGPASSWORD`
- `BACKUP_STORAGE_KEY`
- `BACKUP_ENCRYPTION_KEY`
- `GDRIVE_SERVICE_ACCOUNT_JSON`

**Repository variables (2):**

- `GDRIVE_BACKUP_ROOT_FOLDER_ID`
- `BACKUP_RETENTION_APPLY`, con valor visible `false`

No uses un workflow de diagnóstico para imprimirlos. No uses `env`, `set`, `printenv`, tracing de shell ni debug HTTP para confirmarlos.

## Primera ejecución manual, solo desde `main`

1. Confirma que el pull request aprobado ya fue integrado en `main` y que el workflow existe en `main`.
2. Abre la pestaña **Actions** del repositorio.
3. En la lista de workflows, abre **The Backyard Automated Offsite Backup**.
4. Si aparece **Enable workflow**, haz clic en ese botón ahora que la configuración está completa.
5. Haz clic en **Run workflow**.
6. En **Use workflow from**, selecciona exactamente `main`.
7. Vuelve a confirmar que la selección muestra `main`; después haz clic en el botón verde **Run workflow**.
8. No ejecutes el primer `workflow_dispatch` desde una rama de feature. El job contiene un bloqueo para cualquier ref distinta de `refs/heads/main` y quedará omitido.
9. Abre el run y revisa solo estados y códigos seguros. No agregues pasos que impriman variables.
10. Acepta el run únicamente si Source, Database, Storage, Encryption y Verification están en `PASS`, `recoveryComplete` es `true`, Drive contiene el par esperado y la retención aparece como `DRY_RUN`.

La programación permanece en `0 9 * * *`, pero el estado sigue siendo `NOT_ACTIVE_PENDING_OWNER_SETUP` hasta que el propietario acepte esta ejecución manual y la siguiente ejecución programada.

## Rotación o revocación

- Rota primero la credencial en su proveedor y después usa **Update** en el Repository secret correspondiente.
- Deshabilita el workflow antes de una rotación que pueda dejar una combinación incompleta.
- Eliminar un secret de GitHub no revoca la credencial en Supabase o Google; haz ambas acciones.
- Si algún valor se pegó en chat, trátalo como expuesto: detén el workflow, revócalo en el proveedor y crea uno nuevo. No basta con borrar el mensaje.
