# Configuración del Service Account de Google Drive

**Estado: `NOT_ACTIVE_PENDING_OWNER_SETUP`**

Este procedimiento lo ejecuta el propietario. La automatización solicita un scope amplio de Google Drive, por lo que el límite efectivo depende de compartir con el Service Account únicamente la carpeta dedicada.

Cuando Google Workspace lo permita, usa una ubicación dedicada en un Shared Drive controlado por la organización. Los Service Accounts no tienen cuota personal de almacenamiento en Drive; una carpeta normal de My Drive puede impedir que la cuenta cree archivos. Si la prueba controlada muestra ese bloqueo, detente y reporta `BLOCKED_EXTERNAL`: no habilites Domain-wide delegation ni amplíes acceso para evadirlo.

> **Regla absoluta:** NUNCA pegues el JSON, la private key, un token, el email del Service Account, el Folder ID ni ningún dato copiado de las consolas en un chat. Pega cada valor solo en la pantalla indicada.

## Los 14 pasos obligatorios

1. **Entrar a Google Cloud Console.**
   - Abre Google Cloud Console con la cuenta propietaria autorizada.
   - Confirma el avatar de la cuenta en la esquina superior derecha antes de continuar.
   - No pegues en chat ningún identificador que veas en la consola.

2. **Crear o seleccionar proyecto dedicado para backups de The Backyard.**
   - Haz clic en el selector de proyecto de la barra superior.
   - Si no existe el proyecto dedicado, haz clic en **New Project** / **Nuevo proyecto**.
   - Escribe un nombre administrativo que identifique los backups de The Backyard, selecciona la organización y ubicación correctas, y haz clic en **Create** / **Crear**.
   - Regresa al selector y elige ese proyecto.
   - Confirma en la barra superior que el proyecto dedicado quedó activo. No uses el proyecto personal de otro servicio por comodidad.

3. **Habilitar Google Drive API.**
   - Abre el menú principal y entra a **APIs & Services > Library** / **APIs y servicios > Biblioteca**.
   - Busca exactamente `Google Drive API`.
   - Abre el resultado oficial y haz clic en **Enable** / **Habilitar**.
   - Confirma que la pantalla muestre **API enabled** / **API habilitada** o el botón **Manage** / **Administrar**.

4. **Crear Service Account dedicado exclusivamente a backups.**
   - Ve a **IAM & Admin > Service Accounts** / **IAM y administración > Cuentas de servicio**.
   - Haz clic en **Create service account** / **Crear cuenta de servicio**.
   - Escribe un nombre y una descripción que indiquen que se usa exclusivamente para backups de The Backyard.
   - Haz clic en **Create and continue** / **Crear y continuar**.
   - No agregues roles generales del proyecto si no son necesarios para Drive.
   - Omite el acceso de usuarios al Service Account y termina con **Done** / **Listo**.
   - Confirma que la cuenta aparece en la lista. No habilites **Domain-wide delegation** (`domain-wide delegation`) / delegación en todo el dominio.

5. **Generar credencial JSON.**
   - En la lista de Service Accounts, haz clic en la cuenta recién creada.
   - Abre la pestaña **Keys** / **Claves**.
   - Haz clic en **Add key > Create new key** / **Agregar clave > Crear clave nueva**.
   - Selecciona **JSON** y haz clic en **Create** / **Crear**.
   - El navegador descargará el archivo una sola vez. No abras ni copies su contenido en un chat.
   - Confirma en la pestaña **Keys** que aparece una clave nueva y registra solo su fecha y responsable, nunca su valor.

6. **Guardar JSON seguro.**
   - Mueve inmediatamente el archivo descargado al canal temporal aprobado por el propietario o al gestor seguro autorizado.
   - No lo guardes dentro del repositorio, Drive sincronizado, Downloads compartido, correo, notas, tickets ni chat.
   - Mantén el archivo solo el tiempo necesario para crear `GDRIVE_SERVICE_ACCOUNT_JSON` en GitHub.
   - Después de confirmar el secret, elimina las copias locales no controladas. Si hubo exposición, revoca la key desde **Keys > Actions > Delete** y genera otra.

7. **Obtener email del Service Account.**
   - Vuelve a **IAM & Admin > Service Accounts**.
   - Abre el Service Account dedicado.
   - Copia el campo **Email** usando el botón de copiar de la consola.
   - Pégalo únicamente en el cuadro **Share** de la carpeta de Drive del paso 8. NUNCA lo pegues en chat.
   - Confirma que el email corresponde al Service Account dedicado y no a una cuenta personal.

8. **Compartir únicamente carpeta 'The Backyard - Backups' con ese email.**
   - Abre Google Drive con la cuenta propietaria.
   - En la ubicación dedicada aprobada —preferentemente un Shared Drive exclusivo de backups— haz clic en **New > New folder** / **Nuevo > Nueva carpeta**.
   - Escribe exactamente `The Backyard - Backups` y haz clic en **Create** / **Crear**.
   - Haz clic derecho sobre esa carpeta y elige **Share** / **Compartir**.
   - En **Add people, groups, and calendar events**, pega únicamente el email copiado en el paso 7.
   - No compartas My Drive, una carpeta padre, otro Shared Drive ni carpetas ajenas al backup.

