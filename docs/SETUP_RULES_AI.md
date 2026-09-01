# Configurar Reglas de Golf con IA

El buscador curado funciona siempre. La consulta IA está desactivada por defecto y solo se habilita cuando existe un PDF autorizado por el propietario.

1. No copies el PDF a este repositorio.
2. Configura `OPENAI_API_KEY` solo en `.env.local` o en variables seguras del servidor.
3. Coloca los PDFs privados en `rules-source/` o `rules-sources/`. Ambas carpetas están ignoradas por Git. El script también incluye `reglas-locales-la-vista.md` y `codigo-caballeros-golf.md`:

```bash
pnpm rules:index
```

También puedes pasar uno o más archivos o carpetas explícitos. Todos se adjuntan al mismo Vector Store y el script espera hasta que el lote termina de procesarse.

4. Copia el `OPENAI_RULES_VECTOR_STORE_ID` que imprime el script.
5. Configura:

```dotenv
OPENAI_RULES_VECTOR_STORE_ID=vs_...
OPENAI_RULES_MODEL=gpt-5.4-mini
RULES_AI_ENABLED=true
```

El endpoint `/api/rules/ask` ejecuta Responses API con `file_search`, limita consultas por ventana de tiempo y exige que la respuesta se base en el documento indexado. La API key jamás se entrega al cliente. Si falta configuración, devuelve un estado controlado y el buscador manual sigue disponible.

Las respuestas son informativas: en competencia, el Comité o árbitro tiene la decisión final.