9. **Dar solo permisos necesarios para crear carpetas/subir/aplicar retención dentro de esa carpeta.**
   - En el selector de rol del cuadro **Share**, elige el rol mínimo que permita crear subcarpetas, subir, leer/verificar, copiar y, solo cuando exista aprobación futura, enviar a papelera los pares sujetos a retención.
   - En una carpeta de My Drive normalmente será **Editor**; en un Shared Drive usa el rol mínimo equivalente que soporte esas operaciones, por ejemplo **Content manager**, según la política de la organización.
   - Desactiva notificaciones si la política lo exige y haz clic en **Send** / **Enviar** o **Share** / **Compartir**.
   - Vuelve a abrir **Share** y confirma que solo la carpeta `The Backyard - Backups` fue compartida con el Service Account.
   - Durante la activación `BACKUP_RETENTION_APPLY=false`; tener permiso técnico no autoriza aplicar retención.

10. **Obtener Folder ID.**
    - Abre la carpeta `The Backyard - Backups`.
    - En la barra del navegador, identifica el texto que aparece después de `/folders/` en la URL.
    - Copia únicamente ese Folder ID, no la URL completa.
    - Confirma que la carpeta visible sigue llamándose `The Backyard - Backups` antes de copiar.
    - NUNCA pegues el Folder ID en chat; úsalo solo en el paso 12.

11. **Cargar GDRIVE_SERVICE_ACCOUNT_JSON como GitHub Secret.**
    - En GitHub abre el repositorio y entra a **Settings > Secrets and variables > Actions**.
    - En la pestaña **Secrets**, haz clic en **New repository secret**.
    - En **Name**, escribe exactamente `GDRIVE_SERVICE_ACCOUNT_JSON`.
    - Abre localmente el JSON seguro, copia todo su contenido y pégalo únicamente en **Secret**.
    - Haz clic en **Add secret**.
    - Confirma que el nombre aparece bajo **Repository secrets** y que GitHub no muestra el valor.
    - NUNCA pegues el JSON ni una parte de `private_key` en chat.

12. **Cargar GDRIVE_BACKUP_ROOT_FOLDER_ID como GitHub Repository Variable.**
    - En la misma pantalla de Actions, abre la pestaña **Variables**.
    - Haz clic en **New repository variable**.
    - En **Name**, escribe exactamente `GDRIVE_BACKUP_ROOT_FOLDER_ID`.
    - En **Value**, pega únicamente el Folder ID copiado en el paso 10.
    - Haz clic en **Add variable**.
    - Confirma que aparece bajo **Repository variables** y que apunta a `The Backyard - Backups`.

13. **Probar acceso limitado exclusivamente a esa carpeta.**
    - Confirma primero que el cambio aprobado ya fue integrado en `main`, que los seis nombres de GitHub están configurados y que `BACKUP_RETENTION_APPLY=false`.
    - En GitHub abre **Actions > The Backyard Automated Offsite Backup > Run workflow**.
    - En **Use workflow from**, selecciona exactamente `main` y ejecuta el `workflow_dispatch` controlado.
    - El job bloquea refs distintas de `refs/heads/main`; no uses una rama de feature.
    - Al terminar, abre `The Backyard - Backups` y confirma que las carpetas y el par package/checksum se crearon únicamente debajo de esa raíz.
    - Reabre **Share** en la raíz y revisa que el Service Account no tenga acceso por una carpeta padre, grupo, dominio o Shared Drive adicional.
    - Confirma que la retención reportó `DRY_RUN` y que no envió archivos a papelera.
    - No pruebes el límite intentando enumerar datos ajenos; valida la lista de recursos compartidos y el resultado dentro de la raíz.

14. **No enumerar/acceder otras áreas innecesariamente.**
    - No agregues al script una búsqueda global de archivos, una lista de Shared Drives ni una exploración de My Drive.
    - No concedas acceso a otras carpetas para facilitar diagnósticos.
    - Si el backup falla por permisos, corrige únicamente el permiso de `The Backyard - Backups`; no amplíes el alcance de la cuenta.
    - Confirma en la pantalla **Share** y en los registros administrativos disponibles que las operaciones quedaron contenidas en la raíz dedicada.
    - Si se detecta acceso innecesario, deshabilita el workflow, elimina ese acceso, revoca la key si procede y repite la prueba controlada.

## Custodia y rotación

- Mantén el JSON únicamente en GitHub Repository secrets y en el gestor seguro aprobado, nunca en el repositorio ni en chat.
- Para rotar, crea una key nueva, actualiza `GDRIVE_SERVICE_ACCOUNT_JSON`, ejecuta una verificación controlada desde `main` y después elimina la key anterior.
- Para suspender publicaciones, deshabilita el workflow y elimina el Service Account de la pantalla **Share** de `The Backyard - Backups`.
- No cambies `BACKUP_RETENTION_APPLY` a `true` durante este procedimiento.
